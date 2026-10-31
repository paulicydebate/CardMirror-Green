/**
 * Speech doc -> flow column import (pre-flow, 1-to-1 rule).
 *
 * One flow row per heading / tag / analytic / numbered claim / lettered
 * subpoint, in document order. Card bodies, cites and undertags are skipped.
 * Outline prefixes (1. a. A. i.) are kept; lowercase-letter subpoints are
 * indented 3 spaces, roman-numeral sub-subpoints 6. Off-case positions
 * (T / DA / CP / K / Theory headings) start their own sheet.
 *
 * Pure: `docToFlowOutline` works on a flat block list (easy to test);
 * `outlineFromDoc` adapts a ProseMirror doc; `applyOutlineToWorkbook`
 * places rows with the existing `placeColumnSections` helper.
 */
import type { Node as PMNode } from 'prosemirror-model';
import {
  type FlowWorkbook, type FlowSide, type ColumnSection,
  placeColumnSections, newSheet, columnsFor, DEFAULT_FLOW_ROWS,
} from './flow-model.js';

export type DocBlockKind = 'heading' | 'tag' | 'analytic' | 'text' | 'body' | 'cite' | 'undertag' | 'blank';
export interface DocBlock { kind: DocBlockKind; text: string }
export interface OutlineSheet { name: string; side: FlowSide | null; rows: string[] }
export interface FlowOutline { sheets: OutlineSheet[] }

export const INDENT = '   ';
const OFF_CASE = /^(?:off\s*\d*\s*[:\-–—]?\s*)?(t|topicality|da|disad(?:vantage)?|cp|counter-?plan|k|kritik|critique|theory|spec)\b/i;

export function isOffCaseHeading(text: string): boolean {
  return OFF_CASE.test(text.trim());
}

/** Normalize an outline line: strip existing indent, re-indent by prefix. */
export function outlineLine(raw: string): string {
  const text = raw.replace(/\s+$/, '').replace(/^[ \t\u00a0]+/, '');
  if (/^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)[.)]\s/.test(text)) return INDENT + INDENT + text;
  if (/^[a-z][.)]\s/.test(text)) return INDENT + text;
  return text;
}

export function docToFlowOutline(blocks: DocBlock[], caseSheetName = 'Case'): FlowOutline {
  const sheets: OutlineSheet[] = [{ name: caseSheetName, side: null, rows: [] }];
  let cur = sheets[0]!;
  for (const b of blocks) {
    const text = b.text.trim();
    switch (b.kind) {
      case 'body': case 'cite': case 'undertag': continue;
      case 'blank':
        // A blank paragraph is a deliberate gap (1-to-1 alignment); keep it.
        if (cur.rows.length) cur.rows.push('');
        continue;
      case 'heading':
        if (!text) continue;
        if (isOffCaseHeading(text)) {
          cur = { name: text.slice(0, 60), side: 'neg', rows: [] };
          sheets.push(cur);
          continue;
        }
        cur.rows.push(text);
        continue;
      default:
        if (!text) continue;
        // Multi-line paragraphs (soft breaks) become one row per line.
        for (const line of b.text.split(/\r?\n/)) if (line.trim()) cur.rows.push(outlineLine(line));
    }
  }
  for (const s of sheets) while (s.rows.length && s.rows[s.rows.length - 1] === '') s.rows.pop();
  return { sheets: sheets.filter((s, i) => i === 0 || s.rows.length || s.name) };
}

const KIND: Record<string, DocBlockKind> = {
  pocket: 'heading', hat: 'heading', block: 'heading',
  tag: 'tag', analytic: 'analytic', card_body: 'body', cite_paragraph: 'cite',
  undertag: 'undertag', paragraph: 'text',
};

/** Flatten a CardMirror doc into DocBlocks in document order. */
export function docBlocks(doc: PMNode): DocBlock[] {
  const out: DocBlock[] = [];
  doc.descendants((node) => {
    const name = node.type.name;
    if (name === 'self_ref' || name === 'transclusion_ref') return false;
    if (!node.isTextblock) return true;
    const kind = KIND[name] ?? 'text';
    let text = '';
    node.forEach((c) => { text += c.isText ? c.text : c.type.name === 'hard_break' ? '\n' : c.textContent; });
    out.push({ kind: text.trim() ? kind : 'blank', text });
    return false;
  });
  return out;
}

export function outlineFromDoc(doc: PMNode, caseSheetName?: string): FlowOutline {
  return docToFlowOutline(docBlocks(doc), caseSheetName);
}

/**
 * Command hook: write the outline into `col` of `sheetId` (case rows) and
 * add one neg sheet per off-case position, filling its first column.
 */
export function applyOutlineToWorkbook(book: FlowWorkbook, sheetId: string, col: number, outline: FlowOutline): FlowWorkbook {
  const [caseSheet, ...off] = outline.sheets;
  const sheets = book.sheets.map((s) => {
    if (s.id !== sheetId || !caseSheet) return s;
    const sections: ColumnSection[] = caseSheet.rows.map((text) => ({ rowId: null, text }));
    return placeColumnSections(s, col, sections).sheet;
  });
  for (const o of off) {
    const side: FlowSide = o.side ?? 'neg';
    const fresh = newSheet(o.name, side, columnsFor(book.event, side), Math.max(DEFAULT_FLOW_ROWS, o.rows.length));
    sheets.push(placeColumnSections(fresh, 0, o.rows.map((text) => ({ rowId: null, text }))).sheet);
  }
  return { ...book, sheets };
}

/** Convenience for the "Import speech doc to flow" command. */
export function importDocToFlow(book: FlowWorkbook, sheetId: string, col: number, doc: PMNode): FlowWorkbook {
  const sheet = book.sheets.find((s) => s.id === sheetId);
  return applyOutlineToWorkbook(book, sheetId, col, outlineFromDoc(doc, sheet?.name));
}
