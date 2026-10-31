import { configurePrepGuards } from './prep-document-guard.js';
import { createPrepLogReport, formatPrepTimeRange, prepReportSummary, type PrepLogReport } from '../../apps/desktop/src/prep-log-report.js';
import { prepDoc, prepRound, prepRuntime, prepTransferBlocked, type PrepStatus } from './prep-runtime.js';
import { confirmDialog, alertDialog, promptForText } from './text-prompt.js';
import { prepFingerprint } from './prep-fingerprint.js';
import { prepSealFor, setPrepSeal } from '../native/index.js';
import { showToast } from './toast.js';
import { newWorkbook, serializeFlow, parseFlow } from '../flow/flow-model.js';
import { schema } from '../schema/index.js';
import { collabCopresenceFor } from './collab/collab-hooks.js';
import { settings } from './settings.js';
import type { Node as PMNode } from 'prosemirror-model';

export interface PrepAdapter {
  documents(): Array<{ uid: string; name: string }>;
  focused(): string | null;
  create(doc?: PMNode): Promise<string | null>;
  closeNonPrep(): Promise<boolean>;
  /** round: keep Co-Flowing prep docs; end: prep docs only; failure: everything. */
  endCollaboration(action: 'round' | 'end' | 'failure'): Promise<boolean>;
  hasCollaboration(uid: string): boolean;
  identity(uid: string): string;
}
export interface Audit { kind: string; uid: string | null; data: unknown }
export interface PrepDocFingerprint { document: string; persistentId: string | null; name: string; fingerprint: string }
interface SealCheck { status: 'unchanged' | 'modified' | 'wrong-code' | 'damaged' | 'not-in-seal'; prepStartedAt?: string; roundStartedAt?: string | null; endedAt?: string; name?: string; sealCode?: string }
interface LogSummary { id: string; valid: boolean; start?: string; end?: string | null; round?: string | null; finalHash?: string; sealCode?: string; events?: number; blocked?: number;
  characters?: number; outsideMs?: number; flagged?: number; typingByMinute?: Array<{ minute: number; characters: number; wpm: number }> }
