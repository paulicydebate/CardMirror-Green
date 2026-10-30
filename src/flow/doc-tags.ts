/** A one-time, tags-only copy from an open document into a new Flow tab. */
import type { Node as PMNode } from 'prosemirror-model';
import { columnsFor, DEFAULT_FLOW_ROWS, newSheet, type FlowWorkbook, type FlowSide } from './flow-model.js';

export interface FlowTagSnapshot { tags: string[]; positions?: Array<{name: string; start: number}> }
/** Position labels must be styled headings, never text inside a tag or card. */
export function isFlowPositionHeading(text: string): boolean {
  const title = text.trim().replace(/^(?:\d+|[ivx]+)[.)]\s*/i, '');
  return /^(?:(?:adv(?:antage)?\.?|ad)[\s.:_-]*\d+\b|advantage\b|off(?:[\s-]*case)?[\s.:_-]*\d+\b|(?:da|cp|k|t)\b|disad(?:vantage)?\b|counter[\s-]?plan\b|kritik\b|critique\b|topicality\b|theory\b|framework\b)/i.test(title) ||
    /\b(?:da|cp|k|disadvantage|counterplan|kritik)$/i.test(title);
}
export function documentTags(doc: PMNode): string[] {
  return documentTagSnapshot(doc).tags;
}
export function documentTagSnapshot(doc: PMNode): FlowTagSnapshot {
  const tags: string[] = [];
  const positions = [{name: '', start: 0}];
  doc.descendants(node => {
    if (['flow_workbook', 'self_ref', 'transclusion_ref'].includes(node.type.name)) return false;
    if (['pocket', 'hat', 'block'].includes(node.type.name)) {
      const title = node.textBetween(0, node.content.size, ' ', ' ').trim();
      if (isFlowPositionHeading(title)) {
        const position = {name: title.slice(0, 90), start: tags.length};
        if (positions.at(-1)!.start === tags.length) positions[positions.length - 1] = position;
        else positions.push(position);
      }
      return false;
    }
    if (node.type.name !== 'tag') return true;
    const text = node.textBetween(0, node.content.size, ' ', ' ').trim();
    if (text) tags.push(text);
    return false;
  });
  return {tags, positions: positions.filter((position, i) => (positions[i + 1]?.start ?? tags.length) > position.start)};
}
export function tagPositionGroups(snapshot: FlowTagSnapshot, fallback: string, split = true): Array<{name: string; tags: string[]}> {
  if (!split || !snapshot.positions?.length) return snapshot.tags.length ? [{name: fallback, tags: snapshot.tags}] : [];
  return snapshot.positions.map((position, i) => ({name: position.name || fallback, tags: snapshot.tags.slice(position.start, snapshot.positions![i + 1]?.start)})).filter(position => position.tags.length);
}
export function appendPositionSheets(book: FlowWorkbook, fallback: string, side: FlowSide, speech: string, snapshot: FlowTagSnapshot, split = true): {book: FlowWorkbook; sheetId: string} {
  const positions = tagPositionGroups(snapshot, fallback, split);
  if (!positions.length) throw new Error('This document has no nonempty Tag paragraphs.');
  if (book.sheets.length + positions.length > 200) throw new Error('These positions exceed the Flow sheet limit. Import a smaller document.');
  let next = book, firstId = '';
  for (const position of positions) {
    const result = appendTagsSheet(next, position.name, side, speech, position.tags);
    next = result.book; firstId ||= result.sheetId;
  }
  return {book: next, sheetId: firstId};
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
