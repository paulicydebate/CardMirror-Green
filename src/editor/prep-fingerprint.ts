/**
 * Content fingerprint of a prep document, sealed into the Prep / Round log
 * when a session ends so "Check Prep Document" can later tell whether the
 * document was changed afterward.
 *
 * Covers what a reader sees: node types, text, formatting marks and their
 * values, flow contents and images. Leaves out what changes without anyone
 * editing: element ids, comment anchors, reading markers and column widths.
 * Saving and reopening therefore keep the same fingerprint.
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';
import { parseFlow } from '../flow/flow-model.js';

const SKIP_NODES = new Set(['reading_marker']);
const SKIP_MARKS = new Set(['comment_range', 'pilcrow_marker']);
const SKIP_ATTR = (key: string): boolean => key === 'id' || /Id$|_id$/.test(key) || key === 'colwidth' || key === 'time';

function attrsOf(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(attrs).sort()) if (!SKIP_ATTR(key)) out[key] = attrs[key] ?? null;
  return out;
}

/** A flow's visible content: sheet names, sides, columns and cells, without
 *  internal sheet/row ids or trailing blank rows. */
function flowData(raw: unknown): unknown {
  try {
    const book = parseFlow(String(raw ?? ''), 0);
    return [book.event, book.sheets.map((sheet) => {
      const rows = sheet.rows.map((row) => [row.cells, row.prep ?? null]);
      while (rows.length && (rows.at(-1)![0] as Array<{ text: string }>).every((c) => !c.text) && !(rows.at(-1)![1] as { text?: string } | null)?.text) rows.pop();
      return [sheet.name, sheet.side, sheet.columns, rows];
    })];
  } catch { return String(raw ?? ''); }
}

function markList(marks: readonly Mark[]): unknown[] {
  return marks.filter((m) => !SKIP_MARKS.has(m.type.name)).map((m) => [m.type.name, attrsOf(m.attrs)]);
}

function canon(node: PMNode): unknown {
  if (node.isText) return ['#', node.text ?? '', markList(node.marks)];
  const name = node.type.name;
  const attrs = name === 'flow_workbook' ? { data: flowData(node.attrs['data']) } : attrsOf(node.attrs);
  const children: unknown[] = [];
  node.forEach((child) => { if (!SKIP_NODES.has(child.type.name)) children.push(canon(child)); });
  return [name, attrs, markList(node.marks), children];
}

/** Stable JSON text for `doc` (exported for tests). */
export function prepCanonicalText(doc: PMNode): string {
  return JSON.stringify(canon(doc));
}

/** SHA-256 (hex) of the document's canonical content. */
export async function prepFingerprint(doc: PMNode): Promise<string> {
  const bytes = new TextEncoder().encode(prepCanonicalText(doc));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
