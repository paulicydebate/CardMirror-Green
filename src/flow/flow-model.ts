/**
 * Flow workbook model (CardMirror Green).
 *
 * A flow is a workbook of sheets (tabs). Each sheet is a grid: one column
 * per speech, one row per line of argument, so a response sits beside what
 * it answers — the layout debaters already use in Google Sheets / Excel
 * flows. Cells hold plain text plus a few flow marks (crossed out, bold,
 * extended).
 *
 * "Column as document": any column can be opened as a doc and edited
 * there; `columnToSections` / `applyColumnSections` convert between the
 * grid and a list of sections keyed by row id, so cell boundaries survive
 * the round trip and new sections become new rows.
 *
 * Pure data + operations (immutable updates); no DOM.
 */

export const FLOW_FORMAT = 'cardmirror.flow' as const;
export const FLOW_VERSION = 1 as const;

export type FlowSide = 'aff' | 'neg';

export interface FlowCell {
  text: string;
  crossed?: boolean;
  bold?: boolean;
  extended?: boolean;
  /** Highlighted character ranges [start, end) in `text`, sorted and non-overlapping. */
  hl?: Array<[number, number]>;
}

export interface FlowRow {
  id: string;
  /** One entry per column; missing entries read as empty cells. */
  cells: FlowCell[];
  /** The row's Prep cell: thumpers / prepped answers lined up with this row
   *  (shown in the collapsible Prep column). */
  prep?: FlowCell;
}

export interface FlowSheet {
  id: string;
  name: string;
  /** Which team's position this sheet tracks (colors, starting column). */
  side: FlowSide;
  columns: string[];
  rows: FlowRow[];
}

export interface FlowWorkbook {
  format: typeof FLOW_FORMAT;
  version: typeof FLOW_VERSION;
  /** Key into FLOW_FORMATS, or 'custom'. */
  event: string;
  sheets: FlowSheet[];
}

export interface FlowFormatPreset {
  label: string;
  /** Speech columns for a sheet started by the first side (aff / gov). */
  affColumns: string[];
  /** Columns for a sheet started by the second side (neg / opp): from its first speech on. */
  negColumns: string[];
  /** Display names of the two sides. */
  sideNames: [string, string];
  /** Speeches given by the first side (aff / gov); the rest are the second side's. */
  affSpeeches: string[];
  /** Sheets a new flow starts with. */
  starterSheets: Array<{ name: string; side: FlowSide }>;
}

/**
 * Speech orders. NPDA is the priority (its no-copy-paste prep rule is what
 * this feature is for). Rebuttals (LOR, PMR) and 2NC/1NR follow the
 * convention flow templates use; adjust in a sheet's column list if a
 * team flows differently.
 */
export const FLOW_FORMATS: Record<string, FlowFormatPreset> = {
  npda: {
    label: 'NPDA (parli)',
    affColumns: ['PMC', 'LOC', 'MG', 'MO', 'LOR', 'PMR'],
    negColumns: ['LOC', 'MG', 'MO', 'LOR', 'PMR'],
    sideNames: ['Gov', 'Opp'],
    affSpeeches: ['PMC', 'MG', 'PMR'],
    starterSheets: [{ name: 'Gov case', side: 'aff' }, { name: 'Off 1', side: 'neg' }],
  },
  nfald: {
    label: 'NFA-LD',
    affColumns: ['1AC', '1NC', '1AR', 'NR', '2AR'],
    negColumns: ['1NC', '1AR', 'NR', '2AR'],
    sideNames: ['Aff', 'Neg'],
    affSpeeches: ['1AC', '1AR', '2AR'],
    starterSheets: [{ name: 'Aff case', side: 'aff' }, { name: 'Off 1', side: 'neg' }],
  },
  policy: {
    label: 'Policy (CEDA/NDT, HS)',
    affColumns: ['1AC', '1NC', '2AC', '2NC/1NR', '1AR', '2NR', '2AR'],
    negColumns: ['1NC', '2AC', '2NC/1NR', '1AR', '2NR', '2AR'],
    sideNames: ['Aff', 'Neg'],
    affSpeeches: ['1AC', '2AC', '1AR', '2AR'],
    starterSheets: [{ name: 'Aff case', side: 'aff' }, { name: 'Off 1', side: 'neg' }],
  },
};

