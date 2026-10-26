/**
 * Flow → ordinary document blocks, for Word export (and anything else that
 * needs a flow as plain content): each sheet becomes a Block heading with
 * the sheet name and a table with one column per speech. Crossed-out cells
 * export struck through, bold cells bold. Empty trailing rows are dropped.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { parseFlow, type FlowCell, type FlowWorkbook } from './flow-model.js';

function cellParagraphs(schema: Schema, cell: FlowCell): PMNode[] {
  const marks = [
    ...(cell.bold ? [schema.marks['bold']!.create()] : []),
    ...(cell.crossed ? [schema.marks['strikethrough']!.create()] : []),
  ];
  const lines = cell.text.split('\n');
  return lines.map((line) => schema.nodes['paragraph']!.create(null, line ? [schema.text(line, marks)] : []));
}

export function flowWorkbookToBlocks(schema: Schema, book: FlowWorkbook): PMNode[] {
  const out: PMNode[] = [];
  for (const sheet of book.sheets) {
    let last = sheet.rows.length;
    while (last > 0 && sheet.rows[last - 1]!.cells.every((c) => !c.text)) last--;
    out.push(schema.nodes['block']!.create({ id: null }, sheet.name ? [schema.text(sheet.name)] : []));
    const header = schema.nodes['table_row']!.create(null, sheet.columns.map((name) =>
      schema.nodes['table_header']!.create(null, [schema.nodes['paragraph']!.create(null, name ? [schema.text(name)] : [])])));
    const rows = sheet.rows.slice(0, Math.max(last, 1)).map((row) =>
      schema.nodes['table_row']!.create(null, sheet.columns.map((_, col) =>
        schema.nodes['table_cell']!.create(null, cellParagraphs(schema, row.cells[col] ?? { text: '' })))));
    out.push(schema.nodes['table']!.create(null, [header, ...rows]));
  }
  return out;
}

/** Blocks for a `flow_workbook` node; an unreadable flow exports as a note. */
export function flowNodeToBlocks(schema: Schema, node: PMNode): PMNode[] {
  try {
    return flowWorkbookToBlocks(schema, parseFlow(String(node.attrs['data'] ?? ''), 0));
  } catch {
    return [schema.nodes['paragraph']!.create(null, [schema.text('[Flow could not be read]')])];
  }
}
