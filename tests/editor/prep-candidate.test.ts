// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { newWorkbook, serializeFlow, addPrepOption, setNamedPrep } from '../../src/flow/flow-model.js';
import { isBlankPrepCandidate } from '../../src/editor/prep-controller.js';
describe('prep marking cannot attest prefilled content', () => {
  it('accepts an empty document and an empty generated flow', () => {
    expect(isBlankPrepCandidate(schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create()]))).toBe(true);
    expect(isBlankPrepCandidate(schema.nodes.doc!.create(null, [schema.nodes.flow_workbook!.create({ data: serializeFlow(newWorkbook('npda')) })]))).toBe(true);
  });
  it('rejects existing prose, flow cell text, and source images', () => {
    expect(isBlankPrepCandidate(schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create(null, schema.text('Previously pasted'))]))).toBe(false);
    const book = newWorkbook('npda'); book.sheets[0]!.rows[0]!.prep = { text: 'Prewritten argument' };
    expect(isBlankPrepCandidate(schema.nodes.doc!.create(null, [schema.nodes.flow_workbook!.create({ data: serializeFlow(book) })]))).toBe(false);
    const clean = newWorkbook(); const added = addPrepOption(clean, clean.sheets[0]!.id, 'A2');
    const named = setNamedPrep(added.book, clean.sheets[0]!.id, 0, added.id, {text:'Prewritten'});
    expect(isBlankPrepCandidate(schema.nodes.doc!.create(null, [schema.nodes.flow_workbook!.create({data:serializeFlow(named)})]))).toBe(false);
    expect(isBlankPrepCandidate(schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create(null, schema.nodes.image!.create({ data: 'source-image' }))]))).toBe(false);
  });
});