const DEFAULT_ROWS = 20;
const MAX_TEXT = 100_000;
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 40;
const MAX_SHEETS = 200;

let idCounter = 0;
/** Random-enough id; tests can pass their own ids where it matters. */
export function newFlowId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  idCounter++;
  return `f${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyRow(columns: number): FlowRow {
  return { id: newFlowId(), cells: Array.from({ length: columns }, () => ({ text: '' })) };
}

export function newSheet(name: string, side: FlowSide, columns: string[], rows = DEFAULT_ROWS): FlowSheet {
  return { id: newFlowId(), name, side, columns: [...columns], rows: Array.from({ length: rows }, () => emptyRow(columns.length)) };
}

export function columnsFor(event: string, side: FlowSide): string[] {
  const preset = FLOW_FORMATS[event];
  if (!preset) return ['1', '2', '3', '4', '5', '6'];
  return side === 'aff' ? preset.affColumns : preset.negColumns;
}

/** Which side gives the speech in column `col` (for column colors). Known
 *  speech names use the event's list; unknown ones alternate from the
 *  sheet's own side. */
export function columnSide(event: string, sheet: FlowSheet, col: number): FlowSide {
  const name = sheet.columns[col] ?? '';
  const preset = FLOW_FORMATS[event];
  if (preset && (preset.affColumns.includes(name) || preset.negColumns.includes(name))) {
    return preset.affSpeeches.includes(name) ? 'aff' : 'neg';
  }
  const first = sheet.side;
  return col % 2 === 0 ? first : first === 'aff' ? 'neg' : 'aff';
}

export function sideName(event: string, side: FlowSide): string {
  const names = FLOW_FORMATS[event]?.sideNames ?? ['Aff', 'Neg'];
  return side === 'aff' ? names[0] : names[1];
}

export function newWorkbook(event = 'npda'): FlowWorkbook {
  const preset = FLOW_FORMATS[event] ?? FLOW_FORMATS['npda']!;
  return {
    format: FLOW_FORMAT,
    version: FLOW_VERSION,
    event: FLOW_FORMATS[event] ? event : 'npda',
    sheets: preset.starterSheets.map((s) => newSheet(s.name, s.side, s.side === 'aff' ? preset.affColumns : preset.negColumns)),
  };
}

export function cellAt(sheet: FlowSheet, row: number, col: number): FlowCell {
  return sheet.rows[row]?.cells[col] ?? { text: '' };
}

// ─── Immutable operations ────────────────────────────────────────────

function replaceSheet(book: FlowWorkbook, sheetId: string, fn: (s: FlowSheet) => FlowSheet): FlowWorkbook {
  return { ...book, sheets: book.sheets.map((s) => (s.id === sheetId ? fn(s) : s)) };
}

function withCell(row: FlowRow, col: number, columns: number, fn: (c: FlowCell) => FlowCell): FlowRow {
  const cells = Array.from({ length: Math.max(columns, row.cells.length) }, (_, i) => row.cells[i] ?? { text: '' });
  cells[col] = fn(cells[col]!);
  return { ...row, cells };
}

export function setCell(book: FlowWorkbook, sheetId: string, row: number, col: number, patch: Partial<FlowCell>): FlowWorkbook {
  return replaceSheet(book, sheetId, (s) => {
    if (row < 0 || col < 0 || col >= s.columns.length) return s;
    const rows = [...s.rows];
    while (rows.length <= row) rows.push(emptyRow(s.columns.length));
    rows[row] = withCell(rows[row]!, col, s.columns.length, (c) => cleanCell({ ...c, ...patch }));
    return { ...s, rows };
  });
}

/** Edit the Prep cell of row `row`, growing the sheet if needed. */
export function setPrep(book: FlowWorkbook, sheetId: string, row: number, patch: Partial<FlowCell>): FlowWorkbook {
  return replaceSheet(book, sheetId, (s) => {
    if (row < 0) return s;
    const rows = [...s.rows];
    while (rows.length <= row) rows.push(emptyRow(s.columns.length));
    const next = cleanCell({ ...(rows[row]!.prep ?? { text: '' }), ...patch });
    const { prep: _old, ...rest } = rows[row]!;
    rows[row] = isEmptyCell(next) ? rest : { ...rest, prep: next };
    return { ...s, rows };
  });
}

/** Insert empty rows before `index` (index = rows.length appends). */
export function insertRows(book: FlowWorkbook, sheetId: string, index: number, count = 1): FlowWorkbook {
  return replaceSheet(book, sheetId, (s) => {
    const rows = [...s.rows];
    const at = Math.max(0, Math.min(index, rows.length));
    rows.splice(at, 0, ...Array.from({ length: Math.max(0, count) }, () => emptyRow(s.columns.length)));
    return { ...s, rows: rows.slice(0, MAX_ROWS) };
  });
}

export function deleteRows(book: FlowWorkbook, sheetId: string, index: number, count = 1): FlowWorkbook {
  return replaceSheet(book, sheetId, (s) => {
    const rows = [...s.rows];
    rows.splice(index, count);
    return { ...s, rows: rows.length ? rows : [emptyRow(s.columns.length)] };
  });
}

export function addSheet(book: FlowWorkbook, name: string, side: FlowSide, afterSheetId?: string): { book: FlowWorkbook; sheetId: string } {
  const sheet = newSheet(name, side, columnsFor(book.event, side));
  const sheets = [...book.sheets];
  const at = afterSheetId ? sheets.findIndex((s) => s.id === afterSheetId) + 1 : sheets.length;
  sheets.splice(at <= 0 ? sheets.length : at, 0, sheet);
  return { book: { ...book, sheets: sheets.slice(0, MAX_SHEETS) }, sheetId: sheet.id };
}

export function renameSheet(book: FlowWorkbook, sheetId: string, name: string): FlowWorkbook {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 100);
  return clean ? replaceSheet(book, sheetId, (s) => ({ ...s, name: clean })) : book;
}

export function deleteSheet(book: FlowWorkbook, sheetId: string): FlowWorkbook {
  const sheets = book.sheets.filter((s) => s.id !== sheetId);
  return sheets.length ? { ...book, sheets } : book;
}

export function moveSheet(book: FlowWorkbook, sheetId: string, toIndex: number): FlowWorkbook {
  const from = book.sheets.findIndex((s) => s.id === sheetId);
  if (from < 0) return book;
  const sheets = [...book.sheets];
  const [sheet] = sheets.splice(from, 1);
  sheets.splice(Math.max(0, Math.min(toIndex, sheets.length)), 0, sheet!);
  return { ...book, sheets };
}

/** Next sheet name like "Off 3" after the existing "Off N" sheets. */
export function nextOffName(book: FlowWorkbook): string {
  let n = 0;
  for (const s of book.sheets) {
    const m = /^Off (\d+)$/.exec(s.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `Off ${n + 1}`;
}

// ─── Column as document ──────────────────────────────────────────────

export interface ColumnSection {
  /** Row id the section came from; null for a section added in doc view. */
  rowId: string | null;
  text: string;
}

/** The column's non-empty cells, top to bottom, as doc sections. */
export function columnToSections(sheet: FlowSheet, col: number): ColumnSection[] {
  const out: ColumnSection[] = [];
  for (const row of sheet.rows) {
    const text = row.cells[col]?.text ?? '';
    if (text.trim()) out.push({ rowId: row.id, text });
  }
  return out;
}

/**
 * Write doc-view sections back into column `col`:
 * - a section with a known rowId updates that row's cell;
 * - a known row whose section was removed has its cell emptied (the row
 *   stays, so other columns keep their alignment);
 * - a new section (rowId null) fills the next empty cell in this column
 *   below the previous section's row, or a new row inserted there. A blank
 *   section still takes its row, so a gap left in document view stays a
 *   gap in the sheet.
 */
export function applyColumnSections(sheet: FlowSheet, col: number, sections: ColumnSection[]): FlowSheet {
  return placeColumnSections(sheet, col, sections).sheet;
}

/** `applyColumnSections`, plus the row id each section ended up in. */
export function placeColumnSections(sheet: FlowSheet, col: number, sections: ColumnSection[]): { sheet: FlowSheet; rowIds: Array<string | null> } {
  if (col < 0 || col >= sheet.columns.length) return { sheet, rowIds: sections.map((s) => s.rowId) };
  const rows = sheet.rows.map((r) => ({ ...r, cells: Array.from({ length: Math.max(sheet.columns.length, r.cells.length) }, (_, i) => r.cells[i] ?? { text: '' }) }));
  const known = new Set(rows.map((r) => r.id));
  const kept = new Set(sections.map((s) => s.rowId).filter((id): id is string => id !== null && known.has(id)));
  for (const r of rows) {
    if (!kept.has(r.id) && r.cells[col]!.text) r.cells[col] = { text: '' };
  }
  const rowIds: Array<string | null> = [];
  let cursor = -1; // index of the row the previous section landed in
  for (const section of sections) {
    const text = section.text.slice(0, MAX_TEXT);
    let index = section.rowId && kept.has(section.rowId) ? rows.findIndex((r) => r.id === section.rowId) : -1;
    if (index >= 0) {
      const old = rows[index]!.cells[col]!;
      rows[index]!.cells[col] = cleanCell({ ...old, text, hl: shiftRanges(old.hl, old.text, text) });
    } else {
      index = cursor + 1;
      // Reuse an empty, unclaimed cell directly below; otherwise insert a row so nothing else shifts.
      if (!(index < rows.length && !rows[index]!.cells[col]!.text && !kept.has(rows[index]!.id))) {
        rows.splice(index, 0, emptyRow(sheet.columns.length));
      }
      rows[index]!.cells[col] = { text };
      kept.add(rows[index]!.id);
    }
    rowIds.push(index < MAX_ROWS ? rows[index]!.id : null);
    cursor = index;
  }
  return { sheet: { ...sheet, rows: rows.slice(0, MAX_ROWS) }, rowIds };
}

// ─── Save / load ─────────────────────────────────────────────────────

export function cleanCell(c: FlowCell): FlowCell {
  const out: FlowCell = { text: typeof c.text === 'string' ? c.text.slice(0, MAX_TEXT) : '' };
  if (c.crossed) out.crossed = true;
  if (c.bold) out.bold = true;
  if (c.extended) out.extended = true;
  const hl = normalizeRanges(c.hl, out.text.length);
  if (hl.length) out.hl = hl;
  return out;
}

const isEmptyCell = (c: FlowCell | undefined): boolean => !c || (!c.text && !c.hl?.length);

/** Sort, clamp and merge highlight ranges; drop empty or invalid ones. */
export function normalizeRanges(ranges: unknown, length: number): Array<[number, number]> {
  if (!Array.isArray(ranges)) return [];
  const clean: Array<[number, number]> = [];
  for (const r of ranges) {
    if (!Array.isArray(r) || typeof r[0] !== 'number' || typeof r[1] !== 'number') continue;
    const a = Math.max(0, Math.min(length, Math.floor(r[0])));
    const b = Math.max(0, Math.min(length, Math.floor(r[1])));
    if (b > a) clean.push([a, b]);
  }
  clean.sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Move highlight ranges along with a text edit (found as the common prefix
 *  and suffix of the old and new text): text typed inside a highlight stays
 *  highlighted, deleted text takes its highlight with it. */
export function shiftRanges(ranges: Array<[number, number]> | undefined, oldText: string, newText: string): Array<[number, number]> {
  if (!ranges?.length) return [];
  let pre = 0;
  const max = Math.min(oldText.length, newText.length);
  while (pre < max && oldText[pre] === newText[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  const oldEnd = oldText.length - suf; // edit replaced [pre, oldEnd) with newText[pre, newEnd)
  const newEnd = newText.length - suf;
  const delta = newEnd - oldEnd;
  const map = (x: number, isEnd: boolean): number => {
    if (x < pre) return x;
    // Text typed right before a highlight's start pushes the highlight along.
    if (x === pre && !isEnd) return oldEnd === pre ? x + delta : x;
    if (x >= oldEnd) return x + delta;
    // Inside the replaced span: an end stretches over inserted text, a start stays put.
    return isEnd ? newEnd : pre;
  };
  return normalizeRanges(ranges.map(([a, b]) => [map(a, false), map(b, true)]), newText.length);
}

/** Toggle highlight over [start, end): removes it where the whole span is
 *  already highlighted, adds it otherwise. */
export function toggleRange(ranges: Array<[number, number]> | undefined, start: number, end: number, length: number): Array<[number, number]> {
  const cur = normalizeRanges(ranges ?? [], length);
  if (end <= start) return cur;
  const covered = cur.some(([a, b]) => a <= start && end <= b);
  if (!covered) return normalizeRanges([...cur, [start, end]], length);
  const out: Array<[number, number]> = [];
  for (const [a, b] of cur) {
    if (b <= start || a >= end) out.push([a, b]);
    else {
      if (a < start) out.push([a, start]);
      if (b > end) out.push([end, b]);
    }
  }
  return normalizeRanges(out, length);
}

export function serializeFlow(book: FlowWorkbook): string {
  return JSON.stringify({
    format: FLOW_FORMAT,
    version: FLOW_VERSION,
    event: book.event,
    sheets: book.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      side: s.side,
      columns: s.columns,
      // Every row is stored with its id (empty ones too): co-editing matches
      // rows by id, so both computers must agree on every row's identity.
      rows: s.rows.map((r) => (isEmptyCell(r.prep)
        ? { id: r.id, cells: r.cells.map(cleanCell) }
        : { id: r.id, cells: r.cells.map(cleanCell), prep: cleanCell(r.prep!) })),
    })),
  });
}


export class FlowParseError extends Error {}

/** Parse and validate a saved flow. Pads each sheet to a minimum row count. */
export function parseFlow(text: string, minRows = DEFAULT_ROWS): FlowWorkbook {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new FlowParseError('Not a CardMirror flow file (unreadable JSON).'); }
  const o = data as Record<string, unknown> | null;
  if (!o || o['format'] !== FLOW_FORMAT) throw new FlowParseError('Not a CardMirror flow file.');
  if (o['version'] !== FLOW_VERSION) throw new FlowParseError(`Unsupported flow version ${String(o['version'])}.`);
  if (!Array.isArray(o['sheets']) || o['sheets'].length === 0) throw new FlowParseError('The flow has no sheets.');
  const sheets: FlowSheet[] = o['sheets'].slice(0, MAX_SHEETS).map((raw: unknown, i: number) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const columns = Array.isArray(s['columns']) ? s['columns'].slice(0, MAX_COLUMNS).map((c) => String(c).slice(0, 40)) : [];
    if (columns.length === 0) throw new FlowParseError(`Sheet ${i + 1} has no columns.`);
    const sheetId = typeof s['id'] === 'string' && s['id'] ? s['id'] : `sheet-${i + 1}`;
    const rows: FlowRow[] = (Array.isArray(s['rows']) ? s['rows'] : []).slice(0, MAX_ROWS).map((rr: unknown, ri: number) => {
      const r = (rr ?? {}) as Record<string, unknown>;
      const cells = (Array.isArray(r['cells']) ? r['cells'] : []).slice(0, columns.length).map((cc: unknown) => cleanCell((cc ?? {}) as FlowCell));
      while (cells.length < columns.length) cells.push({ text: '' });
      const id = typeof r['id'] === 'string' && r['id'] ? r['id'] : `${sheetId}~${ri}`;
      const prep = r['prep'] && typeof r['prep'] === 'object' ? cleanCell(r['prep'] as FlowCell) : null;
      return prep && !isEmptyCell(prep) ? { id, cells, prep } : { id, cells };
    });
    // Padding rows get ids derived from the sheet, so every computer that
    // opens the same file pads with identical rows.
    while (rows.length < minRows) rows.push({ id: `${sheetId}~${rows.length}`, cells: Array.from({ length: columns.length }, () => ({ text: '' })) });
    return {
      id: sheetId,
      name: typeof s['name'] === 'string' && s['name'].trim() ? s['name'].slice(0, 100) : `Sheet ${i + 1}`,
      side: s['side'] === 'neg' ? 'neg' : 'aff',
      columns,
      rows,
    };
  });
  const event = typeof o['event'] === 'string' && (FLOW_FORMATS[o['event']] || o['event'] === 'custom') ? o['event'] : 'npda';
  return { format: FLOW_FORMAT, version: FLOW_VERSION, event, sheets };
}
