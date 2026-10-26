import { describe, expect, it } from 'vitest';
import {
  addSheet,
  applyColumnSections,
  cellAt,
  columnToSections,
  deleteRows,
  deleteSheet,
  FlowParseError,
  insertRows,
  moveSheet,
  newSheet,
  newWorkbook,
  nextOffName,
  parseFlow,
  renameSheet,
  serializeFlow,
  setCell,
  type FlowSheet,
} from '../../src/flow/flow-model.js';

function sheetWith(col0: string[], col1: string[] = []): FlowSheet {
  const s = newSheet('T', 'aff', ['PMC', 'LOC', 'MG'], Math.max(col0.length, col1.length));
  s.rows.forEach((r, i) => { r.id = 'r' + i; r.cells[0] = { text: col0[i] ?? '' }; r.cells[1] = { text: col1[i] ?? '' }; });
  return s;
}

describe('flow workbook', () => {
  it('starts an NPDA flow with a Gov case sheet and an Opp off-case sheet', () => {
    const book = newWorkbook('npda');
    expect(book.sheets.map((s) => [s.name, s.side, s.columns.join(' ')])).toEqual([
      ['Gov case', 'aff', 'PMC LOC MG MO LOR PMR'],
      ['Off 1', 'neg', 'LOC MG MO LOR PMR'],
    ]);
    expect(book.sheets[0]!.rows).toHaveLength(20);
    expect(newWorkbook('policy').sheets[1]!.columns[0]).toBe('1NC');
    expect(newWorkbook('nope').event).toBe('npda');
  });

  it('edits cells, rows and sheets without mutating the original', () => {
    const book = newWorkbook('npda');
    const id = book.sheets[0]!.id;
    const edited = setCell(book, id, 0, 1, { text: 'T - we meet', bold: true });
    expect(cellAt(edited.sheets[0]!, 0, 1)).toEqual({ text: 'T - we meet', bold: true });
    expect(cellAt(book.sheets[0]!, 0, 1)).toEqual({ text: '' });
    const grown = setCell(book, id, 30, 0, { text: 'far down' });
    expect(grown.sheets[0]!.rows).toHaveLength(31);
    expect(setCell(book, id, 0, 99, { text: 'x' })).toEqual(book);

    const withRow = insertRows(edited, id, 0, 2);
    expect(cellAt(withRow.sheets[0]!, 2, 1).text).toBe('T - we meet');
    expect(deleteRows(withRow, id, 0, 2).sheets[0]!.rows[0]!.cells[1]!.text).toBe('T - we meet');

    const { book: more, sheetId } = addSheet(book, nextOffName(book), 'neg', id);
    expect(more.sheets.map((s) => s.name)).toEqual(['Gov case', 'Off 2', 'Off 1']);
    expect(renameSheet(more, sheetId, '  Politics   DA ').sheets[1]!.name).toBe('Politics DA');
    expect(moveSheet(more, sheetId, 5).sheets.map((s) => s.name)).toEqual(['Gov case', 'Off 1', 'Off 2']);
    const one = deleteSheet(deleteSheet(more, sheetId), id);
    expect(deleteSheet(one, one.sheets[0]!.id).sheets).toHaveLength(1); // last sheet stays
  });

  it('round-trips through save/load, trimming and re-padding empty rows', () => {
    let book = newWorkbook('policy');
    book = setCell(book, book.sheets[0]!.id, 2, 0, { text: 'Adv 1 — econ', crossed: true });
    const saved = serializeFlow(book);
    expect(JSON.parse(saved).sheets[0].rows).toHaveLength(3);
    const loaded = parseFlow(saved);
    expect(loaded.event).toBe('policy');
    expect(loaded.sheets[0]!.rows).toHaveLength(20);
    expect(cellAt(loaded.sheets[0]!, 2, 0)).toEqual({ text: 'Adv 1 — econ', crossed: true });
    expect(loaded.sheets[0]!.rows[2]!.id).toBe(book.sheets[0]!.rows[2]!.id);
  });

  it('rejects files that are not flows', () => {
    expect(() => parseFlow('nope')).toThrow(FlowParseError);
    expect(() => parseFlow('{"format":"other"}')).toThrow(FlowParseError);
    expect(() => parseFlow('{"format":"cardmirror.flow","version":2,"sheets":[]}')).toThrow('Unsupported flow version 2.');
    expect(() => parseFlow('{"format":"cardmirror.flow","version":1,"sheets":[{"columns":[]}]}')).toThrow('Sheet 1 has no columns.');
  });
});

describe('column as document', () => {
  it('lists non-empty cells top to bottom with their row ids', () => {
    const s = sheetWith(['A1', '', 'A3'], ['', 'B2']);
    expect(columnToSections(s, 0)).toEqual([{ rowId: 'r0', text: 'A1' }, { rowId: 'r2', text: 'A3' }]);
  });

  it('writes edits back, keeps rows aligned, and places new sections below the previous one', () => {
    const s = sheetWith(['A1', '', 'A3', ''], ['x', 'B2', 'y', 'z']);
    const out = applyColumnSections(s, 0, [
      { rowId: 'r0', text: 'A1 edited' },
      { rowId: null, text: 'new after A1' },  // fills the empty cell in r1
      { rowId: null, text: 'second new' },    // r2 is taken by A3 → inserted row
      { rowId: 'r2', text: 'A3' },
    ]);
    expect(out.rows.map((r) => [r.cells[0]!.text, r.cells[1]!.text])).toEqual([
      ['A1 edited', 'x'],
      ['new after A1', 'B2'],
      ['second new', ''],
      ['A3', 'y'],
      ['', 'z'],
    ]);
  });

  it('empties the cells of deleted sections but keeps their rows', () => {
    const s = sheetWith(['A1', 'A2'], ['x', 'y']);
    const out = applyColumnSections(s, 0, [{ rowId: 'r1', text: 'A2' }]);
    expect(out.rows.map((r) => [r.cells[0]!.text, r.cells[1]!.text])).toEqual([['', 'x'], ['A2', 'y']]);
  });
});
