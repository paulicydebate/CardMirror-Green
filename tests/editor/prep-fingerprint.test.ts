import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { parseNative, prepSealFor, serializeNative, serializeNativeAsync, setPrepSeal } from '../../src/native/index.js';
import { prepCanonicalText, prepFingerprint } from '../../src/editor/prep-fingerprint.js';
import { newWorkbook, serializeFlow, setCell } from '../../src/flow/flow-model.js';

function doc(text: string, opts: { comment?: boolean; highlight?: string; cell?: string } = {}) {
  const marks = [
    ...(opts.highlight ? [schema.marks['highlight']!.create({ color: opts.highlight })] : []),
    ...(opts.comment ? [schema.marks['comment_range']!.create({ threadId: 't1' })] : []),
  ];
  let book = newWorkbook('npda');
  if (opts.cell) book = setCell(book, book.sheets[0]!.id, 0, 0, { text: opts.cell });
  return schema.nodes['doc']!.create(null, [
    schema.nodes['paragraph']!.create(null, [schema.text(text, marks)]),
    schema.nodes['flow_workbook']!.create({ data: serializeFlow(book) }),
  ]);
}

describe('prep document fingerprint', () => {
  it('stays the same through save and reopen, and ignores comment anchors', async () => {
    const original = doc('Plan: the USFG should', { highlight: 'green', cell: 'Adv 1' });
    const reopened = parseNative(serializeNative(original, { docId: 'fp-doc' })).doc;
    expect(await prepFingerprint(reopened)).toBe(await prepFingerprint(original));
    const withComment = doc('Plan: the USFG should', { highlight: 'green', comment: true, cell: 'Adv 1' });
    expect(prepCanonicalText(withComment)).toBe(prepCanonicalText(original));
  });

  it('changes when text, formatting or a flow cell changes', async () => {
    const base = await prepFingerprint(doc('Plan', { highlight: 'green', cell: 'Adv 1' }));
    expect(await prepFingerprint(doc('Plan!', { highlight: 'green', cell: 'Adv 1' }))).not.toBe(base);
    expect(await prepFingerprint(doc('Plan', { highlight: 'yellow', cell: 'Adv 1' }))).not.toBe(base);
    expect(await prepFingerprint(doc('Plan', { highlight: 'green', cell: 'Adv 2' }))).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('prep seal in .cmir files', () => {
  it('saves the seal with its document and brings it back on open', async () => {
    const d = doc('sealed');
    const before = await serializeNativeAsync(d, { docId: 'seal-doc' });
    const cert = { format: 'cardmirror.prep-seal', version: 1, entries: [] };
    setPrepSeal('seal-doc', cert);
    // The async cache must not hand back bytes built before the seal existed.
    const after = await serializeNativeAsync(d, { docId: 'seal-doc' });
    expect(after).not.toBe(before);
    const reopened = parseNative(after);
    expect(reopened.prepSeal).toEqual(cert);
    expect(parseNative(serializeNative(d, { docId: 'other-doc' })).prepSeal).toBeUndefined();
    // Opening a sealed file registers its seal, so a later save keeps it.
    const bytes = serializeNative(d, { docId: 'seal-doc' });
    setPrepSeal('seal-doc', undefined as unknown);
    parseNative(bytes);
    expect(prepSealFor('seal-doc')).toEqual(cert);
  });
});
