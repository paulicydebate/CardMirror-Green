// @vitest-environment node
// The `electron` import inside bridge-handshake.ts resolves to
// tests/desktop/_electron-stub.ts via the vitest alias in
// vitest.config.ts, same as the other desktop-module tests.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  bridgeDirPath,
  writeCardmirrorHandshake,
  deleteCardmirrorHandshake,
  scanFlowApps,
  flowPost,
  BRIDGE_TOKEN_HEADER,
} from '../../apps/desktop/src/bridge-handshake.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-bridge-'));
  process.env['CARDMIRROR_BRIDGE_DIR'] = dir;
});
afterEach(async () => {
  delete process.env['CARDMIRROR_BRIDGE_DIR'];
  await fs.rm(dir, { recursive: true, force: true });
});

function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const { promise, resolve } = Promise.withResolvers<{ port: number; close: () => void }>();
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    resolve({ port: addr.port, close: () => server.close() });
  });
  return promise;
}

/** Legacy pre-split shape: identity + port/token in ONE file. Kept as a
 *  helper because the module tolerates it (reads as its own session). */
async function writeFlowHandshake(id: string, port: number, token = 'tok'): Promise<void> {
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    // process.pid: a pid that is genuinely alive on EVERY platform. (This
    // helper once wrote pid 1 — launchd/init on Unix, so EPERM → alive,
    // but NONEXISTENT on Windows, where the pid-liveness guard correctly
    // refused the send and broke these tests on windows-latest only.)
    JSON.stringify({ schema: 1, app: id, appVersion: '1.0.0', kind: 'flow', port, token, pid: process.pid }),
  );
}

/** The published two-file contract: persistent identity + session. */
async function writeSplitFlowApp(
  id: string,
  session: { port: number; token: string } | null,
): Promise<void> {
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify({ schema: 1, app: id, appVersion: '1.0.0', kind: 'flow' }),
  );
  if (session) {
    await fs.writeFile(
      path.join(dir, `${id}.session.json`),
      JSON.stringify({ port: session.port, token: session.token, pid: process.pid }),
    );
  }
}

describe('handshake dir', () => {
  it('honors the CARDMIRROR_BRIDGE_DIR override', () => {
    expect(bridgeDirPath()).toBe(dir);
  });
  it('splits identity from session; quit clears ONLY the session', async () => {
    await writeCardmirrorHandshake(17699, 'secret');
    const identity = JSON.parse(await fs.readFile(path.join(dir, 'cardmirror-green.json'), 'utf8'));
    // Identity must NOT leak the session secrets into the never-deleted file.
    expect(identity).toMatchObject({ app: 'cardmirror-green', kind: 'editor' });
    expect(identity.token).toBeUndefined();
    expect(identity.port).toBeUndefined();
    const session = JSON.parse(
      await fs.readFile(path.join(dir, 'cardmirror-green.session.json'), 'utf8'),
    );
    expect(session).toMatchObject({ port: 17699, token: 'secret' });
    await deleteCardmirrorHandshake();
    // Session gone, identity persists — that's what keeps a closed app
    // selectable in a peer's picker.
    await expect(fs.readFile(path.join(dir, 'cardmirror-green.session.json'))).rejects.toThrow();
    await expect(fs.readFile(path.join(dir, 'cardmirror-green.json'))).resolves.toBeDefined();
  });
  it('protects the token: dir 0700, files 0600 (POSIX)', async () => {
    if (process.platform === 'win32') return; // no POSIX modes there
    await writeCardmirrorHandshake(17699, 'secret');
    expect(((await fs.stat(dir)).mode & 0o777).toString(8)).toBe('700');
    const sess = await fs.stat(path.join(dir, 'cardmirror-green.session.json'));
    expect((sess.mode & 0o777).toString(8)).toBe('600');
  });
});

