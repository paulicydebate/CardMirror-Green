/** Main-process session owner for Prep / Round Mode. Renderer access goes
 * through prep-desktop's coordinated IPC and native operation boundaries.
 * One owner per userData directory; all operations are synchronous/serialized.
 * The durable log is authoritative; state.json is only an active-log pointer.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type PrepMode = 'prep' | 'round';
export interface PrepSessionState {
  sessionId: string;
  mode: PrepMode;
  prepStartedAt: string;
  roundStartedAt: string | null;
  endedAt: string | null;
  /** Stable session identities: Save / Save As must not replace these. */
  newDocIds: string[];
  prepDocIds: string[];
  /** Persistent file identities keep protection when a saved prep doc reopens. */
  persistentDocIds?: Record<string, string>;
}
export interface PrepLogEntry {
  seq: number;
  time: string;
  window: number | null;
  document: string | null;
  kind: string;
  data: unknown;
  prev: string;
  hash: string;
}
export interface PrepLogVerification {
  entries: PrepLogEntry[];
  finalHash: string;
  sealCode: string;
}

/** Sorted keys make exported logs verifiable independently of property order. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(k => JSON.stringify(k) + ':' + canonical(record[k])).join(',') + '}';
  }
  throw new Error('Log data must contain JSON values only.');
}

function hashEntry(entry: Omit<PrepLogEntry, 'hash'>): string {
  return createHash('sha256').update(canonical(entry), 'utf8').digest('hex');
}

export function sealCode(hash: string): string {
  return hash.slice(0, 16).toUpperCase().match(/.{4}/g)!.join('-');
}

/** Verification alone cannot detect removal of a valid suffix. Compare the
 * final hash/seal with a value recorded independently at the end of the round. */
export function verifyPrepLog(text: string, expectedFinalHash?: string): PrepLogVerification {
  if (!text || !text.endsWith('\n')) throw new Error('Empty or incomplete session log.');
  const entries: PrepLogEntry[] = [];
  let prev = '0'.repeat(64);
  for (const line of text.slice(0, -1).split('\n')) {
    const entry = JSON.parse(line) as PrepLogEntry;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid log entry.');
    const { hash, ...body } = entry;
    if (Object.keys(body).sort().join(',') !== 'data,document,kind,prev,seq,time,window' ||
        body.seq !== entries.length + 1 || body.prev !== prev ||
        typeof body.kind !== 'string' || typeof body.time !== 'string' ||
        !Number.isFinite(Date.parse(body.time)) ||
        !(body.document === null || typeof body.document === 'string') ||
        !(body.window === null || (Number.isSafeInteger(body.window) && body.window > 0)) ||
        hash !== hashEntry(body)) throw new Error('Session log chain does not verify.');
    entries.push(entry);
    prev = hash;
  }
  if (expectedFinalHash !== undefined && prev !== expectedFinalHash) throw new Error('Session seal does not match.');
  return { entries, finalHash: prev, sealCode: sealCode(prev) };
}

const INTERNAL_EVENTS = new Set(['prep-start', 'round-start', 'session-end', 'document-created', 'prep-document-marked', 'prep-identity-bound', 'prep-document-reopened', 'app-restart']);

