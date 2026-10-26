/**
 * Flow → ordinary document blocks, for Word export (and anything else that
 * needs a flow as plain content): each sheet becomes a Block heading with
 * the sheet name and a table with one column per speech. Crossed-out cells
 * export struck through, bold cells bold. Empty trailing rows are dropped.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { parseFlow, type FlowCell, type FlowWorkbook } from './flow-model.js';

function cellParagraphs(schema: Schema, cell: FlowCell): PMNode[] {
  const base = [
    ...(cell.bold ? [schema.marks['bold']!.create()] : []),
    ...(cell.crossed ? [schema.marks['strikethrough']!.create()] : []),
  ];
  const highlight = schema.marks['highlight']!.create({ color: 'green' });
  const ranges = cell.hl ?? [];
  const paragraphs: PMNode[] = [];
  let offset = 0;
  for (const line of cell.text.split('\n')) {
    const start = offset;
    const end = start + line.length;
    // Cut the line at highlight edges so each run gets the right marks.
    const cuts = new Set<number>([start, end]);
    for (const [a, b] of ranges) {
      if (a > start && a < end) cuts.add(a);
      if (b > start && b < end) cuts.add(b);
    }
    const points = [...cuts].sort((x, y) => x - y);
    const runs: PMNode[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (b <= a) continue;
      const lit = ranges.some(([x, y]) => x <= a && b <= y);
      runs.push(schema.text(cell.text.slice(a, b), lit ? [...base, highlight] : base));
    }
    paragraphs.push(schema.nodes['paragraph']!.create(null, runs));
    offset = end + 1;
  }
  return paragraphs;
}

export function flowWorkbookToBlocks(schema: Schema, book: FlowWorkbook): PMNode[] {
  const out: PMNode[] = [];
  for (const sheet of book.sheets) {
    let last = sheet.rows.length;
    while (last > 0 && sheet.rows[last - 1]!.cells.every((c) => !c.text) && !sheet.rows[last - 1]!.prep?.text) last--;
    out.push(schema.nodes['block']!.create({ id: null }, sheet.name ? [schema.text(sheet.name)] : []));
    const hasPrep = sheet.rows.some((r) => r.prep?.text);
    const names = hasPrep ? [...sheet.columns, 'Prep'] : sheet.columns;
    const header = schema.nodes['table_row']!.create(null, names.map((name) =>
      schema.nodes['table_header']!.create(null, [schema.nodes['paragraph']!.create(null, name ? [schema.text(name)] : [])])));
    const rows = sheet.rows.slice(0, Math.max(last, 1)).map((row) => {
      const cells = sheet.columns.map((_, col) => row.cells[col] ?? { text: '' });
      if (hasPrep) cells.push(row.prep ?? { text: '' });
      return schema.nodes['table_row']!.create(null, cells.map((c) => schema.nodes['table_cell']!.create(null, cellParagraphs(schema, c))));
    });
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
