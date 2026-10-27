/** Desktop owner and native boundary for Prep / Round sessions. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrepSession, verifyPrepLog, type PrepSessionState } from './prep-session.js';
import { createPrepLogReport, exportPrepLogReport } from './prep-log-report.js';

export interface PrepStatus { session: PrepSessionState | null; transitioning: boolean; error: string | null }
let owner: PrepSession | null = null;
let error: string | null = null;
let transitioning = false;
const windows = new Map<number, { win: BrowserWindow; ready: boolean; docs: Set<string>; focused: string | null }>();
const waiters = new Map<string, { sender: number; resolve: (ok: boolean) => void }>();
let onRound: (() => void) | null = null;

function service(): PrepSession {
  if (error) throw new Error(error);
  try { return owner ??= new PrepSession(app.getPath('userData')); }
  catch (e) { error = `Prep log unavailable: ${e instanceof Error ? e.message : e}`; broadcast(); throw new Error(error); }
}
export function prepStatus(): PrepStatus {
  try { service(); } catch { /* published as a blocking error */ }
  return { session: owner?.snapshot() ?? null, transitioning, error };
}
function broadcast(): void {
  const status = { session: owner?.snapshot() ?? null, transitioning, error };
  for (const { win } of windows.values()) if (!win.isDestroyed()) win.webContents.send('prep:state', status);
}
function run<T>(fn: () => T): T {
  try { const value = fn(); broadcast(); return value; }
  catch (e) { if (owner?.loggingFailed) error = 'The typing log could not be written. Editing is paused; restart to recover.'; broadcast(); throw e; }
}
export function trackPrepWindow(win: BrowserWindow): void {
  const sender = win.webContents.id; // webContents is no longer accessible after closed
  windows.set(sender, { win, ready: false, docs: new Set(), focused: null });
  win.on('closed', () => windows.delete(sender));
  win.on('focus', () => audit('focus', {}, sender));
  win.on('blur', () => audit('blur', {}, sender));
}
function audit(kind: Parameters<PrepSession['record']>[0], data: unknown, sender: number, uid: string | null = null): void {
  if (!owner?.snapshot() || error) return;
  run(() => owner!.record(kind, data, windows.get(sender)?.win.id ?? 1, uid));
}
export function prepIsProtected(uid: string | null | undefined): boolean {
  return !!uid && !!prepStatus().session?.prepDocIds.includes(uid);
}
export function prepNativeRefusal(sender: number, action: string, uid?: string | null): void {
  const state = prepStatus();
  const focused = uid ?? windows.get(sender)?.focused;
  const restricted = action === 'open' ? state.session?.mode === 'round' || transitioning : prepIsProtected(focused);
  if (state.error || restricted) {
    audit('blocked', { action }, sender, focused ?? null);
    throw new Error(state.error ?? (action === 'open' ? 'Round Mode: opening existing files is blocked.' : 'Prep document: this transfer is blocked.'));
  }
}
export function prepExternalAllowed(sender: number, uid?: string | null): boolean {
  try { prepNativeRefusal(sender, 'transfer', uid); return true; } catch { return false; }
}

const roundReadChannels = new Set([
  'host:open-file', 'host:open-files', 'host:pick-file', 'host:pick-directory', 'host:read-file-at-path',
  'host:read-cmir-file', 'host:resolve-cmir-path', 'host:cardcutter-read', 'host:cardcutter-pick-file',
  'host:pick-history-file', 'host:history-read', 'host:read-history', 'host:list-history',
  'host:list-directory', 'host:browse-directory', 'host:bulk-clean', 'host:bulk-convert', 'host:bulk-compress',
  'host:list-files-recursive', 'host:quick-cards-list', 'host:dropzone-list', 'host:open-path-check',
  'host:plugin-pick-file', 'host:plugin-read-file', 'host:flow-pull', 'host:flow-create',
]);
const transferChannels = new Set(['host:clipboard-read-text', 'host:clipboard-read-html', 'host:clipboard-write-html',
  'host:voice-clipboard', 'host:flow-send', 'host:flow-pull', 'host:flow-post', 'host:dropzone-add',
  'host:quick-cards-upsert', 'host:quick-cards-bulk-upsert', 'host:pairing-send']);

/** Every guarded handler rechecks after asynchronous reads, so an Open started
 * just before Round Mode cannot deliver its bytes after the transition. */
