import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { serializeNative, parseNative } from '../../src/native/index.js';
import { extractStructuredCards } from '../../src/editor/structured-card-extract.js';

const text = (value: string, marks: ReturnType<typeof schema.mark>[] = []) =>
  schema.text(value, marks);
const paragraph = (type: string, ...children: ReturnType<typeof text>[]) =>
  schema.nodes[type]!.create(null, children);
const heading = (type: 'tag' | 'analytic', id: string, label: string) =>
  schema.nodes[type]!.create({ id }, text(label));

describe('extractStructuredCards', () => {
  it('returns tags, citations, full body text, and marks without changing the document', () => {
    const card = schema.nodes.card!.createChecked(null, [
      heading('tag', 'card-1', 'Economy advantage'),
      paragraph('cite_paragraph', text('Smith 2026')),
      paragraph('card_body',
        text('Important ', [schema.marks.highlight!.create({ color: 'yellow' })]),
        text('warrant', [schema.marks.underline_mark!.create()]),
        text(' follows')),
      paragraph('undertag', text('Internal link')),
    ]);
    const doc = schema.nodes.doc!.createChecked(null, [card]);
    const before = doc.toJSON();
    const cards = extractStructuredCards(doc);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: 'card-1', kind: 'card', from: 0, to: card.nodeSize,
      tag: { text: 'Economy advantage' },
      citations: [{ text: 'Smith 2026' }],
      bodies: [{ text: 'Important warrant follows' }],
      undertags: [{ text: 'Internal link' }],
    });
    expect(cards[0]!.bodies[0]!.runs[0]!.marks[0]!.type).toBe('highlight');
    expect(cards[0]!.bodies[0]!.runs[1]!.marks[0]!.type).toBe('underline_mark');
    expect(doc.toJSON()).toEqual(before);
  });

  it('handles analytics and multiple cards in document order', () => {
    const a = schema.nodes.analytic_unit!.createChecked(null, [
      heading('analytic', 'analytic-1', 'No link'),
      paragraph('card_body', text('Their evidence is outdated')),
    ]);
    const b = schema.nodes.card!.createChecked(null, [
      heading('tag', 'card-2', 'Impact turn'),
      paragraph('card_body', text('Turns the case')),
    ]);
    const cards = extractStructuredCards(schema.nodes.doc!.createChecked(null, [a, b]));
    expect(cards.map(c => [c.kind, c.id])).toEqual([
      ['analytic_unit', 'analytic-1'], ['card', 'card-2'],
    ]);
    expect(cards[1]!.from).toBe(a.nodeSize);
  });

  it('returns an empty array for documents without cards', () => {
    const doc = schema.nodes.doc!.createChecked(null, [paragraph('paragraph', text('Introduction'))]);
    expect(extractStructuredCards(doc)).toEqual([]);
  });
});


describe('structured-card extraction boundaries', () => {
  const makeCard = (id: string | null, label = 'Evidence') => schema.nodes.card!.createChecked(null, [
    schema.nodes.tag!.create({ id }, text(label)),
    paragraph('cite_paragraph', text('First citation')),
    paragraph('cite_paragraph', text('Second citation')),
    paragraph('card_body', text('Bold link', [schema.marks.bold!.create()])),
    paragraph('card_body', text('Second paragraph')),
    paragraph('undertag', text('Qualification')),
  ]);

  it('preserves separate citations and body paragraphs, including empty bodies', () => {
    const card = makeCard('real');
    const emptyBody = paragraph('card_body');
    const doc = schema.nodes.doc!.createChecked(null, [card, schema.nodes.card!.createChecked(null, [heading('tag', 'empty', 'Empty'), emptyBody])]);
    const cards = extractStructuredCards(doc);
    expect(cards[0]!.citations.map(p => p.text)).toEqual(['First citation', 'Second citation']);
    expect(cards[0]!.bodies.map(p => p.text)).toEqual(['Bold link', 'Second paragraph']);
    expect(cards[1]!.bodies).toEqual([{kind: 'card_body', text: '', runs: []}]);
  });

  it('leaves legacy missing IDs unset and preserves offsets after outline headings', () => {
    const outline = schema.nodes.block!.create({ id: 'outline' }, text('Outline'));
    const card = makeCard(null);
    const doc = schema.nodes.doc!.createChecked(null, [outline, card]);
    const before = doc.toJSON();
    expect(extractStructuredCards(doc)[0]).toMatchObject({ id: null, from: outline.nodeSize, to: outline.nodeSize + card.nodeSize });
    expect(doc.toJSON()).toEqual(before);
  });

  it('skips derived live views and linked copies without duplicating their cards', () => {
    const card = makeCard('source');
    const live = schema.nodes.self_ref!.createChecked({ source_heading_id: 'source' }, [makeCard('mirror')]);
    const linked = schema.nodes.transclusion_ref!.createChecked({ source_ref: 'other.cmir', source_heading_id: 'source' }, [makeCard('linked')]);
    const doc = schema.nodes.doc!.createChecked(null, [live, card, linked]);
    expect(extractStructuredCards(doc).map(c => c.id)).toEqual(['source']);
    expect(extractStructuredCards(doc)[0]!.from).toBe(live.nodeSize);
  });

  it('preserves mark attributes and returns an independent snapshot', () => {
    const mark = schema.marks.highlight!.create({ color: 'yellow' });
    const card = schema.nodes.card!.createChecked(null, [heading('tag', 'marks', 'Marked'), paragraph('card_body', text('Exact text', [mark]))]);
    const doc = schema.nodes.doc!.createChecked(null, [card]);
    const result = extractStructuredCards(doc);
    expect(result[0]!.bodies[0]!.runs[0]!.marks).toEqual([{ type: 'highlight', attrs: { ...mark.attrs } }]);
    result[0]!.bodies[0]!.runs[0]!.marks[0]!.attrs['color'] = 'changed';
    expect(extractStructuredCards(doc)[0]!.bodies[0]!.runs[0]!.marks[0]!.attrs).toEqual({ ...mark.attrs });
  });

  it('returns the same evidence after a native document save and reopen', () => {
    const doc = schema.nodes.doc!.createChecked(null, [makeCard('saved')]);
    const reopened = parseNative(serializeNative(doc, { appVersion: 'test' }));
    expect(extractStructuredCards(reopened.doc)).toEqual(extractStructuredCards(doc));
  });
});
