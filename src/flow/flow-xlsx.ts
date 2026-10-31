/**
 * Flow workbook <-> .xlsx / CSV.
 *
 * Export: one worksheet per flow sheet, speech names in row 1, each flow
 * row below. Every cell is written as an inline string (t="inlineStr"),
 * so text starting with = + - @ is never evaluated as a formula; cells use
 * a wrap-text style so in-cell line breaks show in Excel / Google Sheets.
 * Import reads inline strings and shared strings (what Excel/Sheets save).
 * Zip via fflate (already a dependency); no DOM.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  type FlowWorkbook, type FlowSheet, type FlowSide,
  newWorkbook, newFlowId, DEFAULT_FLOW_ROWS,
} from './flow-model.js';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// Characters XML 1.0 forbids (Excel refuses the file if present).
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function xmlEscape(s: string): string {
  return s.replace(BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function xmlUnescape(s: string): string {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function colName(i: number): string {
  let s = ''; i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel sheet names: <=31 chars, no []:*?/\ , unique (case-insensitive). */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
  let out = base, n = 2;
  while (used.has(out.toLowerCase())) { const suf = ` (${n++})`; out = base.slice(0, 31 - suf.length) + suf; }
  used.add(out.toLowerCase());
  return out;
}

/** Grid of strings: header row + trailing-empty rows trimmed. */
export function sheetGrid(sheet: FlowSheet): string[][] {
  const width = sheet.columns.length;
  const rows = sheet.rows.map((r) => Array.from({ length: width }, (_, i) => r.cells[i]?.text ?? ''));
  while (rows.length && rows[rows.length - 1]!.every((c) => !c)) rows.pop();
  return [[...sheet.columns], ...rows];
}

function sheetXml(grid: string[][]): string {
  const rows = grid.map((row, r) => {
    const cells = row.map((v, c) => v === '' ? '' :
      `<c r="${colName(c)}${r + 1}" t="inlineStr" s="${r === 0 ? 2 : 1}"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const cols = grid[0]?.length ? `<cols><col min="1" max="${grid[0].length}" width="45" customWidth="1"/></cols>` : '';
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function flowToXlsx(book: FlowWorkbook): Uint8Array {
  const used = new Set<string>();
  const names = book.sheets.map((s) => safeSheetName(s.name, used));
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  files['_rels/.rels'] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files['xl/workbook.xml'] = strToU8(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8(`${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf numFmtId="49" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="49" fontId="1" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`);
  book.sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheetGrid(s))); });
  return zipSync(files, { level: 6 });
}

/** RFC 4180 CSV of one sheet (CRLF rows; quoted cells keep in-cell \n). */
export function flowSheetToCsv(sheet: FlowSheet): string {
  return sheetGrid(sheet).map((row) => row.map((v) =>
    /[",\r\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\r\n') + '\r\n';
}

export function csvToGrid(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (q) {
      if (ch === '"') { if (csv[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && csv[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function textOf(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += xmlUnescape(m[1] ?? '');
  return out;
}

export function gridToSheet(name: string, side: FlowSide, grid: string[][]): FlowSheet {
  const header = grid[0] ?? [];
  const width = Math.max(header.length, ...grid.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => header[i] || String(i + 1));
  const body = grid.slice(1);
  const rows = Array.from({ length: Math.max(DEFAULT_FLOW_ROWS, body.length) }, (_, r) => ({
    id: newFlowId(),
    cells: columns.map((_, c) => ({ text: body[r]?.[c] ?? '' })),
  }));
  return { id: newFlowId(), name, side, columns, rows };
}

/** Parse an .xlsx (ours, Excel's, or Google Sheets') into a flow workbook. */
export function xlsxToFlow(data: Uint8Array, event = 'npda'): FlowWorkbook {
  const zip = unzipSync(data);
  const read = (p: string) => (zip[p] ? strFromU8(zip[p]!) : '');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const rels = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1] ?? ''; const t = /Target="([^"]+)"/.exec(m[0])?.[1] ?? '';
    return [id, t.startsWith('/') ? t.slice(1) : `xl/${t}`] as const;
  }));
  const book = newWorkbook(event);
  const sheets: FlowSheet[] = [];
  for (const m of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlUnescape(/name="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
    const xml = read(rels.get(rid) ?? '');
    const grid: string[][] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const r = Number(/r="(\d+)"/.exec(rm[1] ?? rm[3] ?? '')?.[1] ?? grid.length + 1) - 1;
      const row: string[] = [];
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1]!; const inner = cm[2] ?? '';
        const c = colIndex(/r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? colName(row.length));
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const val = t === 'inlineStr' ? textOf(inner) : t === 's' ? shared[Number(v)] ?? '' : xmlUnescape(v ?? '');
        while (row.length < c) row.push('');
        row[c] = val;
      }
      while (grid.length < r) grid.push([]);
      grid[r] = row;
    }
    sheets.push(gridToSheet(name, sheets.length === 0 ? 'aff' : 'neg', grid));
  }
  return { ...book, sheets: sheets.length ? sheets : book.sheets };
}
