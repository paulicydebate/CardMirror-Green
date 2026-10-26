import { configurePrepGuards } from './prep-document-guard.js';
import { prepDoc, prepRound, prepRuntime, prepTransferBlocked, type PrepStatus } from './prep-runtime.js';
import { confirmDialog, alertDialog } from './text-prompt.js';
import { showToast } from './toast.js';
import { newWorkbook, serializeFlow, parseFlow } from '../flow/flow-model.js';
import { schema } from '../schema/index.js';
import { collabCopresenceFor } from './collab/collab-hooks.js';
import type { Node as PMNode } from 'prosemirror-model';

export interface PrepAdapter {
  documents(): Array<{ uid: string; name: string }>;
  focused(): string | null;
  create(doc?: PMNode): Promise<string | null>;
  closeNonPrep(): Promise<boolean>;
  endCollaboration(onlyPrep: boolean): Promise<boolean>;
  hasCollaboration(uid: string): boolean;
  identity(uid: string): string;
}
interface Audit { kind: string; uid: string | null; data: unknown }
interface LogSummary { id: string; valid: boolean; start?: string; end?: string | null; round?: string | null; finalHash?: string; sealCode?: string; events?: number; blocked?: number;
  characters?: number; outsideMs?: number; flagged?: number; typingByMinute?: Array<{ minute: number; characters: number; wpm: number }> }
interface PrepApi {
  ready(): Promise<PrepStatus>;
  action(action: string, uid?: string | { uid: string; persistentId: string }): Promise<unknown>;
  inventory(docs: string[], focused: string | null): void;
  events(events: Audit[]): Promise<void>;
  logs(): Promise<LogSummary[]>;
  readLog(id: string): Promise<string>;
  exportLog(id: string): Promise<boolean>;
  prepared(requestId: string, ok: boolean): void;
  onState(fn: (state: PrepStatus) => void): () => void;
  onPrepare(fn: (req: { requestId: string; action: 'round' | 'end' }) => void): () => void;
}
let adapter: PrepAdapter | null = null;
let api: PrepApi | undefined;
let queue: Audit[] = [];
let writes: Promise<void> = Promise.resolve();
let bar: HTMLElement | null = null;
let busy = false;
let rendered = '';
let lastSessionId: string | null = null;
let lastDocs = new Map<string, string>();
const localNewDocs = new Set<string>();

/** A late mark cannot retroactively attest text pasted/typed before logging. */
export function isBlankPrepCandidate(doc: PMNode): boolean {
  if (doc.textContent.trim()) return false;
  let blank = true;
  doc.descendants(node => {
    if (['image', 'transclusion_ref', 'self_ref', 'footnote'].includes(node.type.name)) blank = false;
    if (node.type.name === 'flow_workbook') {
      try {
        const book = parseFlow(String(node.attrs['data']), 0);
        if (book.sheets.some(s => s.rows.some(r => r.cells.some(c => c.text.trim()) || r.prep?.text.trim()))) blank = false;
      } catch { blank = false; }
      return false;
    }
    return undefined;
  });
  return blank;
}

