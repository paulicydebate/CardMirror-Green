import {describe, expect, it} from 'vitest';
import {schema} from '../../src/schema/index.js';
import {appendTagsSheet, documentTags, flowTabName} from '../../src/flow/doc-tags.js';
import {newWorkbook, parseFlow, serializeFlow} from '../../src/flow/flow-model.js';

describe('document tags to a new Flow tab', () => {
  it('copies tags in order, preserving repeated tags and excluding bodies, citations and headings', () => {
    const card = (tag: string) => schema.nodes.card!.createChecked(null, [schema.nodes.tag!.create(null, schema.text(tag)), schema.nodes.cite_paragraph!.create(null, schema.text('Author 26')), schema.nodes.card_body!.create(null, schema.text('Evidence is not a tag'))]);
    const doc = schema.nodes.doc!.create(null, [schema.nodes.block!.create(null, schema.text('Heading')), card('Claim one'), card('Claim two'), card('Claim one'), schema.nodes.paragraph!.create(null, schema.text('Ordinary text'))]);
    expect(documentTags(doc)).toEqual(['Claim one', 'Claim two', 'Claim one']);
  });
  it('names the tab from Windows/Mac filenames without the extension', () => {
    expect(flowTabName('C:\\Debate\\Politics DA.docx')).toBe('Politics DA');
    expect(flowTabName('/Users/debate/Aff case.CMIR')).toBe('Aff case');
    expect(flowTabName(null)).toBe('Untitled document');
  });
  it.each(['nfald', 'policy'])('creates an independent %s sheet in the chosen speech without overwriting existing content', event => {
    const original = newWorkbook(event); original.sheets[0]!.rows[0]!.cells[0]!.text = 'Keep existing';
    const tags = ['First', 'Second'];
    const result = appendTagsSheet(original, 'Politics DA', 'neg', '1NC', tags);
    expect(result.book.sheets.slice(0, 2)).toEqual(original.sheets);
    expect(original.sheets).toHaveLength(2);
    const imported = result.book.sheets.at(-1)!;
    expect(imported.name).toBe('Politics DA'); expect(imported.side).toBe('neg'); expect(imported.columns[0]).toBe('1NC');
    expect(imported.rows.slice(0, 2).map(row => row.cells[0]!.text)).toEqual(tags);
    expect(imported.rows[0]!.cells[1]!.text).toBe('');
    expect(parseFlow(serializeFlow(result.book)).sheets.at(-1)!.rows[1]!.cells[0]!.text).toBe('Second');
    tags[0] = 'Source changed'; expect(imported.rows[0]!.cells[0]!.text).toBe('First');
    expect(appendTagsSheet(result.book, 'Politics DA', 'aff', '1AR', ['Response']).book.sheets.at(-1)!.name).toBe('Politics DA (2)');
  });
  it('refuses empty or oversized imports, wrong speeches and unsupported events', () => {
    expect(() => appendTagsSheet(newWorkbook('npda'), 'Case', 'aff', 'PMC', ['Tag'])).toThrow('LD and policy');
    expect(() => appendTagsSheet(newWorkbook('policy'), 'Case', 'aff', '1AC', [])).toThrow('no nonempty');
    expect(() => appendTagsSheet(newWorkbook('policy'), 'Case', 'neg', '1AC', ['Tag'])).toThrow('speech');
    expect(() => appendTagsSheet(newWorkbook('policy'), 'Case', 'aff', '1AC', Array(5001).fill('Tag'))).toThrow('size limit');
  });
  it('keeps numbered long tab names distinct after save and reload', () => {
    const first = appendTagsSheet(newWorkbook('policy'), 'A'.repeat(150), 'aff', '1AC', ['Tag']);
    const second = appendTagsSheet(first.book, 'A'.repeat(150), 'aff', '1AC', ['Tag']);
    const names = parseFlow(serializeFlow(second.book)).sheets.map(s => s.name);
    expect(names.at(-1)).toBe('A'.repeat(90) + ' (2)');
    expect(new Set(names).size).toBe(names.length);
  });
});
