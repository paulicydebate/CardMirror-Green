// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../../src/editor/clipboard-write.js', () => ({ writeClipboardText: vi.fn(async () => true) }));

import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';
import { openChatCut, describeReport } from '../../src/editor/chat-cut-ui.js';
import { writeClipboardText } from '../../src/editor/clipboard-write.js';
import { showToast } from '../../src/editor/toast.js';
import { matchCutReply } from '../../src/cutting/chat-cut.js';

const t = (v: string): PMNode => schema.text(v);
let view: EditorView | null = null;

function mount(): EditorView {
  const card = schema.nodes.card!.createChecked(null, [
    schema.nodes.tag!.create({ id: 'c1' }, []),
    schema.nodes.cite_paragraph!.create(null, [t('Lee 24')]),
    schema.nodes.card_body!.create(null, [t('Warming causes extinction through cascading collapse.')]),
  ]);
  const doc = schema.nodes.doc!.createChecked(null, [card]);
  const state = EditorState.create({ doc });
  view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: state.apply(state.tr.setSelection(TextSelection.create(doc, 5))),
  });
  return view;
}

const $ = <T extends Element>(sel: string): T => {
  const n = document.querySelector<T>(sel);
  if (!n) throw new Error('missing ' + sel);
  return n;
};
const buttonByText = (label: string): HTMLButtonElement =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.pmd-ccut-dialog button')).find((b) => b.textContent === label)!;

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.mocked(showToast).mockClear();
});

describe('chat cut dialog', () => {
  it('copies a prompt, checks a pasted reply, and applies it', async () => {
    const v = mount();
    openChatCut(v);
    $<HTMLTextAreaElement>('textarea[aria-label="What should this card prove"]').value = 'warming is existential';
    buttonByText('Copy prompt').click();
    await new Promise((r) => setTimeout(r, 0));
    const prompt = vi.mocked(writeClipboardText).mock.calls[0]![0];
    expect(prompt).toContain('The card should prove: warming is existential');
    expect(prompt).toContain('Warming causes extinction through cascading collapse.');
    expect(prompt).not.toContain('Lee 24\n>>>');

    const reply = $<HTMLTextAreaElement>('textarea[aria-label="AI reply"]');
    reply.value = 'not json';
    reply.dispatchEvent(new Event('input'));
    expect($('.pmd-ccut-report').classList.contains('pmd-ccut-error')).toBe(true);
    expect(buttonByText('Apply to card').disabled).toBe(true);

    reply.value = '```json\n{"tag":"Warming causes extinction","underline":["Warming causes extinction through cascading collapse"],"highlight":["Warming causes extinction","made up words"]}\n```';
    reply.dispatchEvent(new Event('input'));
    const report = $('.pmd-ccut-report').textContent!;
    expect(report).toContain('Found 1 underline, 0 emphasis and 1 highlight quotes');
    expect(report).toContain('Not in the card, skipped (highlight): “made up words”');
    const useTag = Array.from(document.querySelectorAll<HTMLLabelElement>('.pmd-ccut-dialog label')).find((l) => l.textContent?.startsWith('Use the AI'))!;
    expect(useTag.hidden).toBe(false);
    expect(useTag.querySelector('input')!.checked).toBe(true); // empty tag → default on

    buttonByText('Apply to card').click();
    expect(document.querySelector('.pmd-ccut-dialog')).toBeNull();
    expect(v.state.doc.child(0).firstChild!.textContent).toBe('Warming causes extinction');
    const marks = new Set<string>();
    v.state.doc.descendants((n) => { if (n.isText) n.marks.forEach((m) => marks.add(m.type.name)); });
    expect([...marks].sort()).toEqual(['highlight', 'underline_mark']);
    expect(vi.mocked(showToast).mock.calls[0]![0]).toContain('1 quote skipped');
  });

  it('refuses to open outside a card', () => {
    const v = mount();
    const para = schema.nodes.paragraph!.create(null, [t('loose')]);
    v.dispatch(v.state.tr.insert(v.state.doc.content.size, para));
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, v.state.doc.content.size - 1)));
    openChatCut(v);
    expect(document.querySelector('.pmd-ccut-dialog')).toBeNull();
    expect(vi.mocked(showToast)).toHaveBeenCalled();
  });

  it('describes notes for auto-underlined and out-of-order quotes', () => {
    const r = matchCutReply(['a b c d'], { tag: null, underline: [], emphasis: [], highlight: ['c d', 'a b'] });
    const d = describeReport(r);
    expect(d.notes.join(' ')).toContain('2 highlighted passages were not underlined');
    expect(d.notes.join(' ')).toContain('1 quote was out of reading order');
  });
});
