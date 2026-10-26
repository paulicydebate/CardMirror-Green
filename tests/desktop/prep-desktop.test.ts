// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mock = vi.hoisted(() => ({
  dir: '', handlers: new Map<string, (...args: any[]) => any>(), listeners: new Map<string, (...args: any[]) => any>(),
  sent: [] as Array<{ channel: string; value: any }>, allow: true, onPrepare: null as null | ((id: number, request: any) => void),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mock.dir, on: vi.fn() },
  BrowserWindow: {}, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: join(mock.dir, 'export.jsonl') }) },
  clipboard: { writeText: vi.fn() },
  ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => mock.handlers.set(key, fn), on: (key: string, fn: (...args: any[]) => any) => mock.listeners.set(key, fn) },
}));
let desktop: typeof import('../../apps/desktop/src/prep-desktop.js');
const event = (id = 1) => ({ sender: { id } });
const invoke = (channel: string, ...args: any[]) => mock.handlers.get(channel)!(event(), ...args);
const inventory = (id: number, docs: string[], focused: string | null) => mock.listeners.get('prep:inventory')!({ sender: { id } }, { docs, focused });

function win(id: number): any {
  return { id, on: vi.fn(), isDestroyed: () => false, webContents: { id, send: (channel: string, value: any) => {
    mock.sent.push({ channel, value });
    if (channel === 'prep:prepare') queueMicrotask(() => {
      mock.onPrepare?.(id, value);
      mock.listeners.get('prep:prepared')!({ sender: { id } }, { requestId: value.requestId, ok: mock.allow });
    });
  } } };
}
beforeEach(async () => {
  vi.resetModules();
  mock.dir = mkdtempSync(join(tmpdir(), 'cm-prep-native-')); mock.handlers.clear(); mock.listeners.clear(); mock.sent.length = 0;
  mock.allow = true; mock.onPrepare = null;
  desktop = await import('../../apps/desktop/src/prep-desktop.js');
  desktop.registerPrepDesktop(() => {}); desktop.trackPrepWindow(win(1));
  await invoke('prep:ready');
});
afterEach(() => rmSync(mock.dir, { recursive: true, force: true }));
async function prepDoc() {
  await invoke('prep:action', 'start'); inventory(1, ['prep', 'strategy'], 'prep');
  await invoke('prep:action', 'created-prep', 'prep');
}

