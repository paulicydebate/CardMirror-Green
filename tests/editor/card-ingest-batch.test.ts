import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import batchSchema from '../../schemas/card-ingest-batch-v1.schema.json';
import { schema } from '../../src/schema/index.js';
import { createIngestBatch, canonicalJson, sha256Bytes, type IngestSource } from '../../src/editor/card-ingest-batch.js';
const source = (id = 'source-a', revision = 'a'): IngestSource => ({ id, format: 'docx', sha256: revision.repeat(64) });
const p = (type: string, text = '', marks: ReturnType<typeof schema.mark>[] = []) => schema.nodes[type]!.create(null, text ? schema.text(text, marks) : undefined);
const card = (id: string | null = 'heading-a', cite = 'Author 2026', body = 'Evidence text') => schema.nodes.card!.createChecked(null, [
  schema.nodes.tag!.create({ id }, schema.text('Tag')), p('cite_paragraph', cite), p('card_body', body),
]);
const doc = (...nodes: ReturnType<typeof card>[]) => schema.nodes.doc!.createChecked(null, nodes);

describe('ingest batch v1', () => {
  it('classifies evidence, analytics, tag-only and incomplete records without dropping them', async () => {
    const analytic = schema.nodes.analytic_unit!.createChecked(null, [p('analytic', 'Analytic argument')]);
    const d = doc(card(), analytic, schema.nodes.card!.createChecked(null, [p('tag', 'Note')]), card(null, '', 'Uncited body'), card('citation-only', 'Author', ''));
    const batch = await createIngestBatch([{ source: source(), doc: d }]);
    expect(batch.schemaVersion).toBe(1);
    expect(batch.records.map(r => r.recordType)).toEqual(['evidence', 'analytic', 'tag_only', 'incomplete', 'incomplete']);
    expect(batch.records[3]!.warnings).toContain('missing-citation');
    expect(batch.records[3]!.warnings).toContain('missing-heading-id');
    expect(batch.records[4]!.warnings).toContain('missing-body');
    expect(batch.records[1]!.warnings).not.toContain('missing-citation');
    expect(batch.summary.byType).toEqual({ evidence: 1, analytic: 1, tag_only: 1, incomplete: 2 });
    expect(batch.summary.records).toBe(5);
  });

  it('keeps exact duplicates with separate provenance and stable IDs across regenerated headings', async () => {
    const a = await createIngestBatch([{ source: source('a'), doc: doc(card('generated-1')) }, { source: source('b'), doc: doc(card('generated-2')) }]);
    const b = await createIngestBatch([{ source: source('a'), doc: doc(card('new-1')) }, { source: source('b'), doc: doc(card('new-2')) }]);
    expect(a.records[0]!.contentHash).toBe(a.records[1]!.contentHash);
    expect(a.records[1]!.duplicateOf).toBe(a.records[0]!.id);
    expect(a.records[0]!.id).not.toBe(a.records[1]!.id);
    expect(a.records.map(r => r.id)).toEqual(b.records.map(r => r.id));
    expect(a.id).toBe(b.id);
    expect(a.summary).toMatchObject({ records: 2, uniqueRecords: 1, duplicates: 1 });
    expect(a.records[1]!.provenance.headingId).toBe('generated-2');
  });

  it('distinguishes changed citation, marks, paragraph boundaries and source revisions', async () => {
    const plain = card();
    const marked = schema.nodes.card!.createChecked(null, [p('tag', 'Tag'), p('cite_paragraph', 'Author 2026'), p('card_body', 'Evidence text', [schema.marks.highlight!.create({ color: 'green' })])]);
    const split = schema.nodes.card!.createChecked(null, [p('tag', 'Tag'), p('cite_paragraph', 'Author 2026'), p('card_body', 'Evidence'), p('card_body', ' text')]);
    const batch = await createIngestBatch([{ source: source(), doc: doc(plain, marked, split, card('x', 'Different author')) }]);
    expect(new Set(batch.records.map(r => r.contentHash)).size).toBe(4);
    const revised = await createIngestBatch([{ source: source('source-a', 'b'), doc: doc(plain) }]);
    expect(revised.records[0]!.id).not.toBe(batch.records[0]!.id);
    expect(revised.records[0]!.contentHash).toBe(batch.records[0]!.contentHash);
  });

  it('preserves rich ordered nodes, outside-card text, and immutable snapshots', async () => {
    const breakBody = schema.nodes.card_body!.create(null, [schema.text('One'), schema.nodes.image!.create({ data: 'synthetic-image', contentType: 'image/png' }), schema.text('Two')]);
    const c = schema.nodes.card!.createChecked(null, [p('tag', 'Tag'), p('cite_paragraph', 'Author'), breakBody]);
    const d = doc(p('paragraph', 'Outside card'), c);
    const before = d.toJSON();
    const batch = await createIngestBatch([{ source: source(), doc: d }]);
    const r = batch.records[0]!;
    expect(r.warnings).toContain('rich-content');
    expect(r.rawNode).toEqual(c.toJSON());
    expect(batch.sources[0]!.document).toEqual(before);
    expect(r.provenance.from).toBe(d.firstChild!.nodeSize);
    expect(r.provenance.to).toBe(r.provenance.from + c.nodeSize);
    r.content.bodies[0]!.text = 'changed snapshot';
    (r.rawNode['attrs'] as Record<string, unknown>)['numRole'] = 'number';
    expect(d.toJSON()).toEqual(before);
  });

  it('keeps table-only content as incomplete rich evidence rather than a tag-only entry', async () => {
    const cell = schema.nodes.table_cell!.createChecked(null, [p('paragraph', 'Table evidence')]);
    const row = schema.nodes.table_row!.createChecked(null, [cell]);
    const table = schema.nodes.table!.createChecked(null, [row]);
    const c = schema.nodes.card!.createChecked(null, [p('tag', 'Tag'), p('cite_paragraph', 'Author'), table]);
    const batch = await createIngestBatch([{ source: source(), doc: doc(c) }]);
    expect(batch.records[0]!.recordType).toBe('incomplete');
    expect(batch.records[0]!.warnings).toContain('rich-content');
    expect(batch.records[0]!.rawNode).toEqual(c.toJSON());
  });

  it('does not count derived references as independent evidence and preserves their snapshot', async () => {
    const ref = schema.nodes.self_ref!.createChecked({ source_heading_id: 'x' }, [card()]);
    const d = doc(ref, card());
    const batch = await createIngestBatch([{ source: source(), doc: d }]);
    expect(batch.records).toHaveLength(1);
    expect(batch.sources[0]!.document).toEqual(d.toJSON());
  });

  it('rejects ambiguous provenance and invalid revisions before returning a batch', async () => {
    const input = { source: source(), doc: doc(card()) };
    await expect(createIngestBatch([input, input])).rejects.toThrow('unique');
    await expect(createIngestBatch([{ ...input, source: { ...source(), sha256: 'bad' } }])).rejects.toThrow('SHA-256');
    await expect(createIngestBatch([{ ...input, source: { ...source(), uri: 'file:///private/path' } }])).rejects.toThrow('HTTP');
    expect((await createIngestBatch([])).summary.records).toBe(0);
  });

  it('canonicalizes object keys while preserving array order and hashes standard SHA-256', async () => {
    expect(canonicalJson({ b: 2, a: [1, 2] })).toBe(canonicalJson({ a: [1, 2], b: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(() => canonicalJson(Number.NaN)).toThrow('JSON');
    expect(await sha256Bytes(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});


describe('published batch JSON Schema', () => {
  it('accepts emitted batches and rejects unknown versions and missing provenance', async () => {
    // The desktop tooling already pins Ajv; no production dependency is added.
    const require = createRequire(resolve('apps/desktop/package.json'));
    const Ajv = require('ajv');
    const validate = new Ajv({ allErrors: true }).compile(batchSchema);
    const batch = await createIngestBatch([{ source: source(), doc: doc(card()) }]);
    expect(validate(batch), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...batch, schemaVersion: 2 })).toBe(false);
    const invalid = structuredClone(batch) as unknown as { records: Array<Record<string, unknown>> };
    delete invalid.records[0]!['provenance'];
    expect(validate(invalid)).toBe(false);
  });
});
