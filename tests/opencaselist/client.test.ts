import { describe, expect, it } from 'vitest';
import { login, OpenCaselistClient, OpenCaselistError, type Transport } from '../../src/opencaselist/client.js';

const TOKEN = 'secret-token-123';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function recorder(responses: Array<Response | Error>): { transport: Transport; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    transport: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('unexpected request ' + url);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const fast = { sleep: async () => {}, minIntervalMs: 0 };
const headersOf = (init: RequestInit): Record<string, string> => init.headers as Record<string, string>;

describe('OpenCaselistClient', () => {
  it('sends the token only as a cookie and encodes path segments', async () => {
    const { transport, calls } = recorder([json([{ round_id: 7, opensource: 'a/b c.docx' }])]);
    const client = new OpenCaselistClient({ token: TOKEN, fetch: transport, ...fast });
    const rounds = await client.listRounds('nfald25', 'Diablo Valley', 'Villa Smith', 'A');
    expect(rounds[0]!.round_id).toBe(7);
    expect(calls[0]!.url).toBe('https://api.opencaselist.com/v1/caselists/nfald25/schools/Diablo%20Valley/teams/Villa%20Smith/rounds?side=A');
    expect(calls[0]!.url).not.toContain(TOKEN);
    expect(headersOf(calls[0]!.init)['Cookie']).toBe('caselist_token=' + TOKEN);
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('retries 5xx, 429 and network errors, honoring Retry-After', async () => {
    const waits: number[] = [];
    const { transport, calls } = recorder([json({ message: 'down' }, 503), new TypeError('fetch failed'),
      json({ message: 'slow' }, 429, { 'retry-after': '3' }), json([{ name: 'nfald25' }])]);
    const client = new OpenCaselistClient({ token: TOKEN, fetch: transport, minIntervalMs: 0, sleep: async ms => { waits.push(ms); } });
    expect((await client.listCaselists()).map(c => c.name)).toEqual(['nfald25']);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([1000, 2000, 3000]);
  });

  it('gives up after maxAttempts and does not retry 401/404', async () => {
    const many = recorder([json({}, 500), json({}, 500)]);
    await expect(new OpenCaselistClient({ token: TOKEN, fetch: many.transport, maxAttempts: 2, ...fast }).listCaselists())
      .rejects.toMatchObject({ status: 500, retryable: true });
    for (const status of [401, 404]) {
      const once = recorder([json({ message: 'nope' }, status)]);
      const error = await new OpenCaselistClient({ token: TOKEN, fetch: once.transport, ...fast }).listCaselists().catch(e => e as OpenCaselistError);
      expect(once.calls).toHaveLength(1);
      expect(error).toBeInstanceOf(OpenCaselistError);
      expect((error as OpenCaselistError).status).toBe(status);
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });

  it('spaces requests by minIntervalMs', async () => {
    let clock = 0;
    const waits: number[] = [];
    const { transport } = recorder([json([]), json([])]);
    const client = new OpenCaselistClient({ token: TOKEN, fetch: transport, minIntervalMs: 500, now: () => clock,
      sleep: async ms => { waits.push(ms); clock += ms; } });
    await client.listCaselists();
    clock += 100;
    await client.listCaselists();
    expect(waits).toEqual([400]);
  });

  it('rejects malformed list responses instead of guessing', async () => {
    const { transport } = recorder([json({ not: 'a list' }), json([{ round_id: 'x' }])]);
    const client = new OpenCaselistClient({ token: TOKEN, fetch: transport, ...fast });
    await expect(client.listCaselists()).rejects.toThrow(/expected a list/);
    await expect(client.listRounds('c', 's', 't')).rejects.toThrow(/missing required fields/);
  });

  it('downloads raw bytes, enforces the size limit, and follows one redirect without the cookie', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
    const { transport, calls } = recorder([
      new Response(bytes, { status: 200 }),
      new Response(null, { status: 302, headers: { location: 'https://files.example.org/x.docx?sig=1' } }),
      new Response(bytes, { status: 200 }),
      new Response(new Uint8Array(10), { status: 200 }),
      new Response(null, { status: 302, headers: { location: 'http://insecure.example.org/x' } }),
    ]);
    const client = new OpenCaselistClient({ token: TOKEN, fetch: transport, maxDownloadBytes: 8, ...fast });
    expect(await client.download('a/b.docx')).toEqual(bytes);
    expect(calls[0]!.url).toBe('https://api.opencaselist.com/v1/download?path=a%2Fb.docx');
    expect(await client.download('a/b.docx')).toEqual(bytes);
    expect(calls[2]!.url).toBe('https://files.example.org/x.docx?sig=1');
    expect(calls[2]!.init.headers).toBeUndefined();
    await expect(client.download('big.docx')).rejects.toThrow(/larger than the download limit/);
    await expect(client.download('bad.docx')).rejects.toThrow(/unusable download redirect/);
  });
});

describe('login', () => {
  it('posts credentials once and returns the token from the body or cookie', async () => {
    const body = recorder([json({ token: 'abc', userId: '5' }, 201)]);
    expect(await login('me@example.com', 'pw', { fetch: body.transport })).toEqual({ token: 'abc' });
    expect(body.calls[0]!.url).toBe('https://api.opencaselist.com/v1/login');
    expect(JSON.parse(body.calls[0]!.init.body as string)).toEqual({ username: 'me@example.com', password: 'pw', remember: true });
    const cookie = recorder([new Response('{}', { status: 201, headers: { 'set-cookie': 'caselist_token=xyz; Path=/; HttpOnly' } })]);
    expect(await login('me@example.com', 'pw', { fetch: cookie.transport })).toEqual({ token: 'xyz' });
  });

  it('reports bad credentials without echoing them', async () => {
    const { transport } = recorder([json({ message: 'Invalid' }, 401)]);
    const error = (await login('me@example.com', 'hunter2', { fetch: transport }).then(() => null, (e: unknown) => e)) as Error;
    expect(error.message).toMatch(/did not accept/);
    expect(error.message).not.toContain('hunter2');
    await expect(login('', 'x')).rejects.toThrow(/both/);
  });
});
