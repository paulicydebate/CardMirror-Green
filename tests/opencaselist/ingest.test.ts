import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import { toDocx } from '../../src/export/index.js';
import { parseToDoc } from '../../src/tools/cardmirror-read-lib.js';
import { sha256Bytes } from '../../src/editor/card-ingest-batch.js';
import { OpenCaselistClient, type Transport } from '../../src/opencaselist/client.js';
import { ingestOpenCaselist } from '../../src/opencaselist/ingest.js';

function cardDoc(tag: string, cite: string, body: string) {
  return schema.nodes.doc!.createChecked(null, [schema.nodes.card!.createChecked(null, [
    schema.nodes.tag!.create({ id: 'id-' + tag.replace(/\W/g, '') }, schema.text(tag)),
    schema.nodes.cite_paragraph!.create(null, [schema.text(cite, [schema.marks.cite_mark!.create()]), schema.text(' | [Author; 2026; quals; Journal]')]),
    schema.nodes.card_body!.create(null, schema.text(body)),
  ])]);
}

// Built once: serialized files embed save times, and the fake server must serve fixed bytes.
const shared = await toDocx(cardDoc('Single payer saves money', 'Pandey 26', 'Savings evidence'));
const cmir = serializeNative(cardDoc('Overhead is waste', 'Weissman 26', 'Overhead evidence'), { appVersion: 'test' });

/** A fake OpenCaselist: routes by URL path, counts requests. */
async function fakeServer(options: { failTeam?: string; status401?: boolean } = {}) {
  const files: Record<string, Uint8Array> = {
    'nfald25/DVC/VillaSmith/aff-single-payer.docx': shared,
    'nfald25/DVC/VillaSmith/neg-cap-k.cmir': cmir,
    'nfald25/DVC/VillaSmith/old-file.pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    'nfald25/DVC/JonesLee/broken.docx': new Uint8Array([1, 2, 3]),
    'nfald25/DVC/JonesLee/same-aff.docx': shared,
  };
  const rounds: Record<string, unknown[]> = {
    VillaSmith: [
      { round_id: 12, tournament: 'Gonzaga', side: 'A', round: '2', opponent: 'X', judge: 'J', opensource: 'nfald25/DVC/VillaSmith/aff-single-payer.docx', created_at: '2026-10-01' },
      { round_id: 11, tournament: 'Gonzaga', side: 'A', round: '1', opponent: 'Y', judge: 'K', opensource: 'nfald25/DVC/VillaSmith/aff-single-payer.docx' },
      { round_id: 13, tournament: 'Gonzaga', side: 'N', round: '3', opensource: 'nfald25/DVC/VillaSmith/neg-cap-k.cmir' },
      { round_id: 14, tournament: 'Lewis & Clark', side: 'N', round: '1', opensource: 'nfald25/DVC/VillaSmith/old-file.pdf' },
      { round_id: 15, tournament: 'Lewis & Clark', side: 'N', round: '2', opensource: null },
    ],
    JonesLee: [
      { round_id: 21, side: 'A', opensource: 'nfald25/DVC/JonesLee/broken.docx' },
      { round_id: 22, side: 'A', opensource: 'nfald25/DVC/JonesLee/same-aff.docx' },
    ],
  };
  const requests: string[] = [];
  const transport: Transport = async url => {
    const u = new URL(url);
    requests.push(u.pathname + u.search);
    if (options.status401) return new Response('{"message":"Not Authorized"}', { status: 401 });
    const parts = u.pathname.replace('/v1/', '').split('/').map(decodeURIComponent);
    if (parts[0] === 'download') {
      const file = files[u.searchParams.get('path') ?? ''];
      return file ? new Response(new Uint8Array(file), { status: 200 }) : new Response('{"message":"missing"}', { status: 404 });
    }
    if (parts.length === 5 && parts[4] === 'teams') return Response.json([{ name: 'VillaSmith' }, { name: 'JonesLee' }, { name: 'Ghost' }]);
    if (parts.length === 7 && parts[6] === 'rounds') {
      const team = parts[5]!;
      if (team === options.failTeam) return new Response('{"message":"boom"}', { status: 500 });
      if (!rounds[team]) return new Response('{"message":"Team not found"}', { status: 404 });
      const side = u.searchParams.get('side');
      return Response.json(rounds[team]!.filter(r => !side || (r as { side?: string }).side === side));
    }
    return new Response('{"message":"unknown route"}', { status: 404 });
  };
  const client = new OpenCaselistClient({ token: 't', fetch: transport, minIntervalMs: 0, maxAttempts: 1, sleep: async () => {} });
  return { client, files, requests };
}
const fixedNow = () => new Date('2026-10-25T00:00:00Z');