export interface PrepApi {
  ready(): Promise<PrepStatus>;
  action(action: string, uid?: string | { uid: string; persistentId: string }): Promise<unknown>;
  inventory(docs: string[], focused: string | null): void;
  events(events: Audit[]): Promise<void>;
  logs(): Promise<LogSummary[]>;
  readLog(id: string): Promise<string>;
  exportLog(id: string, format?: 'raw' | 'readable', timeZone?: string): Promise<boolean>;
  prepared(requestId: string, ok: boolean, fingerprints?: PrepDocFingerprint[]): void;
  checkSeal?(payload: { certificate: unknown; code: string; persistentId: string | null; fingerprint: string }): Promise<SealCheck>;
  onSealed?(fn: (sealed: { certificate: unknown; persistentIds: string[] }) => void): () => void;
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
  if (failedNow && adapter) void adapter.endCollaboration('failure').catch(() => {});
}
function record(kind: string, uid: string | null, data: unknown): void {
  if (!prepRuntime.status.session) return;
  queue.push({ kind, uid, data });
  if (queue.length >= 200) void flush().catch(() => {});
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
export async function runPrepCommand(command: 'startPrep' | 'newPrep' | 'newPrepFlow' | 'markPrep' | 'startRound' | 'endPrep' | 'prepLogs' | 'checkPrepDoc'): Promise<void> {
  if (!api || !adapter) { showToast('Prep / Round Modes require the desktop app.'); return; }
  if (busy) return;
  busy = true;
  try {
    if (command === 'prepLogs') { await openLogs(); return; }
    if (command === 'checkPrepDoc') { await checkPrepDocument(); return; }
    if (prepRuntime.status.transitioning) throw new Error('A mode transition is already in progress.');
    if (command === 'startPrep') {
      const browser = (await import('./host/index.js')).getHost().kind === 'browser';
      if (await confirmDialog('New prep documents block copy, paste and outside drag transfers. Their typing stays in a local log until you export it. Strategy documents stay unrestricted during Prep.\n\n' + (browser ? 'iPad/browser session: use one Green workspace at a time. Logs stay in this browser; export copies before clearing website data. ' : '') + 'This records activity inside CardMirror only. Other apps, devices and outside help are not monitored.', { title: 'Start Prep Mode?', okLabel: 'Start Prep' })) await action('start');
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
      const docs = adapter.documents();
      const protectedDocs = docs.filter(d => prepDoc(d.uid));
      if (!protectedDocs.length) throw new Error('Create or open a prep document before starting Round.');
      const closing = docs.filter(d => !prepDoc(d.uid));
      const coflow = settings.get('prepRoundCoflow');
      const checklist = [
        `Keep protected: ${protectedDocs.map(d => d.name).join(', ')}`,
        closing.length ? `Close with save prompts: ${closing.map(d => d.name).join(', ')}` : 'No strategy documents need closing in this workspace.',
        'Block opening existing files. New blank documents and saving remain allowed.',
        coflow ? 'Co-Flowing is selected for new shared prep sessions. Existing sessions keep the host’s chosen rule: Co-Flowing stays connected; Isolation disconnects and closes partner copies.' : 'Isolation is selected for new shared prep sessions. Existing sessions keep the host’s chosen rule: Isolation disconnects and closes partner copies; Co-Flowing stays connected.',
        'Continue the typing log. End Session is available and records when restrictions ended.',
        'Confirm that these collaboration rules match your event’s rules. This checklist does not monitor other apps or devices.',
      ].map(line => '• ' + line).join('\n\n');
      if (await confirmDialog(checklist, { title: 'Round checklist', okLabel: 'Start Round' })) await action('round');
    } else {
      if (!(await confirmDialog('This ends document restrictions and seals the typing log. Prep co-editing sessions will disconnect first.', { title: 'End Prep / Round session?', okLabel: 'End Session' }))) return;
      await flush();
      const result = await api.action('end') as { state: { prepStartedAt: string; roundStartedAt: string | null; endedAt: string }; sealCode: string; finalHash: string };
      update(await api.ready());
      await alertDialog(`Prep started: ${new Date(result.state.prepStartedAt).toLocaleString()}\nRound started: ${result.state.roundStartedAt ? new Date(result.state.roundStartedAt).toLocaleString() : 'Not started'}\nEnded: ${new Date(result.state.endedAt).toLocaleString()}\n\nSeal code: ${result.sealCode}\nFinal SHA-256: ${result.finalHash}\n\nHave the judge record the seal independently. The local log can be edited by someone controlling this computer; its chain alone does not prove authenticity.\n\nSave each prep doc as a CardMirror file (.cmir) now: the seal is stored inside it, and Check Prep Document can then tell whether it changed after the round.`);
    }
  } catch (error) { await alertDialog(error instanceof Error ? error.message : String(error)); }
  finally { busy = false; render(); }
}
/** Fingerprints of this window's open prep docs, sealed at End. */
async function openPrepFingerprints(): Promise<PrepDocFingerprint[]> {
  const out: PrepDocFingerprint[] = [];
  for (const { uid, name } of adapter!.documents()) {
    const view = prepRuntime.views.get(uid);
    if (!prepDoc(uid) || !view) continue;
    out.push({ document: uid, persistentId: adapter!.identity(uid), name, fingerprint: await prepFingerprint(view.state.doc) });
  }
  return out;
}

const CHECK_RESULTS: Record<SealCheck['status'], [string, string]> = {
  unchanged: ['Unchanged since the round', 'This document matches the copy sealed when the session ended.'],
  modified: ['Changed after the round', 'This document is different from the copy sealed when the session ended. Its text or formatting was edited afterward.'],
  'wrong-code': ['Code does not match', 'This seal code does not match the seal stored in this document. Check the code, or this is not the document that was sealed with it.'],
  damaged: ['Seal damaged', 'The seal stored in this document has been altered or is unreadable, so it cannot be checked.'],
  'not-in-seal': ['Not in this seal', 'The seal code matches, but this document was not one of the prep docs sealed in that session.'],
};

/** Check Prep Document: compare the focused document with the seal stored
 *  in its file, using the seal code the judge wrote down. */
async function checkPrepDocument(): Promise<void> {
  const uid = adapter!.focused();
  const view = uid ? prepRuntime.views.get(uid) : undefined;
  if (!uid || !view) throw new Error('Open the prep document (.cmir) you want to check, click into it, then run Check Prep Document again.');
  const persistentId = adapter!.identity(uid);
  const certificate = prepSealFor(persistentId);
  if (certificate === undefined) {
    throw new Error('This document has no prep seal. A seal is stored when a prep doc is saved as a CardMirror file (.cmir) after its Prep / Round session ends. Word (.docx) copies do not carry it.');
  }
  if (!api!.checkSeal) throw new Error('This version cannot check prep seals.');
  const code = await promptForText({ message: 'Enter the seal code shown when the session ended (16 characters, e.g. 7F3A-91C2-0B4D-E8A1).', placeholder: 'XXXX-XXXX-XXXX-XXXX', okLabel: 'Check' });
  if (!code) return;
  const result = await api!.checkSeal({ certificate, code, persistentId, fingerprint: await prepFingerprint(view.state.doc) });
  const [title, detail] = CHECK_RESULTS[result.status];
  const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : 'Not started');
  const times = result.endedAt ? `\n\nPrep started: ${when(result.prepStartedAt)}\nRound started: ${when(result.roundStartedAt)}\nEnded: ${when(result.endedAt)}` : '';
  await alertDialog(`${detail}${result.name ? `\n\nSealed as: ${result.name}` : ''}${times}`, { title });
}

