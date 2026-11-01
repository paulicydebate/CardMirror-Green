/**
 * Co-editing merge for spreadsheet flows.
 *
 * A flow travels through collaboration as ONE value (the `flow_workbook`
 * node's `data` attr), so when two people type at the same moment the CRDT
 * keeps one version and the other person's latest keystrokes vanish. This
 * module recovers them cell by cell:
 *
 * New local edits carry a logical clock and actor on each changed cell.
 * Merge versioned cells independently, including empty-cell tombstones;
 * neither a keystroke cap nor a wall-clock expiry can discard pending text.
 * Concurrent edits to the SAME cell use a deterministic whole-cell winner,
 * not character-level merging. Legacy unversioned cells use the old fallback:
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

  /** Legacy unversioned cells only. New edits carry persistent revisions. */
  isStale(key: string, value: string, now: number): boolean {
    const list = this.entries.get(key);
    return !!list && list.some((e) => e.v === value && now - e.t < HISTORY_MS);
  }
}

function eachCell(row: FlowRow, columns: number, fn: (col: number | string, cell: FlowCell | undefined) => void): void {
  for (let c = 0; c < columns; c++) fn(c, row.cells[c]);
  fn(PREP_KEY, row.prep);
  for (const [id, cell] of Object.entries(row.namedPrep ?? {})) fn(`named:${id}`, cell);
}

function rowCell(row: FlowRow, col: number | string): FlowCell | undefined {
  return col === PREP_KEY ? row.prep : typeof col === 'number' ? row.cells[col] : row.namedPrep?.[col.slice(6)];
}

/** A compact fingerprint of the row state seen when it was deleted. This
 * detects a concurrent edit without retaining the deleted text in the file. */
