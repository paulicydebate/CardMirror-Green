import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { serializeNative, parseNative } from '../../src/native/index.js';
import { extractStructuredCards, extractCardsV1, EXTRACT_CARDS_API_VERSION } from '../../src/editor/structured-card-extract.js';

const m = schema.marks;
const t = (v: string, marks: ReturnType<typeof schema.mark>[] = []) => schema.text(v, marks);
const hl = (color: string) => m.highlight!.create({ color });

// Fixture: a pocket > hat > block outline with a card using every mark the
// cutters care about (underline, two highlight levels, bold, stacked marks)
// plus an analytic and a table nested inside the card.
function fixture() {
  const card = schema.nodes.card!.createChecked(null, [
    schema.nodes.tag!.create({ id: 'c1' }, [t('Warming ', [m.bold!.create()]), t('outweighs')]),
    schema.nodes.cite_paragraph!.create(null, [t('Smith 26', [m.bold!.create()]), t(' — Prof, MIT')]),
    schema.nodes.card_body!.create(null, [
      t('plain '),
      t('underlined ', [m.underline_mark!.create()]),
      t('yellow ', [m.underline_mark!.create(), hl('yellow')]),
      t('cyan ', [m.underline_mark!.create(), hl('cyan')]),
      t('bold-all', [m.bold!.create(), m.underline_mark!.create(), hl('green')]),
    ]),
    schema.nodes.table!.createChecked(null, [
      schema.nodes.table_row!.createChecked(null, [
        schema.nodes.table_cell!.createChecked(null, [schema.nodes.paragraph!.create(null, t('Year'))]),
        schema.nodes.table_cell!.createChecked(null, [schema.nodes.paragraph!.create(null, t('2.4C', [hl('yellow')]))]),
      ]),
    ]),
  ]);
  const analytic = schema.nodes.analytic_unit!.createChecked(null, [
    schema.nodes.analytic!.create({ id: 'a1' }, t('Extend: no link')),
  ]);
  return schema.nodes.doc!.createChecked(null, [
    schema.nodes.pocket!.create(null, t('1AC')),
    schema.nodes.hat!.create(null, t('Advantage')),
    schema.nodes.block!.create(null, t('Impact')),
    card, analytic,
  ]);
}
const markSig = (marks: Array<{ type: string; attrs: Record<string, unknown> }>) =>
  marks.map((x) => x.type === 'highlight' ? `highlight:${String(x.attrs['color'])}` : x.type).sort();

describe('structured extraction fixtures', () => {
  it('keeps underline, highlight levels, bold and stacked marks per run', () => {
    const [card] = extractStructuredCards(fixture());
    const runs = card!.bodies[0]!.runs;
    expect(runs.map((r) => [r.text, markSig(r.marks)])).toEqual([
      ['plain ', []],
      ['underlined ', ['underline_mark']],
      ['yellow ', ['highlight:yellow', 'underline_mark']],
      ['cyan ', ['highlight:cyan', 'underline_mark']],
      ['bold-all', ['bold', 'highlight:green', 'underline_mark']],
    ]);
    expect(card!.tag!.runs.map((r) => markSig(r.marks))).toEqual([['bold'], []]);
    expect(card!.citations[0]!.runs[0]!.marks[0]!.type).toBe('bold');
  });

  it('finds cards nested under pocket/hat/block and keeps nested table text', () => {
    const cards = extractStructuredCards(fixture());
    expect(cards.map((c) => [c.kind, c.id])).toEqual([['card', 'c1'], ['analytic_unit', 'a1']]);
    expect(cards[0]!.tables.map((p) => p.text)).toEqual(['Year', '2.4C']);
    expect(markSig(cards[0]!.tables[1]!.runs[0]!.marks)).toEqual(['highlight:yellow']);
  });

  it('survives a .cmir save/load round trip unchanged', () => {
    const doc = fixture();
    const reopened = parseNative(serializeNative(doc, { appVersion: 'test' }));
    expect(extractStructuredCards(reopened.doc)).toEqual(extractStructuredCards(doc));
  });
});

describe('extractCardsV1 (versioned read-only API)', () => {
  it('is versioned, JSON-safe, frozen and does not touch the doc', () => {
    const doc = fixture();
    const before = doc.toJSON();
    const res = extractCardsV1(doc);
    expect(res.apiVersion).toBe(EXTRACT_CARDS_API_VERSION);
    expect(res.apiVersion).toBe(1);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
    expect(res.cards).toEqual(extractStructuredCards(doc));
    expect(Object.isFrozen(res.cards[0]!.bodies[0]!.runs[0])).toBe(true);
    expect(() => { (res.cards as unknown as unknown[]).push(1); }).toThrow();
    expect(doc.toJSON()).toEqual(before);
  });
});