export function prepInventoryChanged(): void {
  if (!api || !adapter) return;
  const docs = adapter.documents();
  const focused = adapter.focused();
  prepRuntime.focused = focused;
  api.inventory(docs.map(d => d.uid), focused);
  const nextDocs = new Map(docs.map(d => [d.uid, d.name]));
  if (prepRuntime.status.session) {
    for (const [uid, name] of nextDocs) if (!lastDocs.has(uid)) record('document-opened', uid, { name });
    for (const uid of lastDocs.keys()) if (!nextDocs.has(uid)) record('document-closed', uid, {});
  }
  lastDocs = nextDocs;
  for (const [uid, view] of prepRuntime.views) {
    const on = prepDoc(uid);
    view.dom.classList.toggle('pmd-prep-document', on);
    view.dom.closest('.pmd-pane')?.classList.toggle('pmd-prep-pane', on);
  }
  document.body.classList.toggle('pmd-prep-single', !document.body.classList.contains('pmd-multi-doc') && prepDoc(focused));
}
function update(status: PrepStatus): void {
  const id = status.session?.sessionId ?? null;
  if (id !== lastSessionId) { lastSessionId = id; localNewDocs.clear(); }
  const failedNow = !!status.error && !prepRuntime.status.error;
  prepRuntime.status = status;
  document.body.classList.toggle('pmd-round-mode', status.session?.mode === 'round');
  document.body.classList.toggle('pmd-prep-paused', !!status.error);
  render(); prepInventoryChanged();
  if (failedNow && adapter) void adapter.endCollaboration(false).catch(() => {});
}
function record(kind: string, uid: string | null, data: unknown): void {
  if (!prepRuntime.status.session) return;
  queue.push({ kind, uid, data });
  if (queue.length >= 200) void flush();
}
async function flush(): Promise<void> {
  if (!api || !queue.length) return writes;
  const batch = queue.splice(0, 2000);
  writes = writes.then(() => api!.events(batch)).catch(error => {
    update({ ...prepRuntime.status, error: `Typing log failed: ${String(error)}` });
    throw error;
  });
  return writes;
}
export async function prepFlush(): Promise<void> { await flush(); }
export async function copyPrepInvite(code: string): Promise<boolean> {
  if (!api) return false;
  try { return await api.action('copy-invite', code) === true; } catch { return false; }
}
export async function prepCreated(uid: string): Promise<void> {
  await Promise.resolve(); // callers finish pushing the record / hiding Home first
  if (!adapter?.documents().some(d => d.uid === uid)) return;
  localNewDocs.add(uid);
  if (!api || !prepRuntime.status.session) return;
  prepInventoryChanged();
  await api.action('created', uid);
  if (prepRuntime.status.session?.mode === 'round' && adapter) {
    await api.action('bind', { uid, persistentId: adapter.identity(uid) });
  }
}
export function prepOpened(uid: string, name: string): void { record('document-opened', uid, { name }); prepInventoryChanged(); }
export function prepClosed(uid: string): void { record('document-closed', uid, {}); prepInventoryChanged(); }
export function prepSaved(uid: string, name: string): void { record('document-saved', uid, { name }); }
export async function prepMarkCreated(uid: string): Promise<void> {
  prepRuntime.pending.add(uid);
  try {
    await Promise.resolve(); prepInventoryChanged();
    localNewDocs.add(uid);
    if (api) { await api.action('created-prep', uid); update(await api.ready()); }
    if (api && adapter) { await api.action('bind', { uid, persistentId: adapter.identity(uid) }); update(await api.ready()); }
  } catch (error) {
    update({ ...prepRuntime.status, error: `Could not protect the new prep document: ${String(error)}` });
    throw error;
  } finally { prepRuntime.pending.delete(uid); prepInventoryChanged(); }
}
export function prepRestoreIdentity(uid: string, persistentId: string | null | undefined): Promise<void> {
  if (!persistentId || !Object.hasOwn(prepRuntime.status.session?.persistentDocIds ?? {}, persistentId)) return Promise.resolve();
  prepRuntime.pending.add(uid);
  return Promise.resolve().then(async () => {
    prepInventoryChanged();
    if (api) { await api.action('restore', { uid, persistentId }); update(await api.ready()); }
  }).catch(error => {
    update({ ...prepRuntime.status, error: `Could not restore prep protection: ${String(error)}` });
  }).finally(() => { prepRuntime.pending.delete(uid); prepInventoryChanged(); });
}
export async function prepCreateBlank(doc: PMNode): Promise<void> {
  if (!adapter) return;
  const uid = await adapter.create(doc);
  if (uid) await prepMarkCreated(uid);
}

