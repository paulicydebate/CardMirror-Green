// @vitest-environment jsdom
// OpenCaselist panel: sign-in, caselist → school → team browsing, opening a
// disclosed file, and falling back to sign-in when the session expires.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterItems, openOpenCaselist, sideLabel } from '../../src/editor/opencaselist-ui.js';

type Call = { op: string; args: unknown[] };
let calls: Call[] = [];
let signedIn = false;
let expireOnRounds = false;

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

function installBridge(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    opencaselist: async (op: string, ...args: unknown[]) => {
      calls.push({ op, args });
      switch (op) {
        case 'status': return ok({ signedIn });
        case 'login':
          if (args[1] !== 'right-password') return { ok: false, error: 'OpenCaselist did not accept that Tabroom email or password', signedOut: true };
          signedIn = true;
          return ok({ signedIn: true });
        case 'logout': signedIn = false; return ok({ signedIn: false });
        case 'caselists': return ok([{ name: 'nfald25', label: 'NFA-LD 2025-26', event: 'ld', level: 'college', year: 2025 }]);
        case 'schools': return ok([{ name: 'Alpha', label: 'Alpha College' }, { name: 'Beta', label: 'Beta U' }]);
        case 'teams': return ok([{ name: 'AlSm', label: 'Alpha Smith' }]);
        case 'rounds':
          if (expireOnRounds) { signedIn = false; return { ok: false, error: 'OpenCaselist rejected the session (401). Sign in again.', signedOut: true }; }
          return ok([
            { roundId: 1, tournament: 'Ex', side: 'A', round: '1', opponent: 'Foo', judge: 'Bar', opensource: 'p/Ex-R1.docx', filename: 'Ex-R1.docx', openable: true },
            { roundId: 2, tournament: 'Ex', side: 'N', round: '2', opponent: '', judge: '', opensource: 'p/Ex-R2.pdf', filename: 'Ex-R2.pdf', openable: false },
          ]);
        case 'download': return ok({ filename: 'Ex-R1.docx', bytes: new Uint8Array([9, 8, 7]), sourceUrl: 'https://x/download?path=p' });
        default: return { ok: false, error: 'unknown', signedOut: false };
      }
    },
  };
}

const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };
const $ = <T extends Element>(sel: string): T => {
  const node = document.querySelector<T>(sel);
  if (!node) throw new Error('missing ' + sel);
  return node;
};
const status = (): string => $('.pmd-ocl-status').textContent ?? '';
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}
function closePanel(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

beforeEach(() => {
  calls = [];
  signedIn = false;
  expireOnRounds = false;
  localStorage.clear();
  installBridge();
});
afterEach(() => {
  closePanel();
  document.body.replaceChildren();
});

describe('OpenCaselist panel', () => {
  it('signs in, clears the password field, browses to a team and opens a file', async () => {
    const openFile = vi.fn(async () => {});
    openOpenCaselist({ openFile });
    await settle();
    const password = $<HTMLInputElement>('#pmd-ocl-password');
    $<HTMLInputElement>('#pmd-ocl-email').value = 'me@example.com';
    password.value = 'wrong';
    $<HTMLFormElement>('.pmd-ocl-signin').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(password.value).toBe('');
    await settle();
    expect(status()).toContain('did not accept');

    password.value = 'right-password';
    $<HTMLFormElement>('.pmd-ocl-signin').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(password.value).toBe('');
    await settle();
    expect(calls.filter(c => c.op === 'login').map(c => c.args)).toEqual([['me@example.com', 'wrong'], ['me@example.com', 'right-password']]);

    choose($<HTMLSelectElement>('#pmd-ocl-caselist'), 'nfald25');
    await settle();
    expect(status()).toBe('2 schools.');
    const schoolFilter = $<HTMLInputElement>('#pmd-ocl-school-filter');
    schoolFilter.value = 'beta';
    schoolFilter.dispatchEvent(new Event('input'));
    const schoolList = $<HTMLSelectElement>('select[aria-label="Schools"]');
    expect(Array.from(schoolList.options).map(o => o.value)).toEqual(['Beta']);
    schoolFilter.value = '';
    schoolFilter.dispatchEvent(new Event('input'));
    choose(schoolList, 'Alpha');
    await settle();
    choose($<HTMLSelectElement>('#pmd-ocl-team'), 'AlSm');
    await settle();

    const rows = Array.from(document.querySelectorAll('.pmd-ocl-table tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Aff');
    expect(rows[1]!.textContent).toContain('.pdf — not openable here');
    expect(status()).toBe('2 rounds, 2 with an open-source file.');
    rows[0]!.querySelector('button')!.click();
    await settle();
    expect(calls.at(-1)).toEqual({ op: 'download', args: ['p/Ex-R1.docx'] });
    expect(openFile).toHaveBeenCalledWith({ name: 'Ex-R1.docx', bytes: new Uint8Array([9, 8, 7]) });
    expect(status()).toBe('Opened Ex-R1.docx as an unsaved document.');
  });

  it('remembers the last caselist and returns to sign-in when the session expires', async () => {
    signedIn = true;
    localStorage.setItem('cmg-opencaselist-last-caselist', 'nfald25');
    expireOnRounds = true;
    openOpenCaselist({ openFile: async () => {} });
    await settle();
    expect(calls.map(c => c.op)).toEqual(['status', 'caselists', 'schools']);
    choose($<HTMLSelectElement>('select[aria-label="Schools"]'), 'Alpha');
    await settle();
    choose($<HTMLSelectElement>('#pmd-ocl-team'), 'AlSm');
    await settle();
    expect(document.querySelector('#pmd-ocl-password')).not.toBeNull();
    expect(status()).toContain('Sign in again');
  });

  it('opens only one panel at a time and closes on Escape', async () => {
    openOpenCaselist({ openFile: async () => {} });
    openOpenCaselist({ openFile: async () => {} });
    await settle();
    expect(document.querySelectorAll('.pmd-ocl-dialog')).toHaveLength(1);
    closePanel();
    expect(document.querySelectorAll('.pmd-ocl-dialog')).toHaveLength(0);
  });

  it('labels sides and filters lists', () => {
    expect(sideLabel('A')).toBe('Aff');
    expect(sideLabel('n')).toBe('Neg');
    expect(sideLabel('?')).toBe('?');
    expect(filterItems([{ name: 'DVC', label: 'Diablo Valley' }, { name: 'X', label: 'Other' }], 'diablo').map(i => i.name)).toEqual(['DVC']);
  });
});
