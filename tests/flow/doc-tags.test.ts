import {describe, expect, it} from 'vitest';
import {schema} from '../../src/schema/index.js';
import {appendTagsSheet, appendPositionSheets, documentTagSnapshot, documentTags, flowTabName, isFlowPositionHeading, tagPositionGroups} from '../../src/flow/doc-tags.js';
import {newWorkbook, parseFlow, serializeFlow} from '../../src/flow/flow-model.js';

describe('document tags to a new Flow tab', () => {
  it('splits AD1, AD2, named DAs and Off1 at styled position headings, retaining inner subheadings and preamble tags', () => {
    const heading = (text: string) => schema.nodes.block!.create(null, schema.text(text));
    const card = (text: string) => schema.nodes.card!.createChecked(null, [schema.nodes.tag!.create(null, schema.text(text)), schema.nodes.card_body!.create(null, schema.text('Body excluded'))]);
    const doc = schema.nodes.doc!.create(null, [card('Preamble'), heading('AD1 — Economy'), card('Growth'), heading('Impact'), card('Stability'), heading('Advantage 2: Climate'), card('Warming'), heading('Politics DA'), card('Uniqueness'), heading('A. Link'), card('Link'), heading('Off1'), card('Framework')]);
    const snapshot = documentTagSnapshot(doc);
    expect(tagPositionGroups(snapshot, 'Speech')).toEqual([
      {name: 'Speech', tags: ['Preamble']}, {name: 'AD1 — Economy', tags: ['Growth', 'Stability']},
      {name: 'Advantage 2: Climate', tags: ['Warming']}, {name: 'Politics DA', tags: ['Uniqueness', 'Link']}, {name: 'Off1', tags: ['Framework']},
    ]);
    const imported = appendPositionSheets(newWorkbook('policy'), 'Speech', 'aff', '2AC', snapshot);
    const saved = parseFlow(serializeFlow(imported.book));
    expect(saved.sheets.slice(2).map(sheet => sheet.name)).toEqual(['Speech', 'AD1 — Economy', 'Advantage 2: Climate', 'Politics DA', 'Off1']);
    expect(saved.sheets.slice(2).flatMap(sheet => sheet.rows.map(row => row.cells[2]!.text).filter(Boolean))).toEqual(snapshot.tags);
    expect(appendPositionSheets(newWorkbook('policy'), 'Speech', 'aff', '2AC', snapshot, false).book.sheets).toHaveLength(3);
  });
  it('recognizes common position labels but not internal sections', () => {
    for (const name of ['ad1', 'Adv. 2', 'DA: Elections', 'Off 1 - T', '1. Counterplan', 'K — Cap', 'Topicality', 'Security K']) expect(isFlowPositionHeading(name), name).toBe(true);
    for (const name of ['Uniqueness', 'A. Link', 'Impact', 'Solvency', '1AC']) expect(isFlowPositionHeading(name), name).toBe(false);
  });
  it('keeps all tags when headings are missing, and rejects too many new positions atomically', () => {
    const book = newWorkbook('nfald');
    expect(appendPositionSheets(book, 'Speech', 'aff', '1AC', {tags: ['One', 'Two']}).book.sheets.at(-1)!.name).toBe('Speech');
    expect(() => appendPositionSheets(book, 'Speech', 'aff', '1AC', {tags: Array(199).fill('Tag'), positions: Array.from({length: 199}, (_, start) => ({name: `Off${start}`, start}))})).toThrow('sheet limit');
    expect(book.sheets).toHaveLength(2);
  });
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