async function action(name: string, uid?: string): Promise<void> {
  if (!api) { showToast('Prep / Round Modes require the desktop app.'); return; }
  await flush();
  await api.action(name, uid);
  update(await api.ready());
}
export async function runPrepCommand(command: 'startPrep' | 'newPrep' | 'newPrepFlow' | 'markPrep' | 'startRound' | 'endPrep' | 'prepLogs'): Promise<void> {
  if (!api || !adapter) { showToast('Prep / Round Modes require the desktop app.'); return; }
  if (busy) return;
  busy = true;
  try {
    if (command === 'prepLogs') { await openLogs(); return; }
    if (prepRuntime.status.transitioning) throw new Error('A mode transition is already in progress.');
    if (command === 'startPrep') {
      if (await confirmDialog('New prep documents will block clipboard and drag transfers. Their typing stays in a local log until you export it. Other documents stay unrestricted during Prep Mode.', { title: 'Start Prep Mode?', okLabel: 'Start Prep' })) await action('start');
    } else if (command === 'newPrep' || command === 'newPrepFlow') {
      if (prepRuntime.status.session?.mode !== 'prep') throw new Error('Start Prep Mode first.');
      const doc = command === 'newPrepFlow' ? schema.nodes.doc!.create(null, [schema.nodes.flow_workbook!.create({ data: serializeFlow(newWorkbook('npda')) }), schema.nodes.paragraph!.create()]) : undefined;
      const uid = await adapter.create(doc);
      if (uid) await prepMarkCreated(uid);
    } else if (command === 'markPrep') {
      const uid = adapter.focused();
      if (!uid || !localNewDocs.has(uid)) throw new Error('Only new documents created during this Prep session can be marked. Use New Prep Document.');
      if (adapter.hasCollaboration(uid)) throw new Error('End this document’s co-editing session before marking it as prep.');
      const view = prepRuntime.views.get(uid);
      if (!view || !isBlankPrepCandidate(view.state.doc)) throw new Error('A document must still be blank to become a prep document. Use New Prep Document before typing so the entire history is logged.');
      await action('mark', uid);
      await api.action('bind', { uid, persistentId: adapter.identity(uid) });
    } else if (command === 'startRound') {
      if (await confirmDialog('All co-editing will stop. Every non-prep document will close with a save prompt, and existing files cannot be opened. New blank documents remain allowed.', { title: 'Start Round Mode?', okLabel: 'Start Round' })) await action('round');
    } else {
      if (!(await confirmDialog('This ends document restrictions and seals the typing log. Prep co-editing sessions will disconnect first.', { title: 'End Prep / Round session?', okLabel: 'End Session' }))) return;
      await flush();
      const result = await api.action('end') as { state: { prepStartedAt: string; roundStartedAt: string | null; endedAt: string }; sealCode: string; finalHash: string };
      update(await api.ready());
      await alertDialog(`Prep started: ${new Date(result.state.prepStartedAt).toLocaleString()}\nRound started: ${result.state.roundStartedAt ? new Date(result.state.roundStartedAt).toLocaleString() : 'Not started'}\nEnded: ${new Date(result.state.endedAt).toLocaleString()}\n\nSeal code: ${result.sealCode}\nFinal SHA-256: ${result.finalHash}\n\nHave the judge record the seal independently. The local log can be edited by someone controlling this computer; its chain alone does not prove authenticity.`);
    }
  } catch (error) { await alertDialog(error instanceof Error ? error.message : String(error)); }
  finally { busy = false; render(); }
}
function render(): void {
  if (!bar) return;
  const s = prepRuntime.status;
  const signature = JSON.stringify([s.error, s.transitioning, s.session?.sessionId, s.session?.mode, busy,
    s.session ? Math.floor((Date.now() - Date.parse(s.session.prepStartedAt)) / 60000) : 0]);
  if (signature === rendered) return;
  rendered = signature;
  bar.replaceChildren();
  const label = document.createElement('strong');
  label.textContent = s.error ?? (s.transitioning ? 'Changing mode — finish save prompts in each window' : s.session ? `${s.session.mode === 'round' ? 'Round' : 'Prep'} Mode · ${Math.floor((Date.now() - Date.parse(s.session.prepStartedAt)) / 60000)} min` : 'Prep / Round');
  bar.append(label);
  const commands: Array<[string, Parameters<typeof runPrepCommand>[0]]> = s.session ?
    [...(s.session.mode === 'prep' ? [['New prep doc', 'newPrep'], ['New prep flow', 'newPrepFlow'], ['Mark as prep', 'markPrep'], ['Start Round', 'startRound']] as Array<[string, Parameters<typeof runPrepCommand>[0]]> : []), ['End session', 'endPrep'], ['Logs', 'prepLogs']] : [['Start Prep', 'startPrep'], ['Logs', 'prepLogs']];
  for (const [text, command] of commands) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.disabled = busy || s.transitioning || (!!s.error && command !== 'prepLogs');
    button.addEventListener('click', () => void runPrepCommand(command)); bar.append(button);
  }
  bar.dataset['mode'] = s.session?.mode ?? '';
}

