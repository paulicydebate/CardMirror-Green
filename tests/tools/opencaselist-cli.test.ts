import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { schema } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';

function run(args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/tools/opencaselist-cli.ts'), ...args],
      { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => done({ status, stdout, stderr }));
  });
}

it('exports a scoped batch and run manifest through a local fake OpenCaselist', async () => {
  const doc = schema.nodes.doc!.createChecked(null, [schema.nodes.card!.createChecked(null, [
    schema.nodes.tag!.create({ id: 'c1' }, schema.text('Tag')),
    schema.nodes.cite_paragraph!.create(null, schema.text('Author 26', [schema.marks.cite_mark!.create()])),
    schema.nodes.card_body!.create(null, schema.text('Evidence')),
  ])]);
  const file = serializeNative(doc, { appVersion: 'test' });
  const requests: Array<{ url: string; cookie: string | undefined }> = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', cookie: req.headers.cookie });
    if (req.headers.cookie !== 'caselist_token=tok-xyz') { res.writeHead(401).end('{"message":"Not Authorized"}'); return; }
    if (req.url === '/v1/caselists/nfald25/schools/DVC/teams/VillaSmith/rounds') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ round_id: 1, side: 'N', opensource: 'nfald25/DVC/VillaSmith/neg.cmir' }]));
    } else if (req.url === '/v1/download?path=' + encodeURIComponent('nfald25/DVC/VillaSmith/neg.cmir')) {
      res.writeHead(200).end(Buffer.from(file));
    } else res.writeHead(404).end('{"message":"no"}');
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const dir = mkdtempSync(join(tmpdir(), 'cm-ocl-cli-'));
  try {
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const env = { CARDMIRROR_OPENCASELIST_API: api, CARDMIRROR_GREEN_HOME: dir };
    const out = join(dir, 'batch.json');
    const exportArgs = ['export', '--caselist', 'nfald25', '--school', 'DVC', '--team', 'VillaSmith', '--out', out];

    const signedOut = await run(exportArgs, env);
    expect(signedOut.status).toBe(1);
    expect(signedOut.stderr).toMatch(/Not signed in/);

    // A token saved for another server is never sent here.
    writeFileSync(join(dir, 'opencaselist-session.json'), JSON.stringify({ apiBase: 'https://api.opencaselist.com/v1', token: 'tok-xyz' }));
    expect((await run(exportArgs, env)).stderr).toMatch(/different server/);
    expect(requests).toHaveLength(0);

    writeFileSync(join(dir, 'opencaselist-session.json'), JSON.stringify({ apiBase: api, token: 'tok-xyz' }));
    const ok = await run(exportArgs, env);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout + ok.stderr).not.toContain('tok-xyz');
    const summary = JSON.parse(ok.stdout);
    expect(summary).toMatchObject({ imported: 1, failed: 0, records: 1, byType: { evidence: 1 } });
    const batch = JSON.parse(readFileSync(out, 'utf8'));
    const manifest = JSON.parse(readFileSync(join(dir, 'batch.run.json'), 'utf8'));
    expect(batch.sources[0].id).toBe('opencaselist:nfald25/DVC/VillaSmith/neg.cmir');
    expect(manifest).toMatchObject({ schema: 'cardmirror.opencaselist.run', schemaVersion: 1, batchId: batch.id });
    expect(JSON.stringify(batch) + JSON.stringify(manifest)).not.toContain('tok-xyz');

    // Existing outputs are refused before any network traffic.
    const before = requests.length;
    const again = await run(exportArgs, env);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/already exists/);
    expect(requests.length).toBe(before);

    const listing = await run(['rounds', 'nfald25', 'DVC', 'VillaSmith'], env);
    expect(JSON.parse(listing.stdout)).toEqual([expect.objectContaining({ round_id: 1, opensource: 'nfald25/DVC/VillaSmith/neg.cmir' })]);

    expect((await run(['logout'], env)).status).toBe(0);
    expect(existsSync(join(dir, 'opencaselist-session.json'))).toBe(false);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
