import { describe, expect, it } from 'vitest';
import type { Transport } from '../../src/opencaselist/client.js';
import { createOpenCaselistService, fileNameFromPath, type SessionStore } from '../../src/opencaselist/app-service.js';

const TOKEN = 'secret-token-123';
const PASSWORD = 'hunter2-password';
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function memoryStore(initial: string | null = null): SessionStore & { value: string | null } {
  const store = {
    value: initial,
    read: () => store.value,
    write: (v: string) => { store.value = v; },
    remove: () => { store.value = null; },
  };
  return store;
}

function recorder(responses: Response[]): { transport: Transport; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    transport: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('unexpected request ' + url);
      return next;
    },
  };
}

const saved = (token = TOKEN, apiBase = 'https://api.opencaselist.com/v1'): string => JSON.stringify({ apiBase, token });
const fast = { minIntervalMs: 0, sleep: async () => {} };

describe('OpenCaselist app service', () => {
  it('signs in, stores only the token, and never stores the password', async () => {
    const store = memoryStore();
    const { transport, calls } = recorder([json({ token: TOKEN })]);
    const service = createOpenCaselistService({ store, fetch: transport, ...fast });
    expect(await service.status()).toEqual({ ok: true, value: { signedIn: false } });
    expect(await service.login(' me@example.com ', PASSWORD)).toEqual({ ok: true, value: { signedIn: true } });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ username: 'me@example.com', password: PASSWORD });
    expect(store.value).toContain(TOKEN);
    expect(store.value).not.toContain(PASSWORD);
    expect(await service.status()).toEqual({ ok: true, value: { signedIn: true } });
  });

  it('reports a rejected sign-in without throwing', async () => {
    const store = memoryStore();
    const { transport } = recorder([json({ message: 'bad' }, 401)]);
    const result = await createOpenCaselistService({ store, fetch: transport, ...fast }).login('me@example.com', PASSWORD);
    expect(result).toMatchObject({ ok: false, signedOut: true });
    expect(store.value).toBeNull();
    const empty = await createOpenCaselistService({ store, fetch: transport, ...fast }).login('', '');
    expect(empty).toMatchObject({ ok: false, error: 'Enter both your Tabroom email and password' });
  });

  it('ignores a saved token issued by a different server', async () => {
    const service = createOpenCaselistService({ store: memoryStore(saved(TOKEN, 'https://evil.example/v1')), ...fast });
    expect(await service.status()).toEqual({ ok: true, value: { signedIn: false } });
    expect(await service.caselists()).toMatchObject({ ok: false, signedOut: true });
  });

  it('lists caselists, schools and teams with labels, sorted', async () => {
    const { transport, calls } = recorder([
      json([{ name: 'ndtceda25', display_name: 'NDT/CEDA 2025-26', event: 'cx', level: 'college', year: 2025 }, { name: 'hspolicy25', display_name: 'HS Policy 2025-26' }]),
      json([{ name: 'Zeta', display_name: 'Zeta U' }, { name: 'Alpha' }]),
      json([{ name: 'AlSm', display_name: 'Alpha Smith' }]),
    ]);
    const service = createOpenCaselistService({ store: memoryStore(saved()), fetch: transport, ...fast });
    const caselists = await service.caselists();
    expect(caselists).toEqual({ ok: true, value: [
      { name: 'hspolicy25', label: 'HS Policy 2025-26', event: null, level: null, year: null },
      { name: 'ndtceda25', label: 'NDT/CEDA 2025-26', event: 'cx', level: 'college', year: 2025 },
    ] });
    expect(await service.schools('ndtceda25')).toEqual({ ok: true, value: [{ name: 'Alpha', label: 'Alpha' }, { name: 'Zeta', label: 'Zeta U' }] });
    expect(await service.teams('ndtceda25', 'Alpha')).toEqual({ ok: true, value: [{ name: 'AlSm', label: 'Alpha Smith' }] });
    expect(calls[2]!.url).toBe('https://api.opencaselist.com/v1/caselists/ndtceda25/schools/Alpha/teams');
    for (const call of calls) expect(call.url).not.toContain(TOKEN);
  });

  it('marks which disclosed files the editor can open', async () => {
    const { transport } = recorder([json([
      { round_id: 1, tournament: 'Ex', side: 'A', round: '1', opponent: 'Foo', judge: 'Bar', opensource: 'nd/Alpha/AlSm/Ex-R1.docx' },
      { round_id: 2, tournament: 'Ex', side: 'N', round: '2', opensource: 'nd/Alpha/AlSm/Ex-R2.pdf' },
      { round_id: 3, tournament: 'Ex', side: 'N', round: '3', opensource: null },
    ])]);
    const service = createOpenCaselistService({ store: memoryStore(saved()), fetch: transport, ...fast });
    const result = await service.rounds('nd', 'Alpha', 'AlSm');
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map(r => [r.roundId, r.filename, r.openable])).toEqual([
      [1, 'Ex-R1.docx', true], [2, 'Ex-R2.pdf', false], [3, null, false],
    ]);
    expect(result.value[0]).toMatchObject({ opponent: 'Foo', judge: 'Bar', side: 'A' });
  });

  it('downloads a file and returns its bytes and credential-free source URL', async () => {
    const { transport, calls } = recorder([new Response(new Uint8Array([1, 2, 3]), { status: 200 })]);
    const service = createOpenCaselistService({ store: memoryStore(saved()), fetch: transport, ...fast });
    const result = await service.download('nd/Alpha/AlSm/Ex R1.docx');
    if (!result.ok) throw new Error(result.error);
    expect(Array.from(result.value.bytes)).toEqual([1, 2, 3]);
    expect(result.value.filename).toBe('Ex R1.docx');
    expect(result.value.sourceUrl).toBe('https://api.opencaselist.com/v1/download?path=nd%2FAlpha%2FAlSm%2FEx%20R1.docx');
    expect(result.value.sourceUrl).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
  });

  it('drops an expired session so the UI returns to sign-in', async () => {
    const store = memoryStore(saved());
    const { transport } = recorder([json({ message: 'expired' }, 401)]);
    const service = createOpenCaselistService({ store, fetch: transport, ...fast });
    expect(await service.schools('nd')).toMatchObject({ ok: false, signedOut: true });
    expect(store.value).toBeNull();
    expect(await service.status()).toEqual({ ok: true, value: { signedIn: false } });
  });

  it('rejects bad arguments before any request and signs out locally', async () => {
    const store = memoryStore(saved());
    const { transport, calls } = recorder([]);
    const service = createOpenCaselistService({ store, fetch: transport, ...fast });
    expect(await service.schools(42)).toMatchObject({ ok: false, error: 'Missing or invalid caselist', signedOut: false });
    expect(await service.download('')).toMatchObject({ ok: false, signedOut: false });
    expect(calls).toHaveLength(0);
    expect(await service.logout()).toEqual({ ok: true, value: { signedIn: false } });
    expect(store.value).toBeNull();
  });

  it('derives file names from paths', () => {
    expect(fileNameFromPath('a/b/c.docx')).toBe('c.docx');
    expect(fileNameFromPath('a\\b\\c.cmir')).toBe('c.cmir');
    expect(fileNameFromPath('/')).toBe('opencaselist-file');
  });
});
