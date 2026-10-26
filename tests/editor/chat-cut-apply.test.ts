// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { applyChatCut, chatCutCardAtCursor, chatCutCardById, chatCutHighlightColor } from '../../src/editor/chat-cut-apply.js';
import { matchCutReply, parseCutReply } from '../../src/cutting/chat-cut.js';

const t = (value: string, marks: Mark[] = []): PMNode => schema.text(value, marks);
const para = (type: string, ...children: PMNode[]): PMNode => schema.nodes[type]!.create(null, children);

function makeCard(id: string, tag: string, ...bodies: PMNode[]): PMNode {
  return schema.nodes.card!.createChecked(null, [
    schema.nodes.tag!.create({ id }, tag ? t(tag) : []),
    para('cite_paragraph', t('Smith 25 | [John; quoted text in cite]')),
    ...bodies,
    para('undertag', t('analytic note not quotable')),
  ]);
}

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mount(doc: PMNode, cursorInside: number): EditorView {
  const state = EditorState.create({ doc });
  view = new EditorView(document.createElement('div'), {
    state: state.apply(state.tr.setSelection(TextSelection.create(doc, cursorInside))),
  });
  return view;
}

/** [text, mark names] runs of a card's body paragraphs. */
function bodyRuns(doc: PMNode, cardIndex = 0): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  doc.child(cardIndex).forEach((child) => {
    if (child.type.name !== 'card_body') return;
    child.forEach((n) => { if (n.isText) out.push([n.text!, n.marks.map((m) => m.type.name + (m.type.name === 'highlight' ? ':' + m.attrs['color'] : '')).sort()]); });
  });
  return out;
}

describe('chat cut editor glue', () => {
  it('reads only body paragraphs and applies one undoable cut with green highlight', () => {
    const doc = schema.nodes.doc!.createChecked(null, [
      makeCard('c1', 'Old tag', para('card_body', t('Escalation risk is rising quickly in Asia.')), para('card_body', t('Miscalculation causes war.'))),
    ]);
    const v = mount(doc, 3);
    const card = chatCutCardAtCursor(v)!;
    expect(card.tagId).toBe('c1');
    expect(card.paragraphs).toEqual(['Escalation risk is rising quickly in Asia.', 'Miscalculation causes war.']);
    expect(card.cite).toContain('Smith 25');

    const parsed = parseCutReply('```json\n{"tag":"Asian escalation risk is rising","underline":["Escalation risk is rising quickly","Miscalculation causes war"],"emphasis":["quickly"],"highlight":["risk is rising","quoted text in cite"]}\n```');
    if (!parsed.ok) throw new Error(parsed.error);
    const report = matchCutReply(card.paragraphs, parsed.reply);
    expect(report.rejected.map((r) => r.quote)).toEqual(['quoted text in cite']);
    expect(applyChatCut(v, 'c1', report, { replaceExisting: true, newTag: parsed.reply.tag })).toBe(true);

    const after = v.state.doc;
    expect(after.child(0).firstChild!.textContent).toBe('Asian escalation risk is rising');
    expect(after.child(0).firstChild!.attrs['id']).toBe('c1');
    expect(bodyRuns(after)).toEqual([
      ['Escalation ', ['underline_mark']],
      ['risk is rising', ['highlight:green', 'underline_mark']],
      [' ', ['underline_mark']],
      ['quickly', ['emphasis_mark']],
      [' in Asia.', []],
      ['Miscalculation causes war', ['underline_mark']],
      ['.', []],
    ]);
    // Cite and undertag untouched.
    expect(after.child(0).child(1).textContent).toBe('Smith 25 | [John; quoted text in cite]');
  });

  it('replaces or keeps existing formatting as asked, and keeps the doc highlight color', () => {
    const yellow = schema.marks.highlight!.create({ color: 'cyan' });
    const doc = schema.nodes.doc!.createChecked(null, [
      makeCard('c1', 'Tag', para('card_body', t('alpha', [yellow, schema.marks.underline_mark!.create()]), t(' beta gamma'))),
    ]);
    expect(chatCutHighlightColor(doc)).toBe('cyan');
    const v = mount(doc, 3);
    const card = chatCutCardById(v, 'c1')!;
    const report = matchCutReply(card.paragraphs, { tag: null, underline: ['gamma'], emphasis: [], highlight: ['gamma'] });
    applyChatCut(v, 'c1', report, { replaceExisting: false, newTag: null });
    expect(bodyRuns(v.state.doc)).toEqual([
      ['alpha', ['highlight:cyan', 'underline_mark']],
      [' beta ', []],
      ['gamma', ['highlight:cyan', 'underline_mark']],
    ]);
    applyChatCut(v, 'c1', report, { replaceExisting: true, newTag: null });
    expect(bodyRuns(v.state.doc)[0]).toEqual(['alpha beta ', []]);
    expect(v.state.doc.child(0).firstChild!.textContent).toBe('Tag');
  });

  it('blanks protected text and inline atoms so they cannot be quoted', () => {
    const doc = schema.nodes.doc!.createChecked(null, [
      makeCard('c1', '', para('card_body', t('Before [Omitted text here] after')), para('card_body', t('only'))),
    ]);
    const v = mount(doc, 4);
    const card = chatCutCardAtCursor(v)!;
    expect(card.paragraphs[0]).not.toContain('Omitted');
    const report = matchCutReply(card.paragraphs, { tag: null, underline: ['Omitted text here', 'after'], emphasis: [], highlight: [] });
    expect(report.rejected.map((r) => r.quote)).toEqual(['Omitted text here']);
    applyChatCut(v, 'c1', report, { replaceExisting: false, newTag: 'New tag' });
    expect(v.state.doc.child(0).firstChild!.textContent).toBe('New tag');
    expect(bodyRuns(v.state.doc).find(([, m]) => m.length)![0]).toBe('after');
  });

  it('returns null outside a card and false for a vanished card', () => {
    const doc = schema.nodes.doc!.createChecked(null, [para('paragraph', t('loose')), makeCard('c1', 'Tag', para('card_body', t('x')))]);
    const v = mount(doc, 2);
    expect(chatCutCardAtCursor(v)).toBeNull();
    expect(applyChatCut(v, 'missing', matchCutReply([], { tag: null, underline: [], emphasis: [], highlight: [] }), { replaceExisting: true, newTag: null })).toBe(false);
  });
});
