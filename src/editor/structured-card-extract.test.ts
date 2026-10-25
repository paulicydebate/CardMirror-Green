import { describe, expect, it } from 'vitest';
import { schema } from '../schema/index.js';
import { extractStructuredCards } from './structured-card-extract.js';

const text = (value: string, marks: ReturnType<typeof schema.mark>[] = []) =>
  schema.text(value, marks);
const paragraph = (type: string, ...children: ReturnType<typeof text>[]) =>
  schema.nodes[type]!.create(null, children);
const heading = (type: 'tag' | 'analytic', id: string, label: string) =>
  schema.nodes[type]!.create({ id }, text(label));

describe('extractStructuredCards', () => {
  it('returns tags, citations, full body text, and marks without changing the document', () => {
    const card = schema.nodes.card!.create(null, [
      heading('tag', 'card-1', 'Economy advantage'),
      paragraph('cite_paragraph', text('Smith 2026')),
      paragraph('card_body',
        text('Important ', [schema.marks.highlight!.create({ color: 'yellow' })]),
        text('warrant', [schema.marks.underline_mark!.create()]),
        text(' follows')),
      paragraph('undertag', text('Internal link')),
    ]);
    const doc = schema.nodes.doc!.create(null, [card]);
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
    const a = schema.nodes.analytic_unit!.create(null, [
      heading('analytic', 'analytic-1', 'No link'),
      paragraph('card_body', text('Their evidence is outdated')),
    ]);
    const b = schema.nodes.card!.create(null, [
      heading('tag', 'card-2', 'Impact turn'),
      paragraph('card_body', text('Turns the case')),
    ]);
    const cards = extractStructuredCards(schema.nodes.doc!.create(null, [a, b]));
    expect(cards.map(c => [c.kind, c.id])).toEqual([
      ['analytic_unit', 'analytic-1'], ['card', 'card-2'],
    ]);
    expect(cards[1]!.from).toBe(a.nodeSize);
  });

  it('returns an empty array for documents without cards', () => {
    const doc = schema.nodes.doc!.create(null, [paragraph('paragraph', text('Introduction'))]);
    expect(extractStructuredCards(doc)).toEqual([]);
  });
});
