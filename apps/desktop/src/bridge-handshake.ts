/**
 * cardmirror-bridge — the published cross-app handshake standard.
 *
 * A shared per-platform directory where each debate app writes TWO files:
 *
 *   `<appId>.json`          IDENTITY — schema/app/appVersion/kind. Written on
 *                           first launch, NEVER deleted. This is what app
 *                           pickers list, so a closed app stays selectable.
 *   `<appId>.session.json`  SESSION — port/token/pid. Rotated per launch,
 *                           deleted on quit. Its absence = the app isn't
 *                           running right now.
 *
 * The split is the standing principle from the pairing work: a dead
 * connection is a RUNTIME error (`app-not-running` at send time), never a
 * settings blocker — with one combined file deleted on quit, an app could
 * only be selected while it happened to be running. (The split ships as
 * schema 1: nothing deployed reads this directory yet — the legacy Fast
 * Debate Paste discovery file is a separate mechanism — so there is no
 * combined-file cohort to migrate.)
 *
 * Tokens are secrets: the directory is created 0700 and both files 0600
 * (best-effort on Windows, where POSIX modes don't map) — a shared Linux
 * box must not leak another user's session token. CardMirror mirrors its
 * fast-paste endpoint here as kind "editor"; flowing apps register as kind
 * "flow". All cross-app transport is brokered HERE — renderer plugins
 * never see tokens or sockets.
 */
import { app } from 'electron';
import { BRIDGE_ID } from './app-identity.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const BRIDGE_SCHEMA = 1;
export const BRIDGE_TOKEN_HEADER = 'X-Bridge-Token';
const PING_TIMEOUT_MS = 1500;
const POST_TIMEOUT_MS = 3000;
const APP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_HANDSHAKE_BYTES = 64 * 1024;

export interface FlowAppInfo {
  id: string;
  app: string;
  appVersion: string;
  schema: number;
  kind: 'flow';
  /** A session file exists AND the app answered /ping just now. A listed
   *  app with `running: false` is selectable but not reachable — sends
   *  fail at runtime with `app-not-running`. */
  running: boolean;
}
export type FlowPostResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: 'no-such-app' | 'app-not-running' | 'timeout' | 'bad-response' };

interface IdentityFile {
  schema: number;
  app: string;
  appVersion: string;
  kind: string;
}
interface SessionFile {
  port: number;
  token: string;
  pid: number;
}

export function bridgeDirPath(): string {
  if (process.env['CARDMIRROR_BRIDGE_DIR']) return process.env['CARDMIRROR_BRIDGE_DIR'];
  if (process.platform === 'linux') {
    const base = process.env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share');
    return path.join(base, 'cardmirror-bridge');
  }
  return path.join(app.getPath('appData'), 'cardmirror-bridge');
}

/** mkdir 0700 + chmod (an old dir may predate the mode) — the dir holds
 *  session tokens, so other users must not traverse it. Best-effort:
 *  Windows has no POSIX modes and chmod there is a near-no-op. */
async function ensureBridgeDir(): Promise<string> {
  const dir = bridgeDirPath();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => {});
  return dir;
}

