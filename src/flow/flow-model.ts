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
}

export interface FlowRow {
  id: string;
  /** One entry per column; missing entries read as empty cells. */
  cells: FlowCell[];
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
 *   below the previous section's row, or a new row inserted there.
 */
export function applyColumnSections(sheet: FlowSheet, col: number, sections: ColumnSection[]): FlowSheet {
  if (col < 0 || col >= sheet.columns.length) return sheet;
  const rows = sheet.rows.map((r) => ({ ...r, cells: Array.from({ length: Math.max(sheet.columns.length, r.cells.length) }, (_, i) => r.cells[i] ?? { text: '' }) }));
  const kept = new Set(sections.map((s) => s.rowId).filter((id): id is string => id !== null));
  for (const r of rows) {
    if (!kept.has(r.id) && r.cells[col]!.text) r.cells[col] = { text: '' };
  }
  let cursor = -1; // index of the row the previous section landed in
  for (const section of sections) {
    const text = section.text.slice(0, MAX_TEXT);
    let index = section.rowId ? rows.findIndex((r) => r.id === section.rowId) : -1;
    if (index >= 0) {
      rows[index]!.cells[col] = cleanCell({ ...rows[index]!.cells[col]!, text });
    } else {
      index = cursor + 1;
      // Reuse an empty cell directly below; otherwise insert a row so nothing else shifts.
      if (!(index < rows.length && !rows[index]!.cells[col]!.text && !kept.has(rows[index]!.id))) {
        rows.splice(index, 0, emptyRow(sheet.columns.length));
      }
      rows[index]!.cells[col] = { text };
    }
    cursor = index;
  }
  return { ...sheet, rows: rows.slice(0, MAX_ROWS) };
}

// ─── Save / load ─────────────────────────────────────────────────────

function cleanCell(c: FlowCell): FlowCell {
  const out: FlowCell = { text: typeof c.text === 'string' ? c.text.slice(0, MAX_TEXT) : '' };
  if (c.crossed) out.crossed = true;
  if (c.bold) out.bold = true;
  if (c.extended) out.extended = true;
  return out;
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
      // Trailing empty rows are not worth storing; the editor pads on open.
      rows: trimTrailingEmpty(s.rows).map((r) => ({ id: r.id, cells: r.cells.map(cleanCell) })),
    })),
  });
}

function trimTrailingEmpty(rows: FlowRow[]): FlowRow[] {
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.cells.every((c) => !c.text)) end--;
  return rows.slice(0, end);
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
    const rows: FlowRow[] = (Array.isArray(s['rows']) ? s['rows'] : []).slice(0, MAX_ROWS).map((rr: unknown) => {
      const r = (rr ?? {}) as Record<string, unknown>;
      const cells = (Array.isArray(r['cells']) ? r['cells'] : []).slice(0, columns.length).map((cc: unknown) => cleanCell((cc ?? {}) as FlowCell));
      while (cells.length < columns.length) cells.push({ text: '' });
      return { id: typeof r['id'] === 'string' && r['id'] ? r['id'] : newFlowId(), cells };
    });
    while (rows.length < minRows) rows.push(emptyRow(columns.length));
    return {
      id: typeof s['id'] === 'string' && s['id'] ? s['id'] : newFlowId(),
      name: typeof s['name'] === 'string' && s['name'].trim() ? s['name'].slice(0, 100) : `Sheet ${i + 1}`,
      side: s['side'] === 'neg' ? 'neg' : 'aff',
      columns,
      rows,
    };
  });
  const event = typeof o['event'] === 'string' && (FLOW_FORMATS[o['event']] || o['event'] === 'custom') ? o['event'] : 'npda';
  return { format: FLOW_FORMAT, version: FLOW_VERSION, event, sheets };
}
