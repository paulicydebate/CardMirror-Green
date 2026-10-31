import { describe, expect, it } from 'vitest';
import { EditHistory, maxFlowClock, mergeIncoming, stampFlowEdit } from '../../src/flow/flow-merge.js';
import { newWorkbook, parseFlow, serializeFlow, setCell, setPrep, moveSheet } from '../../src/flow/flow-model.js';

describe('versioned flow cell merges', () => {
  it('converges on different-sheet edits regardless of receive order or delay', () => {
    const base = newWorkbook();
    const a = stampFlowEdit(base, setCell(base, base.sheets[0]!.id, 0, 0, {text: 'Gov'}), 'a', 1);
    const b = stampFlowEdit(base, setCell(base, base.sheets[1]!.id, 0, 0, {text: 'Off'}), 'b', 1);
    const ab = mergeIncoming(a, b, new EditHistory(), 60_000).book;
    const ba = mergeIncoming(b, a, new EditHistory(), 60_000).book;
    expect(serializeFlow(ab)).toBe(serializeFlow(ba));
    expect(ab.sheets[0]!.rows[0]!.cells[0]!.text).toBe('Gov');
    expect(ab.sheets[1]!.rows[0]!.cells[0]!.text).toBe('Off');
  });
  it('retains sheet-order revisions through saving and independent cell updates', () => {
    const base = newWorkbook();
    const reordered = stampFlowEdit(base, moveSheet(base, base.sheets[1]!.id,0), 'a', 1);
    const saved = parseFlow(serializeFlow(reordered));
    const typed = stampFlowEdit(base, setCell(base,base.sheets[0]!.id,0,0,{text:'Gov'}), 'b',2);
    const merged = mergeIncoming(typed, saved, new EditHistory(),0).book;
    expect(merged.sheets.map(s => s.name)).toEqual(['Off 1','Gov case']);
    expect(merged.sheets[1]!.rows[0]!.cells[0]!.text).toBe('Gov');
    expect(merged.orderRevision).toEqual({actor:'a',clock:1});
  });
  it('does not undo a partner sheet reorder while reverting a local cell edit', () => {
    const base = newWorkbook();
    const typed = stampFlowEdit(base,setCell(base,base.sheets[0]!.id,0,0,{text:'Gov'}),'a',1);
    const reordered = stampFlowEdit(typed,moveSheet(typed,typed.sheets[1]!.id,0),'b',2);
    const undone = stampFlowEdit(reordered,base,'a',3,true);
    expect(undone.sheets.map(s => s.name)).toEqual(['Off 1','Gov case']);
    expect(undone.orderRevision).toEqual(reordered.orderRevision);
    expect(undone.sheets[1]!.rows[0]!.cells[0]!.text).toBe('');
  });
  it('orders same-cell conflicts deterministically and accepts a later deliberate edit', () => {
    const base = newWorkbook(), sheet = base.sheets[0]!.id;
    const a = stampFlowEdit(base, setCell(base, sheet, 0, 0, {text:'A'}), 'a', 1);
    const b = stampFlowEdit(base, setCell(base, sheet, 0, 0, {text:'B'}), 'b', 1);
    const merged = mergeIncoming(a, b, new EditHistory(), 0).book;
    expect(serializeFlow(merged)).toBe(serializeFlow(mergeIncoming(b, a, new EditHistory(), 0).book));
    expect(merged.sheets[0]!.rows[0]!.cells[0]!.text).toBe('B');
    const next = stampFlowEdit(merged, setCell(merged, sheet, 0, 0, {text:'Later'}), 'a', maxFlowClock(merged) + 1);
    expect(mergeIncoming(next, merged, new EditHistory(), 0).book.sheets[0]!.rows[0]!.cells[0]!.text).toBe('Later');
  });
  it('round-trips cleared Prep cells as tombstones so delayed snapshots cannot resurrect them', () => {
    const base = newWorkbook(), sheet = base.sheets[0]!.id;
    const filled = stampFlowEdit(base, setPrep(base, sheet, 0, {text:'thumper'}), 'a', 1);
    const cleared = stampFlowEdit(filled, setPrep(filled, sheet, 0, {text:''}), 'a', 2);
    const saved = parseFlow(serializeFlow(cleared));
    expect(saved.sheets[0]!.rows[0]!.prep).toEqual({text:'',revision:{actor:'a',clock:2}});
    expect(mergeIncoming(filled, saved, new EditHistory(), 0).book.sheets[0]!.rows[0]!.prep?.text).toBe('');
  });
  it('preserves valid revisions and discards invalid metadata when reading a file', () => {
    const book = newWorkbook();
    book.sheets[0]!.rows[0]!.cells[0] = {text:'valid',revision:{clock:3,actor:'a'}};
    book.sheets[0]!.rows[0]!.cells[1] = {text:'invalid',revision:{clock:-1,actor:'b'}};
    const saved = parseFlow(serializeFlow(book));
    expect(saved.sheets[0]!.rows[0]!.cells[0]!.revision).toEqual({clock:3,actor:'a'});
    expect(saved.sheets[0]!.rows[0]!.cells[1]!.revision).toBeUndefined();
  });
});