function render(): void {
  if (!bar) return;
  const s = prepRuntime.status;
  const signature = JSON.stringify([s.error, s.transitioning, s.session?.sessionId, s.session?.mode, busy,
    s.session ? Math.floor((Date.now() - Date.parse(s.session.prepStartedAt)) / 60000) : 0]);
  if (signature === rendered) return;
  rendered = signature;
  const wasOpen = bar.querySelector('details')?.open ?? false;
  bar.replaceChildren();
  const menu = document.createElement('details'); menu.open = wasOpen;
  const label = document.createElement('summary');
  label.textContent = s.error ?? (s.transitioning ? 'Changing mode — finish save prompts in each window' : s.session ? `${s.session.mode === 'round' ? 'Round' : 'Prep'} Mode · ${Math.floor((Date.now() - Date.parse(s.session.prepStartedAt)) / 60000)} min` : 'Prep / Round');
  label.title = label.textContent;
  menu.append(label);
  const actions = document.createElement('div'); actions.className = 'pmd-prep-actions';
  actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Prep and Round actions');
  const commands: Array<[string, Parameters<typeof runPrepCommand>[0]]> = s.session ?
    [...(s.session.mode === 'prep' ? [['New prep doc', 'newPrep'], ['New prep flow', 'newPrepFlow'], ['Mark as prep', 'markPrep'], ['Start Round', 'startRound']] as Array<[string, Parameters<typeof runPrepCommand>[0]]> : []), ['End session', 'endPrep'], ['Logs', 'prepLogs']] : [['Start Prep', 'startPrep'], ['Logs', 'prepLogs'], ['Check prep doc', 'checkPrepDoc']];
  for (const [text, command] of commands) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.disabled = busy || s.transitioning || (!!s.error && command !== 'prepLogs');
    button.addEventListener('click', () => { menu.open = false; void runPrepCommand(command); }); actions.append(button);
  }
  menu.append(actions); bar.append(menu);
  bar.dataset['mode'] = s.session?.mode ?? '';
  bar.dataset['error'] = String(!!s.error);
}

