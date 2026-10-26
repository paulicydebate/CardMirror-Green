/**
 * Co-editing merge for spreadsheet flows.
 *
 * A flow travels through collaboration as ONE value (the `flow_workbook`
 * node's `data` attr), so when two people type at the same moment the CRDT
 * keeps one version and the other person's latest keystrokes vanish. This
 * module recovers them cell by cell:
 *
 * - Every local edit records the cell's previous value in an `EditHistory`.
 * - When a partner's version arrives, a cell whose incoming value is one of
 *   *my own recent previous values* is a stale copy (the partner's write
 *   raced mine and carried my old text), so my current value is kept and
 *   re-sent. Any other difference is a real partner edit and is accepted.
 *
 * Both sides converge: the partner then receives my value, which is not in
 * their history for that cell, and accepts it.
 */

import type { FlowCell, FlowRow, FlowWorkbook } from './flow-model.js';

/** Column key for a row's Prep cell. */
export const PREP_KEY = 'prep';

const HISTORY_MS = 15_000;
const HISTORY_MAX = 40;

const cellJson = (c: FlowCell | undefined): string => {
  if (!c || (!c.text && !c.hl?.length && !c.bold && !c.crossed && !c.extended)) return '';
  return JSON.stringify([c.text, c.bold ? 1 : 0, c.crossed ? 1 : 0, c.extended ? 1 : 0, c.hl ?? []]);
};

const keyOf = (sheetId: string, rowId: string, col: number | string): string => `${sheetId}\u0000${rowId}\u0000${col}`;

export class EditHistory {
  private readonly entries = new Map<string, Array<{ v: string; t: number }>>();

  record(key: string, previous: string, now: number): void {
    const list = (this.entries.get(key) ?? []).filter((e) => now - e.t < HISTORY_MS);
    list.push({ v: previous, t: now });
    while (list.length > HISTORY_MAX) list.shift();
    this.entries.set(key, list);
  }

  /** Was `value` one of my own recent previous values for this cell? */
  isStale(key: string, value: string, now: number): boolean {
    const list = this.entries.get(key);
    return !!list && list.some((e) => e.v === value && now - e.t < HISTORY_MS);
  }
}

function eachCell(row: FlowRow, columns: number, fn: (col: number | string, cell: FlowCell | undefined) => void): void {
  for (let c = 0; c < columns; c++) fn(c, row.cells[c]);
  fn(PREP_KEY, row.prep);
}

/** Record, for every cell that differs between `before` and `after`, the
 *  value it had before this local edit. */
export function recordLocalEdit(history: EditHistory, before: FlowWorkbook, after: FlowWorkbook, now: number): void {
  for (const sheet of after.sheets) {
    const old = before.sheets.find((s) => s.id === sheet.id);
    if (!old) continue;
    const oldRows = new Map(old.rows.map((r) => [r.id, r]));
    for (const row of sheet.rows) {
      const prev = oldRows.get(row.id);
      if (!prev) continue;
      eachCell(row, sheet.columns.length, (col, cell) => {
        const prevCell = col === PREP_KEY ? prev.prep : prev.cells[col as number];
        const a = cellJson(prevCell);
        if (a !== cellJson(cell)) history.record(keyOf(sheet.id, row.id, col), a, now);
      });
    }
  }
}

/**
 * Merge a partner's version into mine. Returns the merged workbook and
 * whether any of my newer cells were kept (then the caller re-sends).
 */
export function mergeIncoming(
  incoming: FlowWorkbook,
  mine: FlowWorkbook,
  history: EditHistory,
  now: number,
): { book: FlowWorkbook; keptMine: boolean } {
  let keptMine = false;
  const sheets = incoming.sheets.map((sheet) => {
    const ms = mine.sheets.find((s) => s.id === sheet.id);
    if (!ms || ms.columns.length !== sheet.columns.length) return sheet;
    const myRows = new Map(ms.rows.map((r) => [r.id, r]));
    const rows = sheet.rows.map((row) => {
      const mr = myRows.get(row.id);
      if (!mr) return row;
      let changed = false;
      const cells = row.cells.slice();
      let prep = row.prep;
      eachCell(row, sheet.columns.length, (col, cell) => {
        const mineCell = col === PREP_KEY ? mr.prep : mr.cells[col as number];
        const inc = cellJson(cell);
        if (inc === cellJson(mineCell)) return;
        if (!history.isStale(keyOf(sheet.id, row.id, col), inc, now)) return;
        changed = true;
        if (col === PREP_KEY) prep = mineCell;
        else cells[col as number] = mineCell ?? { text: '' };
      });
      if (!changed) return row;
      keptMine = true;
      const { prep: _drop, ...rest } = row;
      return prep ? { ...rest, cells, prep } : { ...rest, cells };
    });
    return { ...sheet, rows };
  });
  return { book: { ...incoming, sheets }, keptMine };
}
