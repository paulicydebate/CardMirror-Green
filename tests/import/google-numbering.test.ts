// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DOMParser as PMParser } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { fromDocx, fromDocxFull } from '../../src/import/index.js';
import { toDocx } from '../../src/export/index.js';
import { Docx } from '../../src/ooxml/docx.js';
import { preserveGoogleListLabels } from '../../src/editor/google-list-paste.js';

const numbering = `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
const para = (text: string, level: number) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('Google Docs list labels', () => {
  it('imports normal numbered paragraphs and retains their labels on export', async () => {
    const base = await toDocx(schema.nodes.doc!.create(null, schema.nodes.paragraph!.create()));
    const zip = await Docx.load(base);
    zip.writeText('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${para('First',0)}${para('Detail',1)}${para('Nested',2)}${para('Second',0)}</w:body></w:document>`);
    zip.writeText('word/numbering.xml', numbering);
    const bytes = await zip.toBuffer();
    for (const doc of [await fromDocx(bytes), (await fromDocxFull(bytes)).doc]) {
      expect(doc.textContent).toBe('1. Firsta. Detaili. Nested2. Second');
      expect((await fromDocx(await toDocx(doc))).textContent).toBe(doc.textContent);
    }
  });
  it('preserves pasted Google Docs list labels through the editor parser', () => {
    const html = '<b id="docs-internal-guid-example"><ol start="2"><li><p>First</p><ol style="list-style-type:lower-alpha"><li><p>Detail</p></li></ol></li><li><p>Second</p></li></ol></b>';
    const parsed = new DOMParser().parseFromString(preserveGoogleListLabels(html), 'text/html');
    const doc = PMParser.fromSchema(schema).parse(parsed.body);
    expect(doc.textContent).toContain('2. First');
    expect(doc.textContent).toContain('a. Detail');
    expect(doc.textContent).toContain('3. Second');
    expect(preserveGoogleListLabels('<ol><li>Other</li></ol>')).toBe('<ol><li>Other</li></ol>');
  });
});