async function openLogs(): Promise<void> {
  const logs = await api!.logs();
  const overlay = document.createElement('div'); overlay.className = 'pmd-prep-log-overlay';
  const panel = document.createElement('section'); panel.className = 'pmd-prep-log-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  const heading = document.createElement('h2'); heading.textContent = 'Prep / Round typing logs'; panel.append(heading);
  const note = document.createElement('p'); note.textContent = 'Logs include prep-document text and timestamps. Typed, paste attempts and partner edits are listed separately; an unconfirmed insertion is not proof of cheating. Logs stay on this device unless exported. Compare the final seal with the code recorded independently by the judge. Other apps and devices are not monitored.'; panel.append(note);
  const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => { overlay.remove(); document.removeEventListener('keydown', escape); }; panel.append(close);
  const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close.click(); } };
  document.addEventListener('keydown', escape);
  const detail = document.createElement('pre');
  const statistics = document.createElement('p');
  const filter = document.createElement('input'); filter.placeholder = 'Filter displayed events';
  const timeline = document.createElement('div');
  const technical = document.createElement('details');
  const title = document.createElement('summary'); title.textContent = 'Technical audit (raw JSONL)'; technical.append(title, detail);
  let report: PrepLogReport | undefined;
  const redraw = (): void => {
    timeline.replaceChildren(); if (!report) return;
    const table = document.createElement('table'); table.className = 'pmd-prep-timeline';
    const header = table.createTHead().insertRow();
    for (const label of ['Time', 'Document', 'Action', 'Text / result']) { const th = document.createElement('th'); th.textContent = label; header.append(th); }
    const body = table.createTBody();
    for (const event of report.rows) {
      const cells = [formatPrepTimeRange(event, report.timeZone), event.document, event.action + (event.flagged ? ' [flagged]' : ''), event.text];
      if (!cells.join(' ').toLowerCase().includes(filter.value.toLowerCase())) continue;
      const tr = body.insertRow(); for (const value of cells) tr.insertCell().textContent = value;
    }
    timeline.append(table);
  };
  for (const log of logs) {
    const row = document.createElement('div'); row.className = 'pmd-prep-log-row';
    const text = document.createElement('span'); text.textContent = log.valid ? `${log.start ? new Date(log.start).toLocaleString() : log.id} · ${log.end ? 'Ended ' + new Date(log.end).toLocaleTimeString() : 'Active / unsealed'} · ${log.events} events · ${log.blocked} blocked · ${log.end ? log.sealCode : 'No final seal'}` : `${log.id} · Chain verification FAILED`;
    row.append(text);
    const inspect = document.createElement('button'); inspect.textContent = 'View'; inspect.onclick = () => void api!.readLog(log.id).then(value => {
      filter.value = ''; detail.textContent = value;
      report = createPrepLogReport(value, { chainValid: log.valid, sealCode: log.sealCode });
      statistics.textContent = prepReportSummary(report) + '. Time zone: ' + report.timeZone + '. Audit chain: ' + (log.valid ? 'verified' : 'FAILED verification') + '. Nearby typing is grouped. Blocked attempts did not complete a transfer.';
      redraw();
    }).catch(e => showToast(String(e)));
    const download = document.createElement('button'); download.textContent = 'Export readable'; download.onclick = () => void api!.exportLog(log.id, 'readable', Intl.DateTimeFormat().resolvedOptions().timeZone).catch(e => showToast(String(e)));
    const raw = document.createElement('button'); raw.textContent = 'Export raw JSONL'; raw.onclick = () => void api!.exportLog(log.id, 'raw').catch(e => showToast(String(e)));
    row.append(inspect, download, raw); panel.append(row);
  }
  if (!logs.length) panel.append('No session logs yet.');
  filter.oninput = redraw;
  panel.append(statistics, filter, timeline, technical); overlay.append(panel); document.body.append(overlay); close.focus();
}

export async function initPrepController(hostAdapter: PrepAdapter): Promise<void> {
  adapter = hostAdapter;
  api = (window as unknown as { electronAPI?: { prep?: PrepApi } }).electronAPI?.prep;
  if (!api && (await import('./host/index.js')).getHost().kind === 'browser' &&
      (await import('./mobile-layout.js')).mobileLayoutEnv('browser').tablet) {
    api = await (await import('./prep-browser.js')).createBrowserPrepApi();
  }
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
  api.onSealed?.(sealed => { for (const id of sealed.persistentIds) setPrepSeal(id, sealed.certificate); });
  api.onPrepare(req => void (async () => {
    let ok = false;
    let fingerprints: PrepDocFingerprint[] = [];
    try {
      ok = await adapter!.endCollaboration(req.action);
      if (ok && req.action === 'round') ok = await adapter!.closeNonPrep();
      await flush(); prepInventoryChanged();
      if (ok && req.action === 'end') fingerprints = await openPrepFingerprints();
    } catch (error) { ok = false; showToast(String(error)); }
    api!.prepared(req.requestId, ok, fingerprints);
  })());
  bar = document.createElement('div'); bar.className = 'pmd-prep-bar'; bar.setAttribute('aria-label', 'Prep and Round Modes'); const statusBar = document.getElementById('status-bar');
  statusBar?.insertBefore(bar, statusBar.querySelector('.zoom-controls'));
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !bar?.contains(event.target)) { const menu = bar?.querySelector('details'); if (menu) menu.open = false; }
  });
  document.addEventListener('keydown', event => {
    const menu = bar?.querySelector('details');
    if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary')?.focus(); event.stopPropagation(); }
  });
  try { update(await api.ready()); } catch (error) { update({ session: null, transitioning: false, error: String(error) }); }
  setInterval(() => { void flush().catch(() => {}); render(); prepInventoryChanged(); }, 500);
  // Best effort before iPad suspension. Sudden termination can still lose the
  // final uncommitted batch; exports must never claim uninterrupted monitoring.
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush().catch(() => {}); });
  window.addEventListener('pagehide', () => { void flush().catch(() => {}); });
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