async function openLogs(): Promise<void> {
  const logs = await api!.logs();
  const overlay = document.createElement('div'); overlay.className = 'pmd-prep-log-overlay';
  const panel = document.createElement('section'); panel.className = 'pmd-prep-log-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  const heading = document.createElement('h2'); heading.textContent = 'Prep / Round typing logs'; panel.append(heading);
  const note = document.createElement('p'); note.textContent = 'Logs include prep-document text. They stay on this computer unless exported. Compare a completed log’s seal with the code recorded independently by the judge.'; panel.append(note);
  const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => { overlay.remove(); document.removeEventListener('keydown', escape); }; panel.append(close);
  const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close.click(); } };
  document.addEventListener('keydown', escape);
  const detail = document.createElement('pre');
  const statistics = document.createElement('p');
  const filter = document.createElement('input'); filter.placeholder = 'Filter displayed events';
  let full = '';
  for (const log of logs) {
    const row = document.createElement('div'); row.className = 'pmd-prep-log-row';
    const text = document.createElement('span'); text.textContent = log.valid ? `${log.start ? new Date(log.start).toLocaleString() : log.id} · ${log.end ? 'Ended ' + new Date(log.end).toLocaleTimeString() : 'Active / unsealed'} · ${log.events} events · ${log.blocked} blocked · ${log.end ? log.sealCode : 'No final seal'}` : `${log.id} · Chain verification FAILED`;
    row.append(text);
    const inspect = document.createElement('button'); inspect.textContent = 'View'; inspect.onclick = () => void api!.readLog(log.id).then(value => {
      full = value; filter.value = ''; detail.textContent = value;
      statistics.textContent = `Duration: ${log.start ? Math.round(((log.end ? Date.parse(log.end) : Date.now()) - Date.parse(log.start)) / 1000) : '?'} seconds. Round started: ${log.round ? new Date(log.round).toLocaleString() : 'Not started'}. Typed: ${log.characters ?? 0} characters. Flagged inserts/restores: ${log.flagged ?? 0}. Time outside app (focus events): ${Math.round((log.outsideMs ?? 0) / 1000)} seconds. Typing by minute (5 chars/word): ${log.typingByMinute?.map(m => `${m.minute + 1}: ${m.wpm} wpm`).join('; ') || 'No typing'}.`;
    }).catch(e => showToast(String(e)));
    const download = document.createElement('button'); download.textContent = 'Export'; download.onclick = () => void api!.exportLog(log.id).catch(e => showToast(String(e)));
    row.append(inspect, download); panel.append(row);
  }
  if (!logs.length) panel.append('No session logs yet.');
  filter.oninput = () => { detail.textContent = full.split('\n').filter(line => line.toLowerCase().includes(filter.value.toLowerCase())).join('\n'); };
  panel.append(statistics, filter, detail); overlay.append(panel); document.body.append(overlay); close.focus();
}

export async function initPrepController(hostAdapter: PrepAdapter): Promise<void> {
  adapter = hostAdapter;
  api = (window as unknown as { electronAPI?: { prep?: PrepApi } }).electronAPI?.prep;
  if (!api) return;
  prepRuntime.record = record;
  prepRuntime.changed = () => queueMicrotask(prepInventoryChanged);
  configurePrepGuards({ isPrepDocument: uid => prepDoc(uid) || prepRuntime.status.session?.mode === 'round' || !!prepRuntime.status.error,
    loggingFailed: () => !!prepRuntime.status.error,
    notify: showToast,
    audit(uid, event) { const kind = event.kind === 'change' ? 'input' : event.kind === 'remote-change' ? 'remote-insert' : event.kind === 'undo-redo' ? 'undo' : event.kind;
      record(kind, uid, { ...event, phase: 'transaction', clientTime: new Date().toISOString(),
        ...(event.kind === 'remote-change' ? { partners: collabCopresenceFor(uid)?.peers.filter(p => !p.self).map(p => p.name) ?? [] } : {}) }); },
  });
  api.onState(update);
  api.onPrepare(req => void (async () => {
    let ok = false;
    try {
      ok = await adapter!.endCollaboration(req.action === 'end');
      if (ok && req.action === 'round') ok = await adapter!.closeNonPrep();
      await flush(); prepInventoryChanged();
    } catch (error) { showToast(String(error)); }
    api!.prepared(req.requestId, ok);
  })());
  bar = document.createElement('div'); bar.className = 'pmd-prep-bar'; bar.setAttribute('aria-label', 'Prep and Round Modes'); document.body.append(bar);
  try { update(await api.ready()); } catch (error) { update({ session: null, transitioning: false, error: String(error) }); }
  setInterval(() => { void flush().catch(() => {}); render(); prepInventoryChanged(); }, 500);
  // Direct Clipboard API calls (read-mode copy, cite/reference commands, etc.)
  // do not fire DOM clipboard events. Keep the focused document sticky while
  // toolbar/dialog buttons are used, so those paths cannot bypass protection.
  if (navigator.clipboard) for (const name of ['read', 'readText', 'write', 'writeText'] as const) {
    const original = navigator.clipboard[name]?.bind(navigator.clipboard);
    if (!original) continue;
    Object.defineProperty(navigator.clipboard, name, { configurable: true, value: (...args: unknown[]) => {
      if (prepTransferBlocked(adapter!.focused(), `clipboard.${name}`)) return Promise.reject(new Error('Prep document: clipboard is blocked.'));
      return (original as (...values: unknown[]) => unknown)(...args);
    } });
  }
}

export function prepOpenAllowed(): boolean {
  if (!prepRound()) return true;
  record('blocked', adapter?.focused() ?? null, { reason: 'open-existing-file' });
  showToast('Round Mode: opening existing files is blocked.'); return false;
}