describe('desktop Prep controller boundary', () => {
  it('restricts clipboard operations by focused document and checks explicit transfer destinations', async () => {
    await prepDoc();
    desktop.prepHandle('host:clipboard-read-text', () => 'clipboard');
    await expect(invoke('host:clipboard-read-text')).rejects.toThrow('Prep document');
    inventory(1, ['prep', 'strategy'], 'strategy');
    expect(await invoke('host:clipboard-read-text')).toBe('clipboard');
    expect(desktop.prepExternalAllowed(1, 'prep')).toBe(false);
    expect(desktop.prepExternalAllowed(1, 'strategy')).toBe(true);
    const logs = await invoke('prep:logs'); expect(logs[0].blocked).toBe(2);
  });
  it('waits for every window, preserves Prep on cancel and only starts Round once non-prep docs are gone', async () => {
    await prepDoc(); desktop.trackPrepWindow(win(2)); await mock.handlers.get('prep:ready')!({ sender: { id: 2 } });
    inventory(2, ['coach'], 'coach');
    mock.allow = false;
    await expect(invoke('prep:action', 'round')).rejects.toThrow('canceled');
    expect(desktop.prepStatus().session?.mode).toBe('prep'); expect(desktop.prepStatus().transitioning).toBe(false);
    expect(mock.sent.filter(e => e.channel === 'prep:prepare')).toHaveLength(2);
    mock.allow = true;
    await expect(invoke('prep:action', 'round')).rejects.toThrow('non-prep');
    mock.onPrepare = id => inventory(id, id === 1 ? ['prep'] : [], id === 1 ? 'prep' : null);
    await invoke('prep:action', 'round'); expect(desktop.prepStatus().session?.mode).toBe('round');
  });
  it('refuses transition while an editor window is still loading', async () => {
    await prepDoc(); desktop.trackPrepWindow(win(2));
    await expect(invoke('prep:action', 'round')).rejects.toThrow('loading');
    expect(desktop.prepStatus().session?.mode).toBe('prep');
  });
  it('rechecks asynchronous file reads across a Round transition and allows saving', async () => {
    await prepDoc(); inventory(1, ['prep'], 'prep');
    let release!: (value: string) => void;
    desktop.prepHandle('host:read-file-at-path', () => new Promise(resolve => { release = resolve; }));
    const reading = invoke('host:read-file-at-path', 'synthetic.docx');
    await invoke('prep:action', 'round'); release('old file bytes');
    await expect(reading).rejects.toThrow('Round Mode');
    desktop.prepHandle('host:save-existing', () => true);
    expect(await invoke('host:save-existing')).toBe(true);
  });
  it('blocks fresh opens and file browsing in Round, but permits generated blank windows', async () => {
    await prepDoc(); inventory(1, ['prep'], 'prep'); await invoke('prep:action', 'round');
    for (const channel of ['host:open-file', 'host:list-files-recursive', 'host:read-cmir-file', 'host:quick-cards-list']) {
      desktop.prepHandle(channel, () => 'read'); await expect(invoke(channel)).rejects.toThrow('Round Mode');
    }
    desktop.prepHandle('host:spawn-window', () => 'new-window');
    await expect(invoke('host:spawn-window', { filename: 'old.docx' })).rejects.toThrow('Round Mode');
    expect(await invoke('host:spawn-window', { prepBlank: true })).toBe('new-window');
    expect(await invoke('host:spawn-window', null)).toBe('new-window');
    desktop.prepHandle('host:read-journals', () => [{ uid: 'prep' }, { uid: 'coach' }]);
    expect(await invoke('host:read-journals')).toEqual([{ uid: 'prep' }]);
  });
  it('rejects a preexisting document mark and cannot invent document ownership', async () => {
    await invoke('prep:action', 'start'); inventory(1, ['old'], 'old');
    await expect(invoke('prep:action', 'mark', 'old')).rejects.toThrow('Only new');
    await expect(invoke('prep:action', 'created-prep', 'outside')).rejects.toThrow('not in this window');
  });
  it('accepts batched committed/raw typing, seals once, and exports exactly the verified log', async () => {
    await prepDoc();
    await invoke('prep:events', [
      { kind: 'input', uid: 'prep', data: { phase: 'beforeinput', text: 'a' } },
      { kind: 'input', uid: 'prep', data: { phase: 'transaction', inserted: ['a'], clientTime: new Date().toISOString() } },
    ]);
    const result = await invoke('prep:action', 'end');
    expect(desktop.prepStatus().session).toBeNull();
    const logs = await invoke('prep:logs'); expect(logs[0]).toMatchObject({ valid: true, sealCode: result.sealCode, characters: 1 });
    const text = await invoke('prep:read-log', logs[0].id);
    await invoke('prep:export-log', logs[0].id);
    expect(readFileSync(join(mock.dir, 'export.jsonl'), 'utf8')).toBe(text);
    await expect(invoke('prep:action', 'end')).rejects.toThrow('first');
    expect(() => invoke('prep:read-log', '../outside')).toThrow('identity');
  });
  it('refuses strategy-document typing and reserved audit event injection', async () => {
    await prepDoc();
    expect(() => invoke('prep:events', [{ kind: 'input', uid: 'strategy', data: { text: 'not logged' } }])).toThrow('only for prep');
    expect(() => invoke('prep:events', [{ kind: 'session-end', uid: null, data: {} }])).toThrow('Invalid audit');
    expect(desktop.prepStatus().session?.endedAt).toBeNull();
  });
  it('allows only structured Green session invites through the metadata clipboard route', async () => {
    await prepDoc();
    await expect(invoke('prep:action', 'copy-invite', 'Typed prep content')).rejects.toThrow('Only a Green');
    expect(await invoke('prep:action', 'copy-invite', `cmshare3.${'a'.repeat(32)}.${'b'.repeat(43)}.1.0.0`)).toBe(true);
    desktop.prepHandle('host:clipboard-write-html', () => true);
    await expect(invoke('host:clipboard-write-html', { text: 'Typed prep content' })).rejects.toThrow('Prep document');
  });
  it('does not access destroyed webContents during window cleanup', () => {
    const testWindow = win(2); desktop.trackPrepWindow(testWindow);
    const closed = testWindow.on.mock.calls.find((call: any[]) => call[0] === 'closed')[1];
    Object.defineProperty(testWindow, 'webContents', { get: () => { throw new Error('destroyed'); } });
    expect(() => closed()).not.toThrow();
  });
});
