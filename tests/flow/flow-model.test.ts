import { describe, expect, it } from 'vitest';
import {
  addSheet,
  columnSide,
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
  placeColumnSections,
  renameSheet,
  serializeFlow,
  setCell,
  setPrep,
  shiftRanges,
  toggleRange,
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
    const gov = book.sheets[0]!;
    expect(gov.columns.map((_, i) => columnSide('npda', gov, i))).toEqual(['aff', 'neg', 'aff', 'neg', 'neg', 'aff']);
    const custom = { ...gov, columns: ['X', 'Y'] };
    expect([0, 1].map((i) => columnSide('npda', custom, i))).toEqual(['aff', 'neg']);
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

  it('round-trips through save/load, keeping every row id', () => {
    let book = newWorkbook('policy');
    book = setCell(book, book.sheets[0]!.id, 2, 0, { text: 'Adv 1 — econ', crossed: true });
    const saved = serializeFlow(book);
    expect(JSON.parse(saved).sheets[0].rows).toHaveLength(20);
    const loaded = parseFlow(saved);
    expect(loaded.event).toBe('policy');
    expect(loaded.sheets[0]!.rows).toHaveLength(20);
    expect(cellAt(loaded.sheets[0]!, 2, 0)).toEqual({ text: 'Adv 1 — econ', crossed: true });
    expect(loaded.sheets[0]!.rows[2]!.id).toBe(book.sheets[0]!.rows[2]!.id);
  });

  it('pads short files with the same row ids on every computer', () => {
    const data = JSON.stringify({ format: 'cardmirror.flow', version: 1, event: 'npda', sheets: [{ id: 's1', name: 'Gov', side: 'aff', columns: ['PMC', 'LOC'], rows: [{ cells: [{ text: 'x' }] }] }] });
    const a = parseFlow(data).sheets[0]!.rows.map((r) => r.id);
    const b = parseFlow(data).sheets[0]!.rows.map((r) => r.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe('s1~0');
    expect(a).toHaveLength(20);
  });

  it('keeps highlight ranges and prep cells through save/load and edits', () => {
    let book = newWorkbook('npda');
    const id = book.sheets[0]!.id;
    book = setCell(book, id, 0, 0, { text: 'nuclear war is likely', hl: [[0, 11], [15, 21], [99, 120]] });
    book = setPrep(book, id, 0, { text: 'Thumper: China tensions', hl: [[0, 7]] });
    const back = parseFlow(serializeFlow(book));
    expect(cellAt(back.sheets[0]!, 0, 0).hl).toEqual([[0, 11], [15, 21]]);
    expect(back.sheets[0]!.rows[0]!.prep).toEqual({ text: 'Thumper: China tensions', hl: [[0, 7]] });
    expect(setPrep(back, id, 0, { text: '', hl: [] }).sheets[0]!.rows[0]!.prep).toBeUndefined();
  });

  it('moves highlights with typing and toggles ranges', () => {
    expect(shiftRanges([[4, 8]], 'the war now', 'the big war now')).toEqual([[8, 12]]);
    expect(shiftRanges([[4, 11]], 'the war now', 'the waXr now')).toEqual([[4, 12]]);
    expect(shiftRanges([[4, 7]], 'the war now', 'the wars now')).toEqual([[4, 8]]);
    expect(shiftRanges([[4, 7]], 'the war now', 'the now')).toEqual([]);
    expect(shiftRanges([[0, 3]], 'the war', 'X the war')).toEqual([[2, 5]]);
    expect(toggleRange([], 2, 5, 10)).toEqual([[2, 5]]);
    expect(toggleRange([[0, 10]], 2, 5, 10)).toEqual([[0, 2], [5, 10]]);
    expect(toggleRange([[0, 3]], 2, 6, 10)).toEqual([[0, 6]]);
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

  it('keeps a blank argument as a blank cell between its neighbors', () => {
    const s = sheetWith([], ['x', 'y', 'z']);
    const placed = placeColumnSections(s, 0, [
      { rowId: null, text: 'res' },
      { rowId: null, text: '' },
      { rowId: null, text: 'Plan' },
    ]);
    expect(placed.sheet.rows.slice(0, 3).map((r) => r.cells[0]!.text)).toEqual(['res', '', 'Plan']);
    expect(placed.rowIds).toEqual(['r0', 'r1', 'r2']);
    // Committing again with the learned ids keeps the gap.
    const again = applyColumnSections(placed.sheet, 0, [
      { rowId: 'r0', text: 'res' }, { rowId: 'r1', text: '  ' }, { rowId: 'r2', text: 'Plan' }, { rowId: null, text: 'Adv' },
    ]);
    expect(again.rows.slice(0, 4).map((r) => r.cells[0]!.text)).toEqual(['res', '  ', 'Plan', 'Adv']);
  });

  it('empties the cells of deleted sections but keeps their rows', () => {
    const s = sheetWith(['A1', 'A2'], ['x', 'y']);
    const out = applyColumnSections(s, 0, [{ rowId: 'r1', text: 'A2' }]);
    expect(out.rows.map((r) => [r.cells[0]!.text, r.cells[1]!.text])).toEqual([['', 'x'], ['A2', 'y']]);
  });
});