describe('ingestOpenCaselist', () => {
  it('imports each unique file once, keeps provenance, and reports skips and failures separately', async () => {
    const { client, files, requests } = await fakeServer();
    const { batch, manifest } = await ingestOpenCaselist({ client, parse: parseToDoc, scope: { caselist: 'nfald25', school: 'DVC' }, now: fixedNow });

    // Shared file path listed by two rounds is downloaded once.
    expect(requests.filter(r => r.includes('aff-single-payer'))).toHaveLength(1);
    expect(manifest.summary).toMatchObject({ teams: 3, rounds: 7, roundsWithFiles: 6, uniqueFiles: 5, notAttempted: 0, imported: 3, skipped: 1, failed: 1, records: 3 });
    expect(manifest.discoveryErrors).toEqual([{ school: 'DVC', team: 'Ghost', message: expect.stringMatching(/404/), httpStatus: 404 }]);

    const byPath = Object.fromEntries(manifest.documents.map(d => [d.path, d]));
    expect(byPath['nfald25/DVC/VillaSmith/old-file.pdf']).toMatchObject({ status: 'skipped', reason: 'unsupported-format' });
    expect(byPath['nfald25/DVC/JonesLee/broken.docx']).toMatchObject({ status: 'failed', reason: 'not-a-docx', bytes: 3 });
    const aff = byPath['nfald25/DVC/VillaSmith/aff-single-payer.docx']!;
    expect(aff.rounds.map(r => r.roundId)).toEqual([11, 12]);
    expect(aff.rounds[1]).toMatchObject({ tournament: 'Gonzaga', side: 'A', round: '2', opponent: 'X', judge: 'J', team: 'VillaSmith', createdAt: '2026-10-01' });

    expect(batch).not.toBeNull();
    expect(manifest.batchId).toBe(batch!.id);
    const source = batch!.sources.find(s => s.id === 'opencaselist:nfald25/DVC/VillaSmith/aff-single-payer.docx')!;
    expect(source).toMatchObject({ format: 'docx', title: 'aff-single-payer.docx',
      uri: 'https://api.opencaselist.com/v1/download?path=nfald25%2FDVC%2FVillaSmith%2Faff-single-payer.docx' });
    expect(source.sha256).toBe(await sha256Bytes(files['nfald25/DVC/VillaSmith/aff-single-payer.docx']!));
    expect(batch!.summary.byType.evidence).toBe(3);
    // The same aff disclosed by two teams is an exact duplicate: retained and annotated, not dropped.
    expect(batch!.summary).toMatchObject({ records: 3, uniqueRecords: 2, duplicates: 1 });
    expect(JSON.stringify(batch)).not.toContain('Ghost');
  });

  it('is repeatable: same remote state gives the same batch and record IDs', async () => {
    const a = await ingestOpenCaselist({ client: (await fakeServer()).client, parse: parseToDoc, scope: { caselist: 'nfald25', school: 'DVC' }, now: fixedNow });
    const b = await ingestOpenCaselist({ client: (await fakeServer()).client, parse: parseToDoc, scope: { caselist: 'nfald25', school: 'DVC' }, now: fixedNow });
    expect(b.batch!.id).toBe(a.batch!.id);
    expect(b.batch!.records.map(r => r.id)).toEqual(a.batch!.records.map(r => r.id));
    expect(b.manifest).toEqual(a.manifest);
  });

  it('narrows to one team and side, and caps the number of files', async () => {
    const { client, requests } = await fakeServer();
    const { manifest } = await ingestOpenCaselist({ client, parse: parseToDoc, maxDocuments: 1,
      scope: { caselist: 'nfald25', school: 'DVC', team: 'VillaSmith', side: 'N' }, now: fixedNow });
    expect(requests.some(r => r.endsWith('/teams'))).toBe(false);
    expect(manifest.summary).toMatchObject({ teams: 1, uniqueFiles: 2, notAttempted: 1 });
    expect(manifest.documents.map(d => d.path)).toEqual(['nfald25/DVC/VillaSmith/neg-cap-k.cmir']);
    expect(requests.filter(r => r.startsWith('/v1/download'))).toHaveLength(1);
  });

  it('records a failed team listing and continues, but stops on an expired session', async () => {
    const { client } = await fakeServer({ failTeam: 'JonesLee' });
    const { manifest } = await ingestOpenCaselist({ client, parse: parseToDoc, scope: { caselist: 'nfald25', school: 'DVC' }, now: fixedNow });
    expect(manifest.discoveryErrors.map(e => [e.team, e.httpStatus])).toEqual([['Ghost', 404], ['JonesLee', 500]]);
    expect(manifest.summary.imported).toBe(2);
    const expired = await fakeServer({ status401: true });
    await expect(ingestOpenCaselist({ client: expired.client, parse: parseToDoc, scope: { caselist: 'nfald25', school: 'DVC', team: 'VillaSmith' } }))
      .rejects.toMatchObject({ status: 401 });
  });

  it('records parse failures without stopping the run', async () => {
    const { client } = await fakeServer();
    const { manifest, batch } = await ingestOpenCaselist({ client, scope: { caselist: 'nfald25', school: 'DVC', team: 'VillaSmith' }, now: fixedNow,
      parse: async (bytes, kind) => { if (kind === 'cmir') throw new Error('damaged file'); return parseToDoc(bytes, kind); } });
    expect(manifest.documents.find(d => d.path.endsWith('.cmir'))).toMatchObject({ status: 'failed', reason: 'parse-failed', message: 'damaged file' });
    expect(batch!.summary.sources).toBe(1);
  });
});
