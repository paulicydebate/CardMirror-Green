/**
 * Minimal read-only OpenCaselist API client.
 *
 * Verified 2026-10-25 against the live spec at https://api.opencaselist.com/v1/docs
 * and the opencaselist.com web client:
 * - POST /login {username, password, remember} returns JSON with `token` (and sets a cookie).
 * - Every data endpoint requires the `caselist_token` cookie.
 * - Rounds carry `round_id` and an `opensource` file path; GET /download?path=<path> returns raw bytes.
 * The published spec omits several response fields, so responses are checked at runtime.
 *
 * Only GET requests (plus login) are made. The token is sent as a cookie and never
 * placed in a URL, log line or error message.
 */

export const OPENCASELIST_API = 'https://api.opencaselist.com/v1';

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export class OpenCaselistError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = 'OpenCaselistError';
  }
}

export interface Caselist { name: string; slug?: string; display_name?: string; event?: string; level?: string; year?: number; archived?: boolean; [key: string]: unknown }
export interface School { name: string; display_name?: string; state?: string | null; [key: string]: unknown }
export interface Team { name: string; display_name?: string; [key: string]: unknown }
export interface Round {
  round_id: number;
  tournament?: string;
  side?: string;
  round?: string;
  opponent?: string | null;
  judge?: string | null;
  opensource?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: Transport;
  /** Attempts per request, including the first. */
  maxAttempts?: number;
  /** Minimum spacing between requests, to stay polite to a volunteer-run service. */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Largest file accepted from /download. */
  maxDownloadBytes?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const MAX_BACKOFF_MS = 30_000;

function errorMessage(status: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string') {
      detail = (parsed as { message: string }).message;
    }
  } catch { /* non-JSON body */ }
  if (status === 401) return 'OpenCaselist rejected the session (401). Sign in again.';
  if (status === 403) return 'OpenCaselist denied access (403)' + (detail ? ': ' + detail : '');
  if (status === 404) return 'Not found on OpenCaselist (404)' + (detail ? ': ' + detail : '');
  if (status === 429) return 'OpenCaselist rate limit reached (429)';
  return `OpenCaselist request failed (${status})` + (detail ? ': ' + detail.slice(0, 200) : '');
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), MAX_BACKOFF_MS);
}

function requireArray<T>(value: unknown, what: string, check: (item: Record<string, unknown>) => boolean): T[] {
  if (!Array.isArray(value)) throw new OpenCaselistError(`Unexpected OpenCaselist response for ${what}: expected a list`, null, false);
  for (const item of value) {
    if (!item || typeof item !== 'object' || !check(item as Record<string, unknown>)) {
      throw new OpenCaselistError(`Unexpected OpenCaselist response for ${what}: an entry is missing required fields`, null, false);
    }
  }
  return value as T[];
}
const hasName = (item: Record<string, unknown>): boolean => typeof item['name'] === 'string' && item['name'] !== '';
const seg = (value: string): string => encodeURIComponent(value);