export const prepHandle: typeof ipcMain.handle = (channel, listener) => {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const sourceUid = windows.get(event.sender.id)?.focused ?? null;
    const check = (): void => {
      if (roundReadChannels.has(channel) || channel === 'host:opencaselist' && args[0] !== 'status' && args[0] !== 'logout') prepNativeRefusal(event.sender.id, 'open');
      if (transferChannels.has(channel)) prepNativeRefusal(event.sender.id, 'transfer');
      if (channel === 'host:spawn-window' && args[0]) {
        const payload = args[0] as { uid?: string; prepBlank?: boolean };
        if (!payload.prepBlank && !prepIsProtected(payload.uid)) prepNativeRefusal(event.sender.id, 'open');
        if (!payload.prepBlank && prepIsProtected(windows.get(event.sender.id)?.focused) && !prepIsProtected(payload.uid)) prepNativeRefusal(event.sender.id, 'transfer');
      }
      if (channel === 'host:spawn-window' && transitioning) throw new Error('Wait for the mode transition to finish.');
      if (channel === 'host:speech-send-slice') {
        const payload = args[0] as { targetUid?: string };
        prepNativeRefusal(event.sender.id, 'transfer');
        if (prepIsProtected(payload?.targetUid)) prepNativeRefusal(event.sender.id, 'transfer', payload.targetUid);
      }
    };
    check();
    const value = await listener(event, ...args);
    if (['host:save-as', 'host:save-existing', 'host:save-conflicted-copy'].includes(channel) && (value || channel === 'host:save-existing')) {
      audit('document-saved', { operation: channel }, event.sender.id, sourceUid);
    }
    // Recheck reads only; repeating a clipboard check after a completed write
    // would report a refusal even though the transfer already happened.
    if (roundReadChannels.has(channel) || channel === 'host:opencaselist') check();
    if (channel === 'host:read-journals' && prepStatus().session?.mode === 'round' && Array.isArray(value)) {
      return value.filter((j: { uid: string }) => prepIsProtected(j.uid));
    }
    return value;
  });
};

