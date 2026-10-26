import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { toDocx } from '../../src/export/index.js';
import { fromDocxFull } from '../../src/import/index.js';
import { newWorkbook, serializeFlow, setCell, setPrep } from '../../src/flow/flow-model.js';

describe('flow Word export', () => {
  it('exports each sheet as a heading and a table that reimports as text', async () => {
    let book = newWorkbook('npda');
    const gov = book.sheets[0]!.id;
    book = setCell(book, gov, 0, 0, { text: 'Adv 1\necon collapse', bold: true });
    book = setCell(book, gov, 0, 1, { text: 'No link', crossed: true });
    book = setCell(book, gov, 1, 0, { text: 'nuclear war soon', hl: [[0, 11]] });
    book = setPrep(book, gov, 1, { text: 'Thumper: tensions' });
    const doc = schema.nodes.doc!.create(null, [
      schema.nodes.flow_workbook!.create({ data: serializeFlow(book) }),
      schema.nodes.paragraph!.create(null, [schema.text('notes')]),
    ]);
    const back = (await fromDocxFull(await toDocx(doc))).doc;
    const types: string[] = [];
    back.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(['block', 'table', 'block', 'table', 'paragraph']);
    expect(back.child(0).textContent).toBe('Gov case');
    const table = back.child(1);
    expect(table.child(0).textContent).toBe('PMCLOCMGMOLORPMRPrep');
    const hlCell = table.child(2).child(0);
    const lit: string[] = [];
    hlCell.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'highlight')) lit.push(n.text!); });
    expect(lit).toEqual(['nuclear war']);
    expect(table.child(2).child(6).textContent).toBe('Thumper: tensions');
    expect(table.child(1).child(0).textContent).toBe('Adv 1econ collapse');
    let struck = false;
    table.child(1).child(1).descendants((n) => { if (n.marks.some((m) => m.type.name === 'strikethrough')) struck = true; });
    expect(struck).toBe(true);
    expect(back.child(4).textContent).toBe('notes');
  });
});