export class OpenCaselistClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly transport: Transport;
  private readonly maxAttempts: number;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxDownloadBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastRequestAt = -Infinity;

  constructor(options: ClientOptions) {
    if (!options.token) throw new OpenCaselistError('Not signed in to OpenCaselist', 401, false);
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? OPENCASELIST_API).replace(/\/+$/, '');
    this.transport = options.fetch ?? ((url, init) => fetch(url, init));
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 500);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxDownloadBytes = options.maxDownloadBytes ?? 100 * 1024 * 1024;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** GET with spacing, timeout and bounded retries for network errors, 429 and 5xx. */
  private async get(path: string, followOneRedirect = false): Promise<Response> {
    const url = this.baseUrl + '/' + path;
    let lastError: OpenCaselistError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      let response: Response;
      try {
        response = await this.transport(url, {
          method: 'GET',
          headers: { Cookie: 'caselist_token=' + this.token, Accept: 'application/json, */*' },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'manual',
        });
        if (followOneRedirect && response.status >= 300 && response.status < 400) {
          // A download may hand off to file storage. Follow one HTTPS hop WITHOUT the session cookie.
          const location = response.headers.get('location');
          const target = location ? new URL(location, url) : null;
          if (!target || target.protocol !== 'https:') throw new OpenCaselistError('OpenCaselist returned an unusable download redirect', response.status, false);
          response = await this.transport(target.href, { method: 'GET', signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
        }
      } catch (error) {
        if (error instanceof OpenCaselistError) throw error;
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        lastError = new OpenCaselistError(timedOut ? 'OpenCaselist request timed out' : 'Could not reach OpenCaselist', null, true);
        if (attempt < this.maxAttempts) await this.sleep(Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
        continue;
      }
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new OpenCaselistError(errorMessage(response.status, await response.text().catch(() => '')), response.status, retryable);
      if (!retryable || attempt === this.maxAttempts) throw lastError;
      await this.sleep(retryAfterMs(response) ?? Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
    }
    throw lastError ?? new OpenCaselistError('OpenCaselist request failed', null, false);
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.get(path);
    const text = await response.text();
    try { return JSON.parse(text) as unknown; }
    catch { throw new OpenCaselistError('OpenCaselist returned a response that is not JSON', response.status, false); }
  }

  async listCaselists(archived = false): Promise<Caselist[]> {
    return requireArray<Caselist>(await this.getJson('caselists' + (archived ? '?archived=true' : '')), 'caselists', hasName);
  }
  async listSchools(caselist: string): Promise<School[]> {
    return requireArray<School>(await this.getJson(`caselists/${seg(caselist)}/schools`), 'schools', hasName);
  }
  async listTeams(caselist: string, school: string): Promise<Team[]> {
    return requireArray<Team>(await this.getJson(`caselists/${seg(caselist)}/schools/${seg(school)}/teams`), 'teams', hasName);
  }
  async listRounds(caselist: string, school: string, team: string, side?: string): Promise<Round[]> {
    const query = side ? '?side=' + seg(side) : '';
    return requireArray<Round>(await this.getJson(`caselists/${seg(caselist)}/schools/${seg(school)}/teams/${seg(team)}/rounds${query}`), 'rounds',
      item => typeof item['round_id'] === 'number' && (item['opensource'] === undefined || item['opensource'] === null || typeof item['opensource'] === 'string'));
  }

  /** Public download URL for provenance. Contains no credentials. */
  downloadUrl(path: string): string {
    return this.baseUrl + '/download?path=' + encodeURIComponent(path);
  }

  async download(path: string): Promise<Uint8Array> {
    const response = await this.get('download?path=' + encodeURIComponent(path), true);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxDownloadBytes) {
      throw new OpenCaselistError('File is larger than the download limit', response.status, false);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxDownloadBytes) throw new OpenCaselistError('File is larger than the download limit', response.status, false);
    return bytes;
  }
}

/** Exchange Tabroom credentials for a caselist token. The password is sent only to OpenCaselist. */
export async function login(username: string, password: string, options: { baseUrl?: string; fetch?: Transport; timeoutMs?: number } = {}): Promise<{ token: string }> {
  if (!username || !password) throw new OpenCaselistError('Enter both your Tabroom email and password', null, false);
  const baseUrl = (options.baseUrl ?? OPENCASELIST_API).replace(/\/+$/, '');
  const transport = options.fetch ?? ((url, init) => fetch(url, init));
  let response: Response;
  try {
    response = await transport(baseUrl + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password, remember: true }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      redirect: 'error',
    });
  } catch {
    throw new OpenCaselistError('Could not reach OpenCaselist', null, true);
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new OpenCaselistError('OpenCaselist did not accept that Tabroom email or password', response.status, false);
    throw new OpenCaselistError(errorMessage(response.status, text), response.status, response.status >= 500);
  }
  let token: unknown;
  try { token = (JSON.parse(text) as { token?: unknown }).token; } catch { /* fall back to the cookie */ }
  if (typeof token !== 'string' || !token) {
    const cookie = response.headers.get('set-cookie') ?? '';
    token = /(?:^|[;,]\s*)caselist_token=([^;,\s]+)/.exec(cookie)?.[1];
  }
  if (typeof token !== 'string' || !token) throw new OpenCaselistError('OpenCaselist signed in but returned no session token', response.status, false);
  return { token };
}