export class PrepSession {
  private state: PrepSessionState | null = null;
  private entries: PrepLogEntry[] = [];
  private failed = false;
  private readonly dir: string;
  constructor(userData: string, private readonly now: () => Date = () => new Date()) {
    this.dir = join(userData, 'lockdown');
    mkdirSync(this.dir, { recursive: true });
    let pointer: string;
    try { pointer = readFileSync(join(this.dir, 'state.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const { sessionId } = JSON.parse(pointer) as { sessionId: string };
    if (typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('Invalid session pointer.');
    this.entries = verifyPrepLog(readFileSync(this.logPath(sessionId), 'utf8')).entries;
    const first = this.entries[0]!;
    if (first.kind !== 'prep-start' || (first.data as { sessionId?: string })?.sessionId !== sessionId) throw new Error('Invalid session start.');
    this.state = { sessionId, mode: 'prep', prepStartedAt: first.time, roundStartedAt: null, endedAt: null, newDocIds: [], prepDocIds: [] };
    for (const entry of this.entries.slice(1)) this.replay(entry);
    if (this.state.endedAt) {
      unlinkSync(join(this.dir, 'state.json'));
      this.state = null;
      this.entries = [];
    } else this.append('app-restart', null);
  }

  snapshot(): PrepSessionState | null {
    return this.state ? JSON.parse(JSON.stringify(this.state)) as PrepSessionState : null;
  }
  /** The controller must stop edits when this becomes true. */
  get loggingFailed(): boolean { return this.failed; }
  private logPath(id: string): string { return join(this.dir, `${id}.jsonl`); }
  private requireActive(): PrepSessionState {
    if (this.failed) throw new Error('Session logging failed. Restart to recover before continuing.');
    if (!this.state || this.state.endedAt) throw new Error('No active Prep / Round session.');
    return this.state;
  }
  private append(kind: string, data: unknown, window: number | null = null, document: string | null = null): PrepLogEntry {
    const state = this.requireActive();
    const body = { seq: this.entries.length + 1, time: this.now().toISOString(), window, document, kind, data,
      prev: this.entries.at(-1)?.hash ?? '0'.repeat(64) };
    // Validate/clone before I/O; caller mutations cannot alter the in-memory log.
    const entry: PrepLogEntry = JSON.parse(canonical({ ...body, hash: hashEntry(body) }));
    if (!(window === null || (Number.isSafeInteger(window) && window > 0))) throw new Error('Invalid window identity.');
    let fd: number | undefined;
    try {
      // Do not recreate an active log deleted under us: that would silently
      // start a file with a nonzero prev hash and lose the earlier history.
      fd = openSync(this.logPath(state.sessionId), this.entries.length ? constants.O_WRONLY | constants.O_APPEND : 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(entry) + '\n');
      fsyncSync(fd);
    } catch (error) { this.failed = true; throw error; }
    finally { if (fd !== undefined) closeSync(fd); }
    this.entries.push(entry);
    return entry;
  }
  private replay(entry: PrepLogEntry): void {
    const state = this.state!;
    if (state.endedAt) throw new Error('Events found after session end.');
    const id = entry.document;
    switch (entry.kind) {
      case 'document-created':
        if (!id || state.newDocIds.includes(id)) throw new Error('Invalid document identity.');
        state.newDocIds.push(id);
        // Blank documents created during Round inherit protection; otherwise
        // a new blank window would provide a paste bypass for the round.
        if (state.mode === 'round') state.prepDocIds.push(id);
        break;
      case 'prep-document-marked':
        if (!id || state.mode !== 'prep' || !state.newDocIds.includes(id) || state.prepDocIds.includes(id)) throw new Error('Invalid prep document.');
        state.prepDocIds.push(id); break;
      case 'prep-identity-bound': {
        const persistentId = (entry.data as { persistentId?: string })?.persistentId;
        if (!id || !state.prepDocIds.includes(id) || typeof persistentId !== 'string' || !persistentId) throw new Error('Invalid prep file identity.');
        state.persistentDocIds ??= {};
        if (!Object.hasOwn(state.persistentDocIds, persistentId)) Object.defineProperty(state.persistentDocIds, persistentId, { value: id, enumerable: true, writable: true, configurable: true });
        break;
      }
      case 'prep-document-reopened': {
        const persistentId = (entry.data as { persistentId?: string })?.persistentId;
        if (!id || !persistentId || !Object.hasOwn(state.persistentDocIds ?? {}, persistentId) || state.prepDocIds.includes(id)) throw new Error('Invalid prep document reopen.');
        state.prepDocIds.push(id); break;
      }
      case 'round-start':
        if (state.mode !== 'prep') throw new Error('Invalid mode transition.');
        state.mode = 'round'; state.roundStartedAt = entry.time; break;
      case 'session-end': state.endedAt = entry.time; break;
      case 'prep-start': throw new Error('Duplicate session start.');
    }
  }
  start(): PrepSessionState {
    if (this.state) throw new Error('A session is already active.');
    if (this.failed) throw new Error('Restart after the logging failure.');
    this.entries = [];
    this.state = { sessionId: randomUUID(), mode: 'prep', prepStartedAt: this.now().toISOString(), roundStartedAt: null,
      endedAt: null, newDocIds: [], prepDocIds: [] };
    try {
      const first = this.append('prep-start', { sessionId: this.state.sessionId });
      this.state.prepStartedAt = first.time;
      const temp = join(this.dir, 'state.json.tmp');
      const fd = openSync(temp, 'w', 0o600);
      try { writeFileSync(fd, JSON.stringify({ sessionId: this.state.sessionId })); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temp, join(this.dir, 'state.json'));
    } catch (error) { this.failed = true; throw error; }
    return this.snapshot()!;
  }
  /** Only call for genuinely NEW blank docs. Never for an imported/recovered
   * file or a document that was open before Prep Mode began. */
  documentCreated(id: string, window: number): void {
    const state = this.requireActive();
    if (!id || state.newDocIds.includes(id)) throw new Error('Duplicate or empty document identity.');
    this.replay(this.append('document-created', null, window, id));
  }
  markPrepDocument(id: string, window: number): void {
    const state = this.requireActive();
    if (state.mode !== 'prep' || !state.newDocIds.includes(id) || state.prepDocIds.includes(id)) throw new Error('Only new documents created during Prep Mode can be marked.');
    this.replay(this.append('prep-document-marked', null, window, id));
  }
  bindIdentity(id: string, persistentId: string, window: number): void {
    const state = this.requireActive();
    if (!state.prepDocIds.includes(id) || !persistentId || persistentId.length > 150) throw new Error('Invalid prep file identity.');
    if (Object.hasOwn(state.persistentDocIds ?? {}, persistentId)) return;
    this.replay(this.append('prep-identity-bound', { persistentId }, window, id));
  }
  restoreIdentity(id: string, persistentId: string, window: number): void {
    const state = this.requireActive();
    if (!id || !Object.hasOwn(state.persistentDocIds ?? {}, persistentId)) throw new Error('Unknown prep file identity.');
    if (state.prepDocIds.includes(id)) return;
    this.replay(this.append('prep-document-reopened', { persistentId }, window, id));
  }
  /** Caller must first obtain all-window save/close acknowledgements and end
   * collaboration. A canceled save must leave the session in Prep Mode. */
  startRound(): PrepSessionState {
    if (this.requireActive().mode !== 'prep') throw new Error('Round Mode has already started.');
    this.replay(this.append('round-start', null));
    return this.snapshot()!;
  }
  /** Content belongs in the audit log only when its target is a prep doc. */
  record(kind: 'input' | 'macro' | 'autocorrect' | 'undo' | 'redo' | 'blocked' | 'focus' | 'blur' | 'document-opened' | 'document-closed' | 'document-saved' | 'collaboration-ended' | 'remote-insert' | 'app-quit',
    data: unknown, window: number, document: string | null = null): void {
    const state = this.requireActive();
    if (INTERNAL_EVENTS.has(kind)) throw new Error('Reserved session event.');
    if (['input', 'macro', 'autocorrect', 'undo', 'redo', 'remote-insert'].includes(kind) && (!document || !state.prepDocIds.includes(document))) throw new Error('Typing is logged only for prep documents.');
    this.append(kind, data, window, document);
  }
  /** Call only after the user's explicit end confirmation. */
  end(): { state: PrepSessionState; finalHash: string; sealCode: string } {
    this.requireActive();
    const entry = this.append('session-end', null);
    this.replay(entry);
    const state = this.snapshot()!;
    // A stale pointer after a crash is safe: the constructor sees session-end.
    try { unlinkSync(join(this.dir, 'state.json')); }
    catch (error) { this.failed = true; throw error; }
    this.state = null;
    return { state, finalHash: entry.hash, sealCode: sealCode(entry.hash) };
  }
}