async function writeFileAtomic0600(finalPath: string, data: unknown): Promise<void> {
  const tmpPath = `${finalPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmpPath, finalPath);
}

export async function writeCardmirrorHandshake(port: number, token: string): Promise<void> {
  const dir = await ensureBridgeDir();
  const identity: IdentityFile = {
    schema: BRIDGE_SCHEMA,
    app: BRIDGE_ID,
    appVersion: app.getVersion(),
    kind: 'editor',
  };
  const session: SessionFile = { port, token, pid: process.pid };
  await writeFileAtomic0600(path.join(dir, `${BRIDGE_ID}.json`), identity);
  await writeFileAtomic0600(path.join(dir, `${BRIDGE_ID}.session.json`), session);
}

/** Quit path: clear ONLY the session half. The identity file persists by
 *  design — that's what keeps a closed CardMirror selectable in flow-app
 *  pickers (and vice versa for flow apps in ours). */
export async function deleteCardmirrorHandshake(): Promise<void> {
  await fs.unlink(path.join(bridgeDirPath(), `${BRIDGE_ID}.session.json`)).catch(() => {});
}

async function readJsonCapped<T>(filePath: string): Promise<Partial<T> | null> {
  try {
    if ((await fs.stat(filePath)).size > MAX_HANDSHAKE_BYTES) return null;
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<T>;
  } catch {
    return null;
  }
}

function validSession(obj: Partial<SessionFile> | null): SessionFile | null {
  if (!obj) return null;
  if (!Number.isInteger(obj.port) || (obj.port as number) < 1 || (obj.port as number) > 65535) {
    return null;
  }
  if (typeof obj.token !== 'string' || !obj.token) return null;
  return {
    port: obj.port as number,
    token: obj.token,
    pid: typeof obj.pid === 'number' ? obj.pid : 0,
  };
}

async function readAppFiles(
  appId: string,
): Promise<{ identity: IdentityFile; session: SessionFile | null } | null> {
  if (!APP_ID_RE.test(appId)) return null;
  const dir = bridgeDirPath();
  const idObj = await readJsonCapped<IdentityFile & Partial<SessionFile>>(
    path.join(dir, `${appId}.json`),
  );
  if (!idObj || typeof idObj.app !== 'string' || typeof idObj.kind !== 'string') return null;
  const identity: IdentityFile = {
    schema: typeof idObj.schema === 'number' ? idObj.schema : 0,
    app: idObj.app,
    appVersion: typeof idObj.appVersion === 'string' ? idObj.appVersion : '',
    kind: idObj.kind,
  };
  const session =
    validSession(await readJsonCapped<SessionFile>(path.join(dir, `${appId}.session.json`))) ??
    // A combined single file (identity fields + port/token together) reads
    // as its own session — tolerated so a peer that writes the pre-split
    // shape still works; the published contract is the two-file form.
    validSession(idObj);
  return { identity, session };
}

/** Friendly display identity for ANY registered app id (any kind, not
 *  just flow apps) — used by the external-consent prompt to say
 *  "ebb v0.7.1" instead of a bare id. Null when the app never
 *  registered an identity file (identity is then the raw appId). */
export async function readAppIdentity(
  appId: string,
): Promise<{ app: string; appVersion: string } | null> {
  const files = await readAppFiles(appId);
  return files ? { app: files.identity.app, appVersion: files.identity.appVersion } : null;
}

/** Best-effort liveness for the pid a session file records. kill(0)
 *  sends no signal — it only probes existence; EPERM means "exists but
 *  not ours" (alive). A DEAD pid proves the file is stale: whatever
 *  answers that port now is not the app that wrote it, so callers skip
 *  the send instead of delivering to a stranger. PID recycling can make
 *  a stale pid look alive — that merely degrades this guard to the
 *  plain failed-send path, never worse (Shreeram review, 2026-07-24:
 *  chosen over ping-first, which costs a round trip and can't tell the
 *  app from a port squatter anyway). Unknown/absent pid never blocks. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** An aborted/timed-out fetch surfaces as AbortError, a nested
 *  AbortError cause, or (undici's deadline) TimeoutError. */
function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } };
  return e?.name === 'AbortError' || e?.name === 'TimeoutError' || e?.cause?.name === 'AbortError';
}

/** Headers-only deadline — fine for ping, which never reads a body. */
function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

async function ping(session: SessionFile): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `http://127.0.0.1:${session.port}/ping`,
      { headers: { [BRIDGE_TOKEN_HEADER]: session.token } },
      PING_TIMEOUT_MS,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** EVERY registered flow app — closed ones included (identity files
 *  persist), each with a live `running` flag. A stale session (crashed
 *  app) fails the ping and reads as not-running, never as absent.
 *  Tokens never leave this module. */
export async function scanFlowApps(): Promise<FlowAppInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(bridgeDirPath());
  } catch {
    return [];
  }
  const candidates: Array<{ id: string; identity: IdentityFile; session: SessionFile | null }> = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.session.json')) continue;
    const id = name.slice(0, -'.json'.length);
    const files = await readAppFiles(id);
    if (!files || files.identity.kind !== 'flow') continue;
    candidates.push({ id, ...files });
  }
  const alive = await Promise.all(
    candidates.map((c) => (c.session && pidAlive(c.session.pid) ? ping(c.session) : false)),
  );
  return candidates.map(({ id, identity }, i) => ({
    id,
    app: identity.app,
    appVersion: identity.appVersion,
    schema: identity.schema,
    kind: 'flow' as const,
    running: alive[i]!,
  }));
}

export async function flowPost(
  appId: string,
  route: string,
  body: unknown,
): Promise<FlowPostResult> {
  const files = await readAppFiles(appId);
  if (!files || files.identity.kind !== 'flow') return { ok: false, error: 'no-such-app' };
  // Registered but no session = not launched right now. The runtime
  // error, not a missing app — callers can tell the user to start it.
  if (!files.session) return { ok: false, error: 'app-not-running' };
  // Session file present but its writer is dead = stale file (crash
  // without cleanup). Same runtime error, zero network.
  if (!pidAlive(files.session.pid)) return { ok: false, error: 'app-not-running' };
  const { session } = files;
  const routePath = route.startsWith('/') ? route : `/${route}`;
  // One deadline covers connect, headers, AND the body read: a peer that
  // sends headers then stalls the body must still map to 'timeout'.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), POST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${session.port}${routePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [BRIDGE_TOKEN_HEADER]: session.token },
      body: JSON.stringify(body ?? {}),
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (isTimeoutError(err)) return { ok: false, error: 'timeout' };
    return { ok: false, error: 'app-not-running' };
  }
  try {
    return { ok: true, status: res.status, body: await res.json() };
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, error: 'timeout' };
    return { ok: false, error: 'bad-response' };
  } finally {
    clearTimeout(timer);
  }
}
