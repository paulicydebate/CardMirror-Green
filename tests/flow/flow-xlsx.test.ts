import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import pmcRows from './fixtures/ff-pmc-rows.json';
import { newWorkbook, setCell, addSheet } from '../../src/flow/flow-model.js';
import { flowToXlsx, xlsxToFlow, flowSheetToCsv, csvToGrid, safeSheetName } from '../../src/flow/flow-xlsx.js';

function sample() {
  let book = newWorkbook('npda');
  const id = book.sheets[0]!.id;
  (pmcRows as string[]).forEach((t, r) => { if (t) book = setCell(book, id, r, 0, { text: t }); });
  book = setCell(book, id, 1, 1, { text: '=SUM(A1)' });
  book = setCell(book, id, 2, 1, { text: '+1 no link\n- line two\n@mention' });
  book = setCell(book, id, 3, 1, { text: 'A & B <tag> "q"' });
  const added = addSheet(book, 'K: Biopol/Cap [LOC]', 'neg');
  book = setCell(added.book, added.sheetId, 0, 0, { text: '1. Link' });
  return book;
}

describe('flow xlsx export', () => {
  it('writes one worksheet per sheet, speeches in row 1, all cells as text', () => {
    const book = sample();
    const zip = unzipSync(flowToXlsx(book));
    const wb = strFromU8(zip['xl/workbook.xml']!);
    expect(wb).toContain('name="Gov case"');
    expect(wb).toContain('name="K  Biopol Cap  LOC"');
    const s1 = strFromU8(zip['xl/worksheets/sheet1.xml']!);
    expect(s1).toContain('<c r="A1" t="inlineStr" s="2"><is><t xml:space="preserve">PMC</t>');
    expect(s1).not.toMatch(/<f>/);
    expect(s1).not.toMatch(/t="(n|str)"/);
    expect(s1).toContain('A &amp; B &lt;tag&gt;');
  });

  it('round-trips through xlsx import (text, line breaks, = + - @)', () => {
    const book = sample();
    const back = xlsxToFlow(flowToXlsx(book), 'npda');
    expect(back.sheets.map((s) => s.name)).toEqual(['Gov case', 'Off 1', 'K  Biopol Cap  LOC']);
    expect(back.sheets[0]!.columns).toEqual(book.sheets[0]!.columns);
    const col = (b: typeof book, c: number) => b.sheets[0]!.rows.map((r) => r.cells[c]?.text ?? '').slice(0, pmcRows.length);
    expect(col(back, 0)).toEqual(col(book, 0));
    expect(col(back, 1)).toEqual(col(book, 1));
    expect(back.sheets[0]!.rows[2]!.cells[1]!.text).toBe('+1 no link\n- line two\n@mention');
    expect(back.sheets[2]!.rows[0]!.cells[0]!.text).toBe('1. Link');
  });
});

describe('csv + names', () => {
  it('exports the active sheet as CSV and parses it back', () => {
    const sheet = sample().sheets[0]!;
    const csv = flowSheetToCsv(sheet);
    expect(csv.startsWith('PMC,LOC,MG,MO,LOR,PMR\r\n')).toBe(true);
    const grid = csvToGrid(csv);
    expect(grid[2]![1]).toBe('=SUM(A1)');
    expect(grid[3]![1]).toBe('+1 no link\n- line two\n@mention');
    expect(grid[1]![0]).toBe('TOP OF CASE (10/25/26)');
  });
  it('makes Excel-safe unique sheet names', () => {
    const used = new Set<string>();
    expect(safeSheetName('x'.repeat(40), used)).toHaveLength(31);
    expect(safeSheetName('Off 1', used)).toBe('Off 1');
    expect(safeSheetName('off 1', used)).toBe('off 1 (2)');
  });
});
