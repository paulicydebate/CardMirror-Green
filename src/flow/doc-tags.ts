/** A one-time, tags-only copy from an open document into a new Flow tab. */
import type { Node as PMNode } from 'prosemirror-model';
import { columnsFor, DEFAULT_FLOW_ROWS, newSheet, type FlowWorkbook, type FlowSide } from './flow-model.js';

export interface FlowTagSnapshot { tags: string[] }
export function documentTags(doc: PMNode): string[] {
  const tags: string[] = [];
  doc.descendants(node => {
    if (['flow_workbook', 'self_ref', 'transclusion_ref'].includes(node.type.name)) return false;
    if (node.type.name !== 'tag') return true;
    const text = node.textBetween(0, node.content.size, ' ', ' ').trim();
    if (text) tags.push(text);
    return false;
  });
  return tags;
}
export function flowTabName(filename: string | null): string {
  return (filename?.split(/[\\/]/).pop()?.replace(/\.(?:docx|cmir)$/i, '').trim() || 'Untitled document').slice(0, 90);
}
export function appendTagsSheet(book: FlowWorkbook, title: string, side: FlowSide, speech: string, tags: string[]): { book: FlowWorkbook; sheetId: string } {
  if (!['nfald', 'policy'].includes(book.event)) throw new Error('Tag import is available for LD and policy flows.');
  if (!tags.length) throw new Error('This document has no nonempty Tag paragraphs.');
  if (book.sheets.length >= 200 || tags.length > 5000 || tags.some(tag => tag.length > 100000)) throw new Error('This import exceeds the Flow size limit. Split the source into smaller documents.');
  const columns = columnsFor(book.event, side), col = columns.indexOf(speech);
  if (col < 0) throw new Error('Choose a speech column for this side.');
  const base = title.trim().slice(0, 90) || 'Untitled document';
  let name = base, count = 2;
  while (book.sheets.some(sheet => sheet.name.toLowerCase() === name.toLowerCase())) name = `${base} (${count++})`;
  const sheet = newSheet(name, side, columns, Math.max(DEFAULT_FLOW_ROWS, tags.length));
  tags.forEach((text, row) => { sheet.rows[row]!.cells[col] = {text}; });
  return {book: {...book, sheets: [...book.sheets, sheet]}, sheetId: sheet.id};
}