describe('scanFlowApps', () => {
  it('lists closed apps too, with a live running flag; token sent on ping', async () => {
    let sawToken = '';
    const live = await listen((req, res) => {
      sawToken = String(req.headers[BRIDGE_TOKEN_HEADER.toLowerCase()] ?? '');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    await writeSplitFlowApp('ebb', { port: live.port, token: 'tok-live' });
    await writeSplitFlowApp('closed', null); // identity only — not launched
    await writeFlowHandshake('dead', 1, 'tok-dead'); // stale session (port 1)
    await fs.writeFile(path.join(dir, 'broken.json'), '{not json');
    await writeCardmirrorHandshake(17699, 's'); // kind editor — excluded
    const apps = await scanFlowApps();
    const byId = new Map(apps.map((a) => [a.id, a.running]));
    expect([...byId.keys()].sort()).toEqual(['closed', 'dead', 'ebb']);
    expect(byId.get('ebb')).toBe(true);
    expect(byId.get('closed')).toBe(false); // listed — selection must not require running
    expect(byId.get('dead')).toBe(false); // stale session reads as not-running, not absent
    expect(sawToken).toBe('tok-live');
    live.close();
  });
});

describe('flowPost', () => {
  it('POSTs with the token header and returns parsed JSON', async () => {
    let got: unknown = null;
    const live = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        got = { url: req.url, token: req.headers[BRIDGE_TOKEN_HEADER.toLowerCase()], body: JSON.parse(Buffer.concat(chunks).toString()) };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, sheet: '2AC' }));
      });
    });
    await writeFlowHandshake('ebb', live.port, 'tok');
    const res = await flowPost('ebb', '/flow/send', { mode: 'column' });
    expect(res).toEqual({ ok: true, status: 200, body: { ok: true, sheet: '2AC' } });
    expect(got).toMatchObject({ url: '/flow/send', token: 'tok', body: { mode: 'column' } });
    live.close();
  });
  it('maps a missing app, a not-launched app, and a dead app to typed errors', async () => {
    expect(await flowPost('nope', '/x', {})).toEqual({ ok: false, error: 'no-such-app' });
    // Registered (identity on disk) but not launched: the RUNTIME error —
    // callers can tell the user to start the app, not "no such app".
    await writeSplitFlowApp('closed', null);
    expect(await flowPost('closed', '/x', {})).toEqual({ ok: false, error: 'app-not-running' });
    await writeFlowHandshake('dead', 1);
    expect(await flowPost('dead', '/x', {})).toEqual({ ok: false, error: 'app-not-running' });
  });
  it('treats out-of-range and non-integer ports as no session (not-running)', async () => {
    // The identity half of these files is legible — only the session part
    // is garbage — so the app is "registered but unreachable".
    await writeFlowHandshake('badport', 0); // helper writes port 0
    await writeFlowHandshake('floatport', 1.5 as any);
    expect(await flowPost('badport', '/x', {})).toEqual({ ok: false, error: 'app-not-running' });
    expect(await flowPost('floatport', '/x', {})).toEqual({ ok: false, error: 'app-not-running' });
  });
  it('ignores oversized handshake files even when otherwise valid', async () => {
    let pinged = false;
    const live = await listen((_req, res) => {
      pinged = true;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    // Valid flow handshake, live port, but padded past the 64 KiB cap.
    await fs.writeFile(
      path.join(dir, 'big.json'),
      JSON.stringify({
        schema: 1,
        app: 'big',
        appVersion: 'x'.repeat(70 * 1024),
        kind: 'flow',
        port: live.port,
        token: 'tok',
        pid: 1,
      }),
    );
    expect((await scanFlowApps()).map((a) => a.id)).not.toContain('big');
    expect(pinged).toBe(false); // skipped before any ping
    live.close();
  });
  it('rejects uppercase app ids even with a valid handshake on disk', async () => {
    let pinged = false;
    const live = await listen((_req, res) => {
      pinged = true;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    // A complete, live handshake at Ebb.json — only the uppercase id
    // must reject it (the published contract is lowercase-only).
    await writeFlowHandshake('Ebb', live.port, 'tok');
    expect(await flowPost('Ebb', '/x', {})).toEqual({ ok: false, error: 'no-such-app' });
    expect(pinged).toBe(false);
    live.close();
  });
  it('maps a stalled body to timeout, not a hang', { timeout: 10_000 }, async () => {
    const live = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.write('{"ok":'); // headers + partial body, then stall
    });
    await writeFlowHandshake('stall', live.port);
    expect(await flowPost('stall', '/x', {})).toEqual({ ok: false, error: 'timeout' });
    live.close();
  });
});

describe('pid liveness (stale session files)', () => {
  it('a session whose writer pid is dead reads as app-not-running — no bytes sent', async () => {
    const { spawnSync } = await import('node:child_process');
    // A process that has certainly exited: its pid is dead (and not
    // plausibly recycled within this same test tick).
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid!;
    let touched = false;
    const live = await listen((_req, res) => {
      touched = true;
      res.end('{}');
    });
    // Live port, valid token — but the recorded writer is dead.
    await fs.writeFile(
      path.join(dir, 'stale.json'),
      JSON.stringify({ schema: 1, app: 'stale', appVersion: '1.0.0', kind: 'flow' }),
    );
    await fs.writeFile(
      path.join(dir, 'stale.session.json'),
      JSON.stringify({ port: live.port, token: 'tok', pid: deadPid }),
    );
    expect(await flowPost('stale', '/x', {})).toEqual({ ok: false, error: 'app-not-running' });
    expect(touched).toBe(false); // the stranger behind the port never heard from us
    live.close();
  });

  it('our own (alive) pid never blocks the send', async () => {
    const live = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    await writeSplitFlowApp('livepid', { port: live.port, token: 'tok' });
    // Overwrite the session with our own pid — definitely alive.
    await fs.writeFile(
      path.join(dir, 'livepid.session.json'),
      JSON.stringify({ port: live.port, token: 'tok', pid: process.pid }),
    );
    const res = await flowPost('livepid', '/x', {});
    expect(res.ok).toBe(true);
    live.close();
  });
});