function compactFingerprint(input: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) { a = Math.imul(a ^ input.charCodeAt(i), 0x01000193); b = Math.imul(b ^ input.charCodeAt(i), 0x85ebca6b); }
  return `${input.length.toString(16)}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
function rowSeenCells(row: FlowRow): NonNullable<NonNullable<FlowWorkbook['sheets'][number]['rowTombstones']>[string]['seenCells']> {
  const cells: NonNullable<NonNullable<FlowWorkbook['sheets'][number]['rowTombstones']>[string]['seenCells']> = Object.create(null);
  eachCell(row, row.cells.length, (col, cell) => { cells[String(col)] = {fingerprint:compactFingerprint(cellJson(cell)), ...(cell?.revision ? {revision:cell.revision} : {})}; });
  return cells;
}
function rowSignature(row: FlowRow): string {
  return compactFingerprint(JSON.stringify(Object.entries(rowSeenCells(row)).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)));
}
function rowChangedSinceDelete(row: FlowRow, tomb: NonNullable<FlowWorkbook['sheets'][number]['rowTombstones']>[string]): boolean {
  if (rowSignature(row) === tomb.seen) return false;
  if (!tomb.seenCells) return true;
  for (const [key, cell] of Object.entries(rowSeenCells(row))) {
    const seen = tomb.seenCells[key];
    if (seen?.fingerprint === cell.fingerprint) continue;
    // A delayed older version of the same actor's cell is not a new edit.
    if (cell.revision && seen?.revision && cell.revision.actor === seen.revision.actor && cell.revision.clock <= seen.revision.clock) continue;
    return true; // concurrent/unknown edit: retain rather than discard it
  }
  return false;
}

/** Insertions are anchored to a preceding row and ordered deterministically,
 * so two partners adding a row at the same point both retain their text. */
function orderRows(rows: FlowRow[], tombstones: NonNullable<FlowWorkbook['sheets'][number]['rowTombstones']>): FlowRow[] {
  const ids = new Set(rows.map(r => r.id));
  const children = new Map<string | null, FlowRow[]>();
  for (const row of rows) if (row.created) {
    let anchor = row.created.after;
    const visited = new Set<string>();
    while (anchor && !ids.has(anchor) && !visited.has(anchor)) { visited.add(anchor); const tomb = tombstones[anchor]; if (!tomb || tomb.after === undefined) break; anchor = tomb.after; }
    // If the anchor is unknown, leave this row for the final fallback rather
    // than accidentally jumping it to the top of the sheet.
    if (anchor && !ids.has(anchor)) continue;
    const group = children.get(anchor) ?? []; group.push(row); children.set(anchor, group);
  }
  for (const group of children.values()) group.sort((a,b) => {
    const ar = a.created!.revision, br = b.created!.revision;
    return ar.clock - br.clock || (ar.actor < br.actor ? -1 : ar.actor > br.actor ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const ordered: FlowRow[] = [], seen = new Set<string>();
  const append = (row: FlowRow): void => {
    const pending = [row];
    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next.id)) continue;
      seen.add(next.id); ordered.push(next);
      const nested = children.get(next.id) ?? [];
      for (let i = nested.length - 1; i >= 0; i--) pending.push(nested[i]!);
    }
  };
  for (const row of children.get(null) ?? []) append(row);
  for (const row of rows) if (!row.created) append(row);
  for (const row of rows) append(row); // malformed or cyclic anchors: retain data
  return ordered;
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
        const prevCell = rowCell(prev, col);
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
    const incomingOptions = sheet.prepOptions ?? [];
    const options = new Map(incomingOptions.map(option => [option.id, option]));
    for (const option of ms.prepOptions ?? []) if (!options.has(option.id)) { options.set(option.id, option); keptMine = true; }
    const prepOptions = [...options.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const tombstones = {...sheet.rowTombstones};
    for (const [id, tomb] of Object.entries(ms.rowTombstones ?? {})) {
      const existing = tombstones[id];
      if (!existing || compareCellRevisions({text:'',revision:tomb.revision}, {text:'',revision:existing.revision}) > 0) { tombstones[id] = tomb; keptMine = true; }
    }
    const myRows = new Map(ms.rows.map((r) => [r.id, r]));
    const incomingIds = new Set(sheet.rows.map(row => row.id));
    const allRows = [...sheet.rows];
    for (const row of ms.rows) if (!incomingIds.has(row.id) && (row.created || tombstones[row.id])) { allRows.push(row); keptMine = true; }
    const rows = allRows.map((row) => {
      const mr = myRows.get(row.id);
      if (!mr) return row;
      let changed = false;
      const cells = row.cells.slice();
      let prep = row.prep;
      const namedPrep = {...row.namedPrep};
      const cols = new Set<number | string>();
      eachCell(row, sheet.columns.length, col => cols.add(col));
      eachCell(mr, sheet.columns.length, col => cols.add(col));
      for (const col of cols) {
        const cell = rowCell(row, col);
        const mineCell = rowCell(mr, col);
        const inc = cellJson(cell);
        if (inc === cellJson(mineCell) && compareCellRevisions(mineCell, cell) === 0) continue;
        if (mineCell?.revision || cell?.revision) {
          // Each cell is its own deterministic register. A stale workbook
          // snapshot cannot overwrite a newer edit on another sheet.
          if (compareCellRevisions(mineCell, cell) <= 0) continue;
        } else if (!history.isStale(keyOf(sheet.id, row.id, col), inc, now)) continue;
        changed = true;
        if (col === PREP_KEY) prep = mineCell;
        else if (typeof col === 'number') cells[col] = mineCell ?? { text: '' };
        else if (mineCell) namedPrep[col.slice(6)] = mineCell;
      }
      if (!changed) return row;
      keptMine = true;
      const { prep: _drop, ...rest } = row;
      return { ...rest, cells, ...(prep ? {prep} : {}), ...(Object.keys(namedPrep).length ? {namedPrep} : {}) };
    });
    const retained = rows.filter(row => {
      const tomb = tombstones[row.id];
      if (!tomb) return true;
      if (row.created && compareCellRevisions({text:'',revision:row.created.revision}, {text:'',revision:tomb.revision}) > 0) return true;
      return rowChangedSinceDelete(row, tomb);
    });
    const recovered = retained.map(row => { const tomb = tombstones[row.id]; return tomb && !row.created && rowChangedSinceDelete(row, tomb) ? {...row, created: {after:tomb.after ?? null, revision:tomb.revision}} : row; });
    const orderedRows = orderRows(recovered, tombstones);
    if (orderedRows.length !== sheet.rows.length || orderedRows.some((row, i) => row.id !== sheet.rows[i]?.id)) keptMine = true;
    return { ...sheet, rows: orderedRows, ...(prepOptions.length ? {prepOptions} : {}), ...(Object.keys(tombstones).length ? {rowTombstones:tombstones} : {}) };
  });
  let ordered = sheets;
  let orderRevision = incoming.orderRevision;
  if (compareCellRevisions({text:'', revision: mine.orderRevision}, {text:'', revision: incoming.orderRevision}) > 0) {
    const byId = new Map(sheets.map(sheet => [sheet.id, sheet]));
    ordered = mine.sheets.map(sheet => byId.get(sheet.id)).filter((sheet): sheet is typeof sheets[number] => !!sheet);
    const known = new Set(ordered.map(sheet => sheet.id));
    ordered.push(...sheets.filter(sheet => !known.has(sheet.id)));
    orderRevision = mine.orderRevision;
    keptMine = true;
  }
  return { book: { ...incoming, sheets: ordered, ...(orderRevision ? {orderRevision} : {}) }, keptMine };
}

/** Total order for a cell register; no computer wall-clock dependency. */
export function compareCellRevisions(a: FlowCell | undefined, b: FlowCell | undefined): number {
  const ac = a?.revision?.clock ?? 0, bc = b?.revision?.clock ?? 0;
  if (ac !== bc) return ac < bc ? -1 : 1;
  const aa = a?.revision?.actor ?? '', ba = b?.revision?.actor ?? '';
  return aa === ba ? 0 : aa < ba ? -1 : 1;
}

export function maxFlowClock(book: FlowWorkbook): number {
  let clock = book.orderRevision?.clock ?? 0;
  for (const sheet of book.sheets) {
    for (const tomb of Object.values(sheet.rowTombstones ?? {})) clock = Math.max(clock, tomb.revision.clock);
    for (const row of sheet.rows) {
      clock = Math.max(clock, row.created?.revision.clock ?? 0);
      eachCell(row, sheet.columns.length, (_col, cell) => { clock = Math.max(clock, cell?.revision?.clock ?? 0); });
    }
  }
  return clock;
}

/** Stamp only genuinely edited cells; a merged resend must keep its revisions. */
export function stampFlowEdit(before: FlowWorkbook, after: FlowWorkbook, actor: string, clock: number, preservePartners = false): FlowWorkbook {
  const revision = { actor, clock };
  if (preservePartners && before.orderRevision && before.orderRevision.actor !== actor) {
    const byId = new Map(after.sheets.map(sheet => [sheet.id, sheet]));
    const sheets = before.sheets.map(sheet => byId.get(sheet.id)).filter((sheet): sheet is FlowWorkbook['sheets'][number] => !!sheet);
    const known = new Set(sheets.map(sheet => sheet.id));
    sheets.push(...after.sheets.filter(sheet => !known.has(sheet.id)));
    after = {...after, sheets, orderRevision: before.orderRevision};
  }
  const orderChanged = JSON.stringify(before.sheets.map(s => s.id)) !== JSON.stringify(after.sheets.map(s => s.id));
  return { ...after, ...(orderChanged ? {orderRevision: revision} : {}), sheets: after.sheets.map(sheet => {
    const old = before.sheets.find(s => s.id === sheet.id);
    const rows = new Map(old?.rows.map(r => [r.id, r]) ?? []);
    const rowTombstones = {...old?.rowTombstones, ...sheet.rowTombstones};
    const nextIds = new Set(sheet.rows.map(row => row.id));
    for (const [index, oldRow] of (old?.rows ?? []).entries()) if (!nextIds.has(oldRow.id)) rowTombstones[oldRow.id] = {revision, seen:rowSignature(oldRow), seenCells:rowSeenCells(oldRow), after:index > 0 ? old!.rows[index - 1]!.id : null};
    const options = new Map((sheet.prepOptions ?? []).map(option => [option.id, option]));
    if (preservePartners) for (const option of old?.prepOptions ?? []) if (!options.has(option.id)) options.set(option.id, option);
    const prepOptions = [...options.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { ...sheet, ...(prepOptions.length ? {prepOptions} : {}), ...(Object.keys(rowTombstones).length ? {rowTombstones} : {}), rows: sheet.rows.map((row, index) => {
      const previous = rows.get(row.id);
      const stamp = (cell: FlowCell | undefined, prev: FlowCell | undefined): FlowCell | undefined => {
        if (preservePartners && prev?.revision && prev.revision.actor !== actor) return prev;
        return cellJson(cell) === cellJson(prev) ? cell : { ...(cell ?? { text: '' }), revision };
      };
      const cells = row.cells.map((cell, col) => stamp(cell, previous?.cells[col])!);
      const prep = stamp(row.prep, previous?.prep);
      const namedPrep: Record<string, FlowCell> = {};
      const ids = new Set([...Object.keys(row.namedPrep ?? {}), ...Object.keys(previous?.namedPrep ?? {})]);
      for (const id of ids) { const cell = stamp(row.namedPrep?.[id], previous?.namedPrep?.[id]); if (cell) namedPrep[id] = cell; }
      const { prep: _oldPrep, namedPrep: _oldNamed, ...rest } = row;
      const created = !previous ? {after: index > 0 ? sheet.rows[index - 1]!.id : null, revision} : row.created ?? previous.created;
      return { ...rest, ...(created ? {created} : {}), cells, ...(prep ? {prep} : {}), ...(Object.keys(namedPrep).length ? {namedPrep} : {}) };
    }) };
  }) };
}
