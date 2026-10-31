/**
 * OpenCaselist service for the desktop app's main process.
 *
 * The renderer never sees the session token: it asks this service to sign in,
 * list caselists/schools/teams/rounds and download a disclosed file, and gets
 * back plain data. The password passes through once, straight to OpenCaselist,
 * and is never stored or logged. Only the returned token is persisted, through
 * the injected `store` (the desktop wires it to an OS-encrypted file).
 *
 * Every call resolves to `{ ok: true, value }` or `{ ok: false, error, signedOut }`
 * so error text reaches the UI intact (Electron rewrites thrown IPC errors).
 */

import { login, OpenCaselistClient, OpenCaselistError, OPENCASELIST_API, type Transport } from './client.js';

export interface SessionStore {
  read(): string | null;
  write(value: string): void;
  remove(): void;
}

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; signedOut: boolean };

export interface CaselistItem { name: string; label: string; event: string | null; level: string | null; year: number | null }
export interface NamedItem { name: string; label: string }
export interface RoundItem {
  roundId: number;
  tournament: string;
  side: string;
  round: string;
  opponent: string;
  judge: string;
  /** OpenCaselist file path, or null when the round has no open-source file. */
  opensource: string | null;
  /** File name shown to the user and used as the opened document's name. */
  filename: string | null;
  /** Whether the editor can open this file (.docx / .cmir). */
  openable: boolean;
}
export interface DownloadedFile { filename: string; bytes: Uint8Array; sourceUrl: string }

export interface OpenCaselistService {
  status(): Promise<ServiceResult<{ signedIn: boolean }>>;
  login(username: unknown, password: unknown): Promise<ServiceResult<{ signedIn: true }>>;
  logout(): Promise<ServiceResult<{ signedIn: false }>>;
  caselists(): Promise<ServiceResult<CaselistItem[]>>;
  schools(caselist: unknown): Promise<ServiceResult<NamedItem[]>>;
  teams(caselist: unknown, school: unknown): Promise<ServiceResult<NamedItem[]>>;
  rounds(caselist: unknown, school: unknown, team: unknown): Promise<ServiceResult<RoundItem[]>>;
  download(path: unknown): Promise<ServiceResult<DownloadedFile>>;
}

export interface ServiceOptions {
  store: SessionStore;
  baseUrl?: string;
  fetch?: Transport;
  /** Passed to the client; tests set 0. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_ARG = 1000;

function arg(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_ARG) {
    throw new OpenCaselistError(`Missing or invalid ${what}`, null, false);
  }
  return value;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Last path segment of an OpenCaselist file path. */
export function fileNameFromPath(path: string): string {
  const last = path.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return last || 'opencaselist-file';
}

export function isOpenableFileName(name: string): boolean {
  return /\.(docx|cmir)$/i.test(name);
}

const byLabel = <T extends { label: string }>(a: T, b: T): number => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

export function createOpenCaselistService(options: ServiceOptions): OpenCaselistService {
  const baseUrl = (options.baseUrl ?? OPENCASELIST_API).replace(/\/+$/, '');
  let client: OpenCaselistClient | null = null;
  let clientToken: string | null = null;

  function readToken(): string | null {
    let raw: string | null;
    try { raw = options.store.read(); } catch { return null; }
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw) as { token?: unknown; apiBase?: unknown };
      // A token is only ever sent back to the server that issued it.
      return typeof saved.token === 'string' && saved.token && saved.apiBase === baseUrl ? saved.token : null;
    } catch {
      return null;
    }
  }

  function clearSession(): void {
    client = null;
    clientToken = null;
    try { options.store.remove(); } catch { /* already gone */ }
  }

  function getClient(): OpenCaselistClient {
    const token = readToken();
    if (!token) throw new OpenCaselistError('Not signed in to OpenCaselist', 401, false);
    if (!client || clientToken !== token) {
      // One client per token, so the polite request spacing holds across calls.
      client = new OpenCaselistClient({
        token,
        baseUrl,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.minIntervalMs !== undefined ? { minIntervalMs: options.minIntervalMs } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
      });
      clientToken = token;
    }
    return client;
  }

  async function run<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      if (error instanceof OpenCaselistError) {
        const signedOut = error.status === 401;
        // An expired or rejected session is useless; drop it so the UI shows sign-in.
        if (signedOut) clearSession();
        return { ok: false, error: error.message, signedOut };
      }
      return { ok: false, error: 'OpenCaselist request failed unexpectedly', signedOut: false };
    }
  }

  return {
    status: () => run(async () => ({ signedIn: readToken() !== null })),

    login: (username, password) => run(async () => {
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > MAX_ARG || password.length > MAX_ARG) {
        throw new OpenCaselistError('Enter both your Tabroom email and password', null, false);
      }
      const { token } = await login(username.trim(), password, {
        baseUrl,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      options.store.write(JSON.stringify({ apiBase: baseUrl, token, savedAt: new Date().toISOString() }));
      client = null;
      clientToken = null;
      return { signedIn: true as const };
    }),

    logout: () => run(async () => {
      clearSession();
      return { signedIn: false as const };
    }),

    caselists: () => run(async () => {
      const list = await getClient().listCaselists();
      return list
        .map(c => ({
          name: c.name,
          label: str(c.display_name) || c.name,
          event: str(c.event) || null,
          level: str(c.level) || null,
          year: typeof c.year === 'number' ? c.year : null,
        }))
        .sort(byLabel);
    }),

    schools: (caselist) => run(async () => {
      const list = await getClient().listSchools(arg(caselist, 'caselist'));
      return list.map(s => ({ name: s.name, label: str(s.display_name) || s.name })).sort(byLabel);
    }),

    teams: (caselist, school) => run(async () => {
      const list = await getClient().listTeams(arg(caselist, 'caselist'), arg(school, 'school'));
      return list.map(t => ({ name: t.name, label: str(t.display_name) || t.name })).sort(byLabel);
    }),

    rounds: (caselist, school, team) => run(async () => {
      const list = await getClient().listRounds(arg(caselist, 'caselist'), arg(school, 'school'), arg(team, 'team'));
      return list.map(r => {
        const opensource = typeof r.opensource === 'string' && r.opensource ? r.opensource : null;
        const filename = opensource ? fileNameFromPath(opensource) : null;
        return {
          roundId: r.round_id,
          tournament: str(r.tournament),
          side: str(r.side),
          round: str(r.round),
          opponent: str(r.opponent),
          judge: str(r.judge),
          opensource,
          filename,
          openable: filename !== null && isOpenableFileName(filename),
        };
      });
    }),

    download: (path) => run(async () => {
      const p = arg(path, 'file path');
      const c = getClient();
      const bytes = await c.download(p);
      return { filename: fileNameFromPath(p), bytes, sourceUrl: c.downloadUrl(p) };
    }),
  };
}
