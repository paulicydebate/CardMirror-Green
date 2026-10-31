// @vitest-environment jsdom
/**
 * The collab gate is open everywhere collaboration can exist: every
 * desktop host, and — since the 2026-08-19 soft launch — desktop-layout
 * browser hosts too, no flag required (the old `pmd-collab-web`
 * prototype flip is retired). Closed only where collab can't exist:
 * the mobile shell (co-editing is a desktop-layout feature) and Lite
 * builds (pinned in tests/editor/lite-build.test.ts). Whether collab
 * is ACTIVE stays behind the 'Enable collaboration' master toggle —
 * the gate only decides that the surfaces exist.
 *
 * getHost() caches the resolved host at module scope, so each case
 * resets the module registry and re-imports the gate with the desired
 * `window.electronAPI` presence already in place.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

type WinStub = { electronAPI?: unknown };

async function loadGate(): Promise<() => boolean> {
  vi.resetModules();
  const mod = await import('../../src/editor/collab/collab-gate.js');
  return mod.collabEnabled;
}

afterEach(() => {
  delete (window as unknown as WinStub).electronAPI;
  window.localStorage.clear();
});

describe('collabEnabled — open by default, mobile shell excluded', () => {
  it('desktop host → enabled', async () => {
    (window as unknown as WinStub).electronAPI = {}; // Electron host
    expect((await loadGate())()).toBe(true);
  });

  it('desktop-layout browser host → enabled, no flag needed', async () => {
    delete (window as unknown as WinStub).electronAPI; // browser host
    // jsdom boots at 1024px with a fine pointer — desktop layout.
    expect((await loadGate())()).toBe(true);
  });

  it('mobile shell → disabled (co-editing is a desktop-layout feature)', async () => {
    delete (window as unknown as WinStub).electronAPI; // browser host
    window.localStorage.setItem('pmd-settings', JSON.stringify({ mobileLayout: 'mobile' }));
    expect((await loadGate())()).toBe(false);
  });

  it('allows an editable iPad workspace, including narrow split view', async () => {
    const oldTouch = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
    const oldPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    window.localStorage.setItem('pmd-settings', JSON.stringify({ mobileLayout: 'mobile' }));
    try { expect((await loadGate())()).toBe(true); }
    finally { if(oldTouch)Object.defineProperty(navigator,'maxTouchPoints',oldTouch);else Reflect.deleteProperty(navigator,'maxTouchPoints'); if(oldPlatform)Object.defineProperty(navigator,'platform',oldPlatform);else Reflect.deleteProperty(navigator,'platform'); }
  });

  it('the retired prototype flag changes nothing either way', async () => {
    delete (window as unknown as WinStub).electronAPI;
    window.localStorage.setItem('pmd-collab-web', '1');
    expect((await loadGate())()).toBe(true); // open — but because of the default, not the flag
    window.localStorage.setItem('pmd-settings', JSON.stringify({ mobileLayout: 'mobile' }));
    window.localStorage.setItem('pmd-collab-web', '1');
    expect((await loadGate())()).toBe(false); // the flag can't reopen the mobile shell
  });

  it('prototype relay pair feeds collabDevRelay at runtime', async () => {
    vi.resetModules();
    window.localStorage.setItem('pmd-collab-web-relay-url', 'http://localhost:8787/relay/');
    window.localStorage.setItem('pmd-collab-web-relay-token', 'tok');
    const mod = await import('../../src/editor/collab/collab-gate.js');
    expect(mod.collabDevRelay()).toEqual({ url: 'http://localhost:8787/relay/', token: 'tok' });
  });
});
