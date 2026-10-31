import { describe, expect, it } from 'vitest';
import pmcRows from './fixtures/ff-pmc-rows.json';
import { schema } from '../../src/schema/index.js';
import { docToFlowOutline, outlineFromDoc, applyOutlineToWorkbook, outlineLine, type DocBlock } from '../../src/flow/doc-to-flow.js';
import { newWorkbook } from '../../src/flow/flow-model.js';

const HEADINGS = /^(TOP OF CASE|PLAN TEXT|ADVANTAGE \d|SOLVENCY)/;
// Rebuild the Factory Farming PMC as a speech doc: headings as blocks,
// claims un-indented (the importer must re-indent), a card body after each
// lettered subpoint (must be skipped), blank lines as blank paragraphs.
function ffBlocks(): DocBlock[] {
  const out: DocBlock[] = [];
  for (const row of pmcRows as string[]) {
    if (!row) { out.push({ kind: 'blank', text: '' }); continue; }
    if (HEADINGS.test(row)) { out.push({ kind: 'heading', text: row }); continue; }
    out.push({ kind: 'analytic', text: row.trimStart() });
    if (/^\s+[a-z]\./.test(row)) {
      out.push({ kind: 'cite', text: 'CDC 24' }, { kind: 'body', text: 'card body text that must not reach the flow' });
    }
  }
  return out;
}

describe('docToFlowOutline (Factory Farming PMC fixture)', () => {
  it('reproduces build_ff_flow_1to1.py PMC_ROWS 1-to-1', () => {
    const outline = docToFlowOutline(ffBlocks(), 'PMC Factory Farming');
    expect(outline.sheets).toHaveLength(1);
    const expected = [...(pmcRows as string[])];
    while (expected[expected.length - 1] === '') expected.pop();
    expect(outline.sheets[0]!.rows).toEqual(expected);
  });

  it('keeps prefixes and indents lettered subpoints by 3 spaces', () => {
    expect(outlineLine('a. warrant')).toBe('   a. warrant');
    expect(outlineLine('      b. warrant')).toBe('   b. warrant');
    expect(outlineLine('1. claim')).toBe('1. claim');
    expect(outlineLine('A. Uniqueness')).toBe('A. Uniqueness');
    expect(outlineLine('ii. sub')).toBe('      ii. sub');
  });

  it('puts off-case positions on their own neg sheets', () => {
    const o = docToFlowOutline([
      { kind: 'heading', text: 'Aff case' }, { kind: 'tag', text: '1. claim' },
      { kind: 'heading', text: 'T - Substantial' }, { kind: 'analytic', text: 'A. Interpretation' },
      { kind: 'heading', text: 'DA: Midterms' }, { kind: 'tag', text: '1. Uniqueness' }, { kind: 'body', text: 'x' },
      { kind: 'heading', text: 'K - Biopolitics' }, { kind: 'text', text: 'a. link' },
    ]);
    expect(o.sheets.map((s) => [s.name, s.side, s.rows])).toEqual([
      ['Case', null, ['Aff case', '1. claim']],
      ['T - Substantial', 'neg', ['A. Interpretation']],
      ['DA: Midterms', 'neg', ['1. Uniqueness']],
      ['K - Biopolitics', 'neg', ['   a. link']],
    ]);
  });
});

describe('outlineFromDoc / applyOutlineToWorkbook', () => {
  it('reads a CardMirror doc, skipping card bodies and cites', () => {
    const t = (s: string) => schema.text(s);
    const doc = schema.nodes.doc!.createChecked(null, [
      schema.nodes.block!.create(null, t('ADVANTAGE 1: PANDEMICS')),
      schema.nodes.card!.createChecked(null, [
        schema.nodes.tag!.create({ id: 'c1' }, t('1. Bird flu is here')),
        schema.nodes.cite_paragraph!.create(null, t('CDC 24')),
        schema.nodes.card_body!.create(null, t('long evidence')),
      ]),
      schema.nodes.block!.create(null, t('CP - States')),
      schema.nodes.paragraph!.create(null, t('a. States solve')),
    ]);
    const o = outlineFromDoc(doc, 'Aff case');
    expect(o.sheets[0]!.rows).toEqual(['ADVANTAGE 1: PANDEMICS', '1. Bird flu is here']);
    expect(o.sheets[1]).toMatchObject({ name: 'CP - States', rows: ['   a. States solve'] });

    const book = newWorkbook('policy');
    const sheetId = book.sheets[0]!.id;
    const next = applyOutlineToWorkbook(book, sheetId, 0, o);
    expect(next.sheets[0]!.rows.slice(0, 2).map((r) => r.cells[0]!.text)).toEqual(o.sheets[0]!.rows);
    expect(next.sheets.at(-1)!.name).toBe('CP - States');
    expect(next.sheets.at(-1)!.side).toBe('neg');
    expect(next.sheets.at(-1)!.columns[0]).toBe('1NC');
    expect(next.sheets.at(-1)!.rows[0]!.cells[0]!.text).toBe('   a. States solve');
    expect(book.sheets[0]!.rows[0]!.cells[0]!.text).toBe(''); // input untouched
  });
});
