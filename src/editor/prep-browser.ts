/** Tablet session owner. IndexedDB commits the log and active pointer atomically.
 * A lifetime Web Lock admits one Green workspace per browser storage partition.
 * This is an in-app audit, never an assertion about other apps or devices. */
import type { PrepApi, Audit, PrepDocFingerprint } from './prep-controller.js';
import type { PrepStatus } from './prep-runtime.js';
import type { PrepSessionState, PrepLogEntry } from '../../apps/desktop/src/prep-session.js';
import { createPrepLogReport, exportPrepLogReport } from '../../apps/desktop/src/prep-log-report.js';

export function canonicalPrep(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalPrep).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalPrep(obj[k])).join(',') + '}';
  }
  throw new Error('Audit data must contain JSON values only.');
}
async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPrep(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
const seal = (hash: string): string => hash.slice(0, 16).toUpperCase().match(/.{4}/g)!.join('-');
export async function verifyBrowserPrepLog(entries: PrepLogEntry[]): Promise<void> {
  if (!entries.length) throw new Error('Empty audit log.');
  let previous = '0'.repeat(64);
  for (const [index, entry] of entries.entries()) {
    const { hash, ...body } = entry;
    if (Object.keys(body).sort().join(',') !== 'data,document,kind,prev,seq,time,window' || body.seq !== index + 1 ||
        body.prev !== previous || typeof body.kind !== 'string' || !Number.isFinite(Date.parse(body.time)) ||
        !(body.document === null || typeof body.document === 'string') ||
        !(body.window === null || (Number.isSafeInteger(body.window) && body.window > 0)) || hash !== await digest(body)) throw new Error('Audit log is damaged.');
    previous = hash;
  }
}
const contentKinds = new Set(['input', 'macro', 'autocorrect', 'undo', 'redo', 'remote-insert']);
const allowedKinds = new Set([...contentKinds, 'blocked', 'focus', 'blur', 'document-opened', 'document-closed', 'document-saved', 'collaboration-ended', 'collaboration-kept', 'app-quit']);
interface RecordData { id: string; entries: PrepLogEntry[] }
class PrepStorageFailure extends Error {}
export interface BrowserPrepStorage {
  load(): Promise<{ active: string | null; logs: RecordData[] }>;
  commit(log: RecordData, active: string | null): Promise<void>;
}
/** Small pure owner, with an injected durable store for failure/restart tests. */
export class BrowserPrepSession {
  state: PrepSessionState | null = null;
  logs = new Map<string, PrepLogEntry[]>();
  constructor(private storage: BrowserPrepStorage, private now = () => new Date()) {}
  private async commit(log: RecordData, active: string | null): Promise<void> {
    try { await this.storage.commit(log, active); }
    catch (error) { throw new PrepStorageFailure(`Browser audit storage failed: ${String(error)}`); }
  }
  async load(): Promise<void> {
    const stored = await this.storage.load();
    this.logs = new Map(stored.logs.map(log => [log.id, log.entries]));
    if (!stored.active) return;
    const entries = this.logs.get(stored.active);
    if (!entries) throw new Error('Active session log is missing. Editing is paused.');
    await verifyBrowserPrepLog(entries);
    const first = entries[0]!;
    if (first.kind !== 'prep-start' || (first.data as { sessionId?: string })?.sessionId !== stored.active) throw new Error('Invalid session start.');
    this.state = { sessionId: stored.active, mode: 'prep', prepStartedAt: first.time, roundStartedAt: null, endedAt: null, newDocIds: [], prepDocIds: [], persistentDocIds: {} };
    for (const entry of entries.slice(1)) this.replay(entry);
    if (this.state.endedAt) throw new Error('Ended session has an active pointer.');
    await this.append('app-restart', { platform: 'browser', scope: 'CardMirror only' });
  }
  private replay(entry: PrepLogEntry): void {
    const state = this.state!;
    const id = entry.document;
    const persistentId = (entry.data as { persistentId?: string } | null)?.persistentId;
    if (entry.kind === 'document-created' && id) state.newDocIds.push(id);
    if (entry.kind === 'prep-document-marked' && id) state.prepDocIds.push(id);
    if (entry.kind === 'prep-identity-bound' && id && persistentId) {
      state.persistentDocIds ??= {};
      Object.defineProperty(state.persistentDocIds, persistentId, { value: id, enumerable: true, configurable: true });
    }
    if (entry.kind === 'prep-document-reopened' && id) state.prepDocIds.push(id);
    if (entry.kind === 'round-start') { state.mode = 'round'; state.roundStartedAt = entry.time; }
    if (entry.kind === 'session-end') state.endedAt = entry.time;
  }
  private async append(kind: string, data: unknown, document: string | null = null): Promise<PrepLogEntry> {
    if (!this.state) throw new Error('Start Prep Mode first.');
    const id = this.state.sessionId;
    const entries = this.logs.get(id) ?? [];
    const body = { seq: entries.length + 1, time: this.now().toISOString(), window: 1, document, kind, data, prev: entries.at(-1)?.hash ?? '0'.repeat(64) };
    const entry = JSON.parse(canonicalPrep({ ...body, hash: await digest(body) })) as PrepLogEntry;
    const next = [...entries, entry];
    await this.commit({ id, entries: next }, kind === 'session-end' ? null : id);
    this.logs.set(id, next);
    this.replay(entry);
    return entry;
  }
  async start(): Promise<void> {
    if (this.state) throw new Error('A Prep / Round session is already active.');
    this.state = { sessionId: crypto.randomUUID(), mode: 'prep', prepStartedAt: this.now().toISOString(), roundStartedAt: null, endedAt: null, newDocIds: [], prepDocIds: [], persistentDocIds: {} };
    await this.append('prep-start', { sessionId: this.state.sessionId, platform: 'browser', scope: 'CardMirror only; other apps and devices are not monitored' });
  }
  async documentAction(action: string, uid: string, persistentId?: string): Promise<void> {
    const s = this.state;
    if (!s || !uid || uid.length > 150) throw new Error('Invalid session document.');
    if (action === 'created' || action === 'created-prep') {
      if (!s.newDocIds.includes(uid)) await this.append('document-created', null, uid);
      // Blank documents created during Round are protected immediately too.
      if ((action === 'created-prep' || s.mode === 'round') && !s.prepDocIds.includes(uid)) await this.append('prep-document-marked', null, uid);
    } else if (action === 'mark') {
      if (s.mode !== 'prep' || !s.newDocIds.includes(uid) || s.prepDocIds.includes(uid)) throw new Error('Only new blank session documents can be marked.');
      await this.append('prep-document-marked', null, uid);
    } else if (action === 'bind' || action === 'restore') {
      if (!persistentId || persistentId.length > 150) throw new Error('Invalid file identity.');
      if (action === 'bind') {
        if (!s.prepDocIds.includes(uid)) throw new Error('Document is not protected.');
        if (!Object.hasOwn(s.persistentDocIds ?? {}, persistentId)) await this.append('prep-identity-bound', { persistentId }, uid);
      } else {
        if (!Object.hasOwn(s.persistentDocIds ?? {}, persistentId)) throw new Error('Unknown prep document.');
        if (!s.prepDocIds.includes(uid)) await this.append('prep-document-reopened', { persistentId }, uid);
      }
    } else throw new Error('Unknown document action.');
  }
  async events(events: Audit[]): Promise<void> {
    if (!this.state) throw new Error('No active session.');
    const id = this.state.sessionId;
    const next = [...this.logs.get(id)!];
    const additions: PrepLogEntry[] = [];
    for (const event of events) {
      if (!allowedKinds.has(event.kind)) throw new Error('Invalid audit event.');
      // Normal strategy documents must never leak their contents into this log.
      if (contentKinds.has(event.kind) && (!event.uid || !this.state?.prepDocIds.includes(event.uid))) continue;
      const body = { seq: next.length + 1, time: this.now().toISOString(), window: 1, document: event.uid, kind: event.kind, data: event.data, prev: next.at(-1)!.hash };
      const entry = JSON.parse(canonicalPrep({ ...body, hash: await digest(body) })) as PrepLogEntry;
      next.push(entry); additions.push(entry);
    }
    if (!additions.length) return;
    await this.commit({ id, entries: next }, id);
    this.logs.set(id, next);
  }
  async round(): Promise<void> {
    if (this.state?.mode !== 'prep' || !this.state.prepDocIds.length) throw new Error('Create a prep document before starting Round.');
    await this.append('round-start', null);
  }
  async end(docs: PrepDocFingerprint[]): Promise<unknown> {
    if (!this.state) throw new Error('No session is active.');
    for (const doc of docs) if (!this.state.prepDocIds.includes(doc.document) || !/^[a-f0-9]{64}$/.test(doc.fingerprint)) throw new Error('Invalid document fingerprint.');
    const fp = await this.append('document-fingerprints', { docs, prepStartedAt: this.state.prepStartedAt, roundStartedAt: this.state.roundStartedAt });
    const last = await this.append('session-end', null);
    const state = structuredClone(this.state); this.state = null;
    return { state, finalHash: last.hash, sealCode: seal(last.hash), certificate: { format: 'cardmirror.prep-seal', version: 1, entries: [fp, last] } };
  }
}
function indexedStore(): BrowserPrepStorage {
  let db: IDBDatabase;
  const open = new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('cardmirror-green-prep', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('logs', { keyPath: 'id' }); request.result.createObjectStore('meta'); };
    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => db.close();
      window.addEventListener('pagehide', () => db.close(), { once: true });
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  return {
    async load() {
      await open;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['logs', 'meta']);
        const logs = tx.objectStore('logs').getAll(); const active = tx.objectStore('meta').get('active');
        tx.oncomplete = () => resolve({ logs: logs.result as RecordData[], active: active.result as string | null ?? null });
        tx.onabort = () => reject(tx.error);
      });
    },
    async commit(log, active) {
      await open;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['logs', 'meta'], 'readwrite');
        const previous = tx.objectStore('logs').get(log.id);
        const pointer = tx.objectStore('meta').get('active');
        pointer.onsuccess = () => {
          const old = previous.result as RecordData | undefined;
          // Reject a late write from a page being torn down. It may only
          // extend the exact durable prefix, never replace a newer owner.
          if ((pointer.result && pointer.result !== log.id) ||
              (old && (old.entries.length >= log.entries.length || old.entries.at(-1)!.hash !== log.entries[old.entries.length - 1]?.hash))) { tx.abort(); return; }
          tx.objectStore('logs').put(log); tx.objectStore('meta').put(active, 'active');
        };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Browser storage write failed.'));
      });
    },
  };
}
export async function createBrowserPrepApi(): Promise<PrepApi> {
  const owner = new BrowserPrepSession(indexedStore());
  let error: string | null = null, transitioning = false;
  let writes: Promise<unknown> = Promise.resolve();
  const states: Array<(s: PrepStatus) => void> = [];
  const prepares: Array<(req: { requestId: string; action: 'round' | 'end' }) => void> = [];
  const sealed: Array<(s: { certificate: unknown; persistentIds: string[] }) => void> = [];
  let acknowledgement: ((value: { ok: boolean; docs: PrepDocFingerprint[] }) => void) | null = null;
  let inventory = new Set<string>();
  const status = (): PrepStatus => ({ session: structuredClone(owner.state), transitioning, error });
  const broadcast = (): void => { for (const fn of states) fn(status()); };
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const task = writes.then(async () => {
      if (error) throw new Error(error);
      try { const result = await fn(); broadcast(); return result; }
      catch (e) { if (e instanceof PrepStorageFailure) { error = `Prep logging failed. Editing paused: ${String(e)}`; broadcast(); } throw e; }
    });
    writes = task.catch(() => {}); return task;
  };
  // Never run two independent owners against the same browser session.
  await new Promise<void>(resolve => {
    if (!navigator.locks) { error = 'Prep requires a browser with Web Locks. Update iPadOS and Safari.'; resolve(); return; }
    void navigator.locks.request('cardmirror-green-prep-owner', { ifAvailable: true }, async lock => {
      if (!lock) { error = 'Another CardMirror Green tab is open. Close it, then reload this workspace to use Prep / Round.'; resolve(); return; }
      try { await owner.load(); } catch (e) { error = `Prep recovery failed. Editing paused: ${String(e)}`; }
      resolve();
      await new Promise<void>(release => window.addEventListener('pagehide', () => release(), { once: true }));
    }).catch(e => { error = String(e); resolve(); });
  });
  const download = (text: string, filename: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.hidden = true;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const read = (id: string): PrepLogEntry[] => { const entries = owner.logs.get(id); if (!entries) throw new Error('Log not found.'); return entries; };
  const raw = (entries: PrepLogEntry[]): string => entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  const api: PrepApi = {
    async ready() { await writes; return status(); },
    inventory(docs) { inventory = new Set(docs); },
    events: events => owner.state ? run(() => owner.events(events)) : Promise.resolve(),
    async action(action, payload) {
      if (transitioning) throw new Error('A mode transition is in progress.');
      if (action === 'copy-invite') {
        if (typeof payload !== 'string' || !/^(?:cmshare3|cmview2)\.[0-9a-f]{16,64}\.[A-Za-z0-9_-]{43}\.\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(payload)) throw new Error('Invalid invitation.');
        // This narrow exception copies only a generated session invitation.
        await originalClipboardWrite?.(payload); return !!originalClipboardWrite;
      }
      if (action === 'start') return run(() => owner.start());
      if (action !== 'round' && action !== 'end') {
        const uid = typeof payload === 'string' ? payload : payload?.uid;
        if (!uid || !inventory.has(uid)) throw new Error('Document is not in this workspace.');
        return run(() => owner.documentAction(action, uid, typeof payload === 'object' ? payload.persistentId : undefined));
      }
      if (!owner.state) throw new Error('Start Prep Mode first.');
      if (action === 'round' && !owner.state.prepDocIds.length) throw new Error('Create a prep document first.');
      transitioning = true; broadcast();
      try {
        const prepared = await new Promise<{ ok: boolean; docs: PrepDocFingerprint[] }>(resolve => {
          const timer = setTimeout(() => { acknowledgement = null; resolve({ ok: false, docs: [] }); }, 120000);
          acknowledgement = value => { clearTimeout(timer); acknowledgement = null; resolve(value); };
          for (const fn of prepares) fn({ requestId: 'browser-transition', action });
        });
        if (!prepared.ok) throw new Error('Mode change canceled. Current restrictions remain active.');
        if (action === 'round') {
          if ([...inventory].some(id => !owner.state!.prepDocIds.includes(id))) throw new Error('Close non-prep documents first.');
          return await run(() => owner.round());
        }
        const result = await run(() => owner.end(prepared.docs)) as { certificate: unknown };
        for (const fn of sealed) fn({ certificate: result.certificate, persistentIds: prepared.docs.map(d => d.persistentId).filter((id): id is string => !!id) });
        return result;
      } finally { transitioning = false; broadcast(); }
    },
    prepared(_id, ok, docs = []) { acknowledgement?.({ ok, docs }); },
    onState(fn) { states.push(fn); return () => { states.splice(states.indexOf(fn), 1); }; },
    onPrepare(fn) { prepares.push(fn); return () => { prepares.splice(prepares.indexOf(fn), 1); }; },
    onSealed(fn) { sealed.push(fn); return () => { sealed.splice(sealed.indexOf(fn), 1); }; },
    async logs() {
      await writes;
      return Promise.all([...owner.logs].reverse().map(async ([id, entries]) => {
        try { await verifyBrowserPrepLog(entries); } catch { return { id, valid: false }; }
        return { id, valid: true, start: entries[0]?.time, end: entries.find(e => e.kind === 'session-end')?.time ?? null,
          round: entries.find(e => e.kind === 'round-start')?.time ?? null, sealCode: seal(entries.at(-1)!.hash), finalHash: entries.at(-1)!.hash, events: entries.length, blocked: entries.filter(e => e.kind === 'blocked').length };
      }));
    },
    async readLog(id) { await writes; return raw(read(id)); },
    async exportLog(id, format = 'raw', timeZone) {
      await writes; const entries = read(id); await verifyBrowserPrepLog(entries);
      const text = raw(entries);
      download(format === 'readable' ? exportPrepLogReport(createPrepLogReport(text, { timeZone, chainValid: true, sealCode: seal(entries.at(-1)!.hash) })) : text, `CardMirror-session-${id}.${format === 'readable' ? 'txt' : 'jsonl'}`);
      return true;
    },
    async checkSeal({ certificate, code, persistentId, fingerprint }) {
      try {
      const c = certificate as { format?: string; version?: number; entries?: PrepLogEntry[] } | null;
      if (c?.format !== 'cardmirror.prep-seal' || c.version !== 1 || c.entries?.length !== 2) return { status: 'damaged' };
      const [fp, end] = c.entries as [PrepLogEntry, PrepLogEntry];
      for (const entry of [fp, end]) { const { hash, ...body } = entry; if (Object.keys(body).sort().join(',') !== 'data,document,kind,prev,seq,time,window' || !Number.isSafeInteger(body.seq) || !Number.isFinite(Date.parse(body.time)) || hash !== await digest(body)) return { status: 'damaged' }; }
      if (fp.kind !== 'document-fingerprints' || end.kind !== 'session-end' || end.prev !== fp.hash || end.seq !== fp.seq + 1) return { status: 'damaged' };
      const wanted = code.replace(/[^0-9a-f]/gi, '').toLowerCase();
      if (!(wanted.length === 16 && end.hash.startsWith(wanted)) && wanted !== end.hash) return { status: 'wrong-code' };
      const data = fp.data as { docs: PrepDocFingerprint[]; prepStartedAt: string; roundStartedAt: string | null };
      const doc = data.docs.find(d => !!persistentId && d.persistentId === persistentId);
      return { status: !doc ? 'not-in-seal' : doc.fingerprint === fingerprint ? 'unchanged' : 'modified', name: doc?.name, prepStartedAt: data.prepStartedAt, roundStartedAt: data.roundStartedAt, endedAt: end.time, sealCode: seal(end.hash) };
      } catch { return { status: 'damaged' }; }
    },
  };
  const originalClipboardWrite = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  const focus = (kind: 'focus' | 'blur'): void => { if (owner.state) void api.events([{ kind, uid: null, data: { source: 'browser', visibility: document.visibilityState, clientTime: new Date().toISOString() } }]).catch(() => {}); };
  window.addEventListener('focus', () => focus('focus')); window.addEventListener('blur', () => focus('blur'));
  document.addEventListener('visibilitychange', () => focus(document.hidden ? 'blur' : 'focus'));
  return api;
}