async function prepareAll(action: 'round' | 'end'): Promise<boolean> {
  const targets = [...windows.values()].filter(w => !w.win.isDestroyed());
  if (targets.some(w => !w.ready)) throw new Error('An editor window is still loading. Try again once it is ready.');
  const results = await Promise.all(targets.map(({ win }) => new Promise<boolean>(resolve => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { waiters.delete(requestId); resolve(false); }, 180_000);
    waiters.set(requestId, { sender: win.webContents.id, resolve: ok => { clearTimeout(timer); resolve(ok); } });
    win.webContents.send('prep:prepare', { requestId, action });
  })));
  return results.every(Boolean);
}
function assertReady(event: IpcMainInvokeEvent): NonNullable<ReturnType<typeof windows.get>> {
  const w = windows.get(event.sender.id);
  if (!w) throw new Error('Not an editor window.');
  return w;
}
function validUid(id: unknown): asserts id is string { if (typeof id !== 'string' || !id || id.length > 150) throw new Error('Invalid document identity.'); }
function readLog(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid log identity.');
  return readFileSync(join(app.getPath('userData'), 'lockdown', `${id}.jsonl`), 'utf8');
}
export function registerPrepDesktop(roundCallback: () => void): void {
  onRound = roundCallback;
  ipcMain.on('prep:inventory', (e, payload: { docs: string[]; focused: string | null }) => {
    const w = windows.get(e.sender.id); if (!w || !Array.isArray(payload?.docs)) return;
    w.docs = new Set(payload.docs.filter(id => typeof id === 'string' && id.length <= 150));
    w.focused = w.docs.has(payload.focused ?? '') ? payload.focused : null;
  });
  ipcMain.on('prep:prepared', (e, payload: { requestId: string; ok: boolean }) => {
    const pending = waiters.get(payload?.requestId);
    if (!pending || pending.sender !== e.sender.id) return;
    waiters.delete(payload.requestId); pending.resolve(payload.ok === true);
  });
  ipcMain.handle('prep:ready', e => { assertReady(e).ready = true; return prepStatus(); });
  ipcMain.handle('prep:action', async (e, action: string, uid?: unknown) => {
    const w = assertReady(e);
    if (transitioning) throw new Error('A mode transition is already in progress.');
    if (action === 'copy-invite') {
      if (typeof uid !== 'string' || !/^(?:cmshare3|cmview2)\.[0-9a-f]{16,64}\.[A-Za-z0-9_-]{43}\.\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(uid)) throw new Error('Only a Green prep session code can be copied here.');
      clipboard.writeText(uid); return true;
    }
    if (action === 'start') return run(() => { service().start(); return prepStatus(); });
    if (action === 'bind' || action === 'restore') {
      const payload = uid as { uid: string; persistentId: string };
      validUid(payload?.uid); validUid(payload?.persistentId);
      if (!w.docs.has(payload.uid)) throw new Error('Document is not in this window.');
      return run(() => {
        if (action === 'bind') service().bindIdentity(payload.uid, payload.persistentId, w.win.id);
        else service().restoreIdentity(payload.uid, payload.persistentId, w.win.id);
        return prepStatus();
      });
    }
    if (action === 'created' || action === 'created-prep') {
      validUid(uid); if (!w.docs.has(uid)) throw new Error('Document is not in this window.');
      if (service().snapshot() && !service().snapshot()!.newDocIds.includes(uid)) run(() => service().documentCreated(uid, w.win.id));
      if (action === 'created-prep' && service().snapshot()?.mode === 'prep' && !prepIsProtected(uid)) run(() => service().markPrepDocument(uid, w.win.id));
      return prepStatus();
    }
    if (action === 'mark') {
      validUid(uid); if (!w.docs.has(uid)) throw new Error('Document is not in this window.');
      return run(() => { service().markPrepDocument(uid, w.win.id); return prepStatus(); });
    }
    if (action !== 'round' && action !== 'end') throw new Error('Unknown Prep action.');
    if (!service().snapshot()) throw new Error('Start Prep Mode first.');
    transitioning = true; broadcast();
    try {
      if (!(await prepareAll(action))) throw new Error('Mode change canceled. Prep Mode remains active; documents already closed stay closed.');
      if (action === 'round') {
        for (const w of windows.values()) if ([...w.docs].some(id => !prepIsProtected(id))) throw new Error('A non-prep document is still open. Close it and try again.');
        run(() => service().startRound()); onRound?.();
        return prepStatus();
      }
      return run(() => service().end());
    } finally { transitioning = false; broadcast(); }
  });
  ipcMain.handle('prep:events', (e, events: Array<{ kind: Parameters<PrepSession['record']>[0]; uid: string | null; data: unknown }>) => {
    const w = assertReady(e);
    if (!Array.isArray(events) || events.length > 2000) throw new Error('Invalid audit batch.');
    return run(() => {
      for (const event of events) {
        if (!['input', 'macro', 'autocorrect', 'undo', 'redo', 'blocked', 'focus', 'blur', 'document-opened', 'document-closed', 'document-saved', 'collaboration-ended', 'remote-insert', 'app-quit'].includes(event.kind)) throw new Error('Invalid audit event.');
        // Closing a non-prep doc queues its metadata event after it has left
        // inventory. Content events are independently restricted by PrepSession.
        if (event.uid && !w.docs.has(event.uid) && !prepIsProtected(event.uid) && !['document-opened', 'document-closed', 'document-saved', 'collaboration-ended', 'blocked'].includes(event.kind)) throw new Error('Unknown audit document.');
        service().record(event.kind, event.data, w.win.id, event.uid);
      }
    });
  });
  ipcMain.handle('prep:logs', e => {
    assertReady(e);
    let names: string[]; try { names = readdirSync(join(app.getPath('userData'), 'lockdown')); } catch { return []; }
    return names.filter(n => /^[a-f0-9-]{36}\.jsonl$/.test(n)).sort().reverse().map(name => {
      const id = name.slice(0, -6);
      try {
        const log = verifyPrepLog(readLog(id));
        let characters = 0, outsideMs = 0, blurredAt: number | null = null;
        const minutes = new Map<number, number>();
        const started = Date.parse(log.entries[0]!.time);
        for (const entry of log.entries) {
          const data = entry.data as { phase?: string; inserted?: string[]; clientTime?: string } | null;
          if (entry.kind === 'input' && data?.phase === 'transaction' && Array.isArray(data.inserted)) {
            const count = data.inserted.reduce((n, text) => n + (typeof text === 'string' ? text.length : 0), 0);
            characters += count;
            const minute = Math.max(0, Math.floor((Date.parse(data.clientTime ?? entry.time) - started) / 60000));
            minutes.set(minute, (minutes.get(minute) ?? 0) + count);
          }
          if (entry.kind === 'blur' && blurredAt === null) blurredAt = Date.parse(entry.time);
          if ((entry.kind === 'focus' || entry.kind === 'session-end') && blurredAt !== null) { outsideMs += Math.max(0, Date.parse(entry.time) - blurredAt); blurredAt = null; }
        }
        return { id, valid: true, start: log.entries[0]?.time, end: log.entries.find(e => e.kind === 'session-end')?.time ?? null,
          round: log.entries.find(e => e.kind === 'round-start')?.time ?? null, finalHash: log.finalHash, sealCode: log.sealCode,
          events: log.entries.length, blocked: log.entries.filter(e => e.kind === 'blocked').length,
          characters, outsideMs, flagged: log.entries.filter(e => (e.data as { flagged?: boolean } | null)?.flagged).length,
          typingByMinute: [...minutes].map(([minute, count]) => ({ minute, characters: count, wpm: Math.round(count / 5) })) };
      } catch { return { id, valid: false }; }
    });
  });
  ipcMain.handle('prep:read-log', (e, id) => { assertReady(e); return readLog(id); });
  ipcMain.handle('prep:export-log', async (e, id, format = 'raw', timeZone?: string) => {
    if (format !== 'raw' && format !== 'readable') throw new Error('Unknown log export format.');
    let text = readLog(id); // contains typed content; explicit user export only
    if (format === 'readable') {
      let valid = false, sealCode: string | undefined;
      try { sealCode = verifyPrepLog(text).sealCode; valid = true; } catch {}
      text = exportPrepLogReport(createPrepLogReport(text, { timeZone, chainValid: valid, sealCode }));
    }
    const extension = format === 'readable' ? 'txt' : 'jsonl';
    const result = await dialog.showSaveDialog(assertReady(e).win, { defaultPath: `CardMirror-session-${id}.${extension}`, filters: [{ name: format === 'readable' ? 'Readable report' : 'Raw audit log', extensions: [extension] }] });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, text, { mode: 0o600 }); return true;
  });
  app.on('before-quit', () => { if (owner?.snapshot() && !error) audit('app-quit', {}, [...windows.keys()][0] ?? 0); });
}
