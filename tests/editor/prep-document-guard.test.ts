// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from '../../src/schema/index.js';
import { markSyncOrigin } from '../../src/editor/sync-origin.js';
import { prepDocumentGuard, configurePrepGuards, PREP_EXPANSION_META, type PrepGuardPolicy } from '../../src/editor/prep-document-guard.js';
import { newWorkbook, serializeFlow, parseFlow } from '../../src/flow/flow-model.js';
import { flowNodeViews } from '../../src/editor/flow-nodeview.js';
import { buildMacroKeymap } from '../../src/editor/keyboard-macros.js';
import { makeAutocorrectPlugin } from '../../src/editor/autocorrect.js';
import { PluginKey } from 'prosemirror-state';

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren(); configurePrepGuards(null); });
function policy(): PrepGuardPolicy & { audit: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> } {
  return { isPrepDocument: id => id === 'prep', loggingFailed: () => false, audit: vi.fn(), notify: vi.fn() };
}
function mount(p: PrepGuardPolicy | null, uid = 'prep', text = '', extra: Plugin[] = [], flow = false): EditorView {
  const doc = schema.nodes.doc!.create(null, flow ? [schema.nodes.flow_workbook!.create({ data: serializeFlow(newWorkbook('npda')) }), schema.nodes.paragraph!.create()] :
    [schema.nodes.paragraph!.create(null, text ? schema.text(text) : null)]);
  const root = document.body.appendChild(document.createElement('div'));
  const view = new EditorView(root, { state: EditorState.create({ doc, plugins: [prepDocumentGuard(uid, () => p), history(), ...extra] }), nodeViews: flowNodeViews });
  views.push(view);
  return view;
}
const event = (target: EventTarget, type: string) => {
  const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(ev);
  return ev;
};

describe('per-document Prep protection', () => {
  it('is inert without policy and leaves strategy docs unrestricted', () => {
    const p = policy();
    for (const view of [mount(null), mount(p, 'strategy')]) {
      view.dispatch(view.state.tr.insertText('x'.repeat(200), 1));
      expect(view.state.doc.textContent).toHaveLength(200);
      expect(event(view.dom, 'copy').defaultPrevented).toBe(false);
    }
    expect(p.audit).not.toHaveBeenCalled();
  });
  it('allows typing, formatting, deletions and a 40-character insert, but blocks larger inserts', () => {
    const p = policy(), view = mount(p);
    view.dispatch(view.state.tr.insertText('x'.repeat(40), 1));
    view.dispatch(view.state.tr.insertText('y'.repeat(41), 1));
    expect(view.state.doc.textContent).toBe('x'.repeat(40));
    view.dispatch(view.state.tr.addMark(1, 41, schema.marks.bold!.create()));
    view.dispatch(view.state.tr.delete(1, 41));
    expect(view.state.doc.textContent).toBe('');
    expect(p.audit.mock.calls.filter(c => c[1].kind === 'blocked')).toHaveLength(1);
  });
  it('counts replacement text rather than net growth, and sums inserts across steps', () => {
    const p = policy(), view = mount(p, 'prep', 'a'.repeat(200));
    view.dispatch(view.state.tr.insertText('b'.repeat(200), 1, 201));
    expect(view.state.doc.textContent).toBe('a'.repeat(200));
    view.dispatch(view.state.tr.insertText('x'.repeat(25), 1).insertText('y'.repeat(25), 1));
    expect(view.state.doc.textContent).toBe('a'.repeat(200));
  });
  it.each(['paste', 'drop', 'cut'])('rejects even short programmatic %s transactions', type => {
    const p = policy(), view = mount(p);
    view.dispatch(view.state.tr.insertText('short', 1).setMeta('uiEvent', type));
    expect(view.state.doc.textContent).toBe('');
    expect(p.audit).toHaveBeenCalledWith('prep', expect.objectContaining({ kind: 'blocked' }));
  });
  it('permits and logs a real keyboard macro and autocorrect expansion/revert', () => {
    const p = policy(), view = mount(p);
    const macro = buildMacroKeymap([{ id: 'prep-test-macro', key: 'F2', text: 'm'.repeat(100) }])['F2']!;
    macro(view.state, view.dispatch.bind(view), view);
    expect(view.state.doc.textContent).toHaveLength(100);
    expect(p.audit).toHaveBeenCalledWith('prep', expect.objectContaining({ kind: 'macro', flagged: true }));
    const correction = makeAutocorrectPlugin(new PluginKey('prep-test-correct'), [{ enabled: () => true, triggers: () => true,
      match: () => ({ replaceFrom: 1, insert: 'c'.repeat(100), revertTo: 'literal' }) }]);
    const corrected = mount(p, 'prep', '', [correction]);
    corrected.someProp('handleTextInput', fn => fn(corrected, 1, 1, ' ', () => corrected.state.tr.insertText(' ')));
    expect(corrected.state.doc.textContent).toBe('c'.repeat(100));
    corrected.someProp('handleKeyDown', fn => fn(corrected, new KeyboardEvent('keydown', { key: 'Backspace' })));
    expect(corrected.state.doc.textContent).toBe('literal');
    expect(p.audit.mock.calls.filter(c => c[1].kind === 'autocorrect')).toHaveLength(2);
  });
  it('allows and flags history restoration of large pre-session text', () => {
    const p = policy(), view = mount(p, 'prep', 'a'.repeat(100));
    view.dispatch(view.state.tr.delete(1, 101));
    expect(undo(view.state, view.dispatch.bind(view))).toBe(true);
    expect(view.state.doc.textContent).toHaveLength(100);
    expect(p.audit).toHaveBeenCalledWith('prep', expect.objectContaining({ kind: 'undo-redo', flagged: true }));
    expect(redo(view.state, view.dispatch.bind(view))).toBe(true);
    expect(view.state.doc.textContent).toBe('');
  });
  it('does not reject already-merged remote changes, and flags large partner inserts', () => {
    const p = policy(), view = mount(p);
    view.dispatch(markSyncOrigin(view.state.tr.insertText('remote'.repeat(30), 1)));
    expect(view.state.doc.textContent).toHaveLength(180);
    expect(p.audit).toHaveBeenCalledWith('prep', expect.objectContaining({ kind: 'remote-change', flagged: true }));
  });
  it('does not log a change rejected by a later plugin', () => {
    const p = policy(), view = mount(p, 'prep', '', [new Plugin({ filterTransaction: () => false })]);
    view.dispatch(view.state.tr.insertText('typed', 1));
    expect(p.audit).not.toHaveBeenCalled();
  });
  it('blocks changes if logging has failed, including macros and undo', () => {
    const p = policy(), view = mount(p);
    p.loggingFailed = () => true;
    view.dispatch(view.state.tr.insertText('small', 1).setMeta(PREP_EXPANSION_META, 'macro'));
    expect(view.state.doc.textContent).toBe('');
    expect(p.audit).toHaveBeenCalledWith('prep', expect.objectContaining({ kind: 'blocked', reason: expect.stringContaining('log') }));
  });
  it.each(['copy', 'cut', 'paste', 'dragstart', 'drop'])('blocks %s before target handlers and only within the prep pane', type => {
    const p = policy(), prep = mount(p), strategy = mount(p, 'strategy');
    const handler = vi.fn();
    prep.dom.addEventListener(type, handler);
    expect(event(prep.dom, type).defaultPrevented).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(event(strategy.dom, type).defaultPrevented).toBe(false);
    const search = document.body.appendChild(document.createElement('input'));
    expect(event(search, type).defaultPrevented).toBe(false);
  });
  it.each(['insertFromPaste', 'insertFromDrop', 'insertFromYank', 'deleteByCut', 'insertFromPasteAsQuotation'])('blocks beforeinput %s and permits ordinary typing/IME', inputType => {
    const p = policy(), view = mount(p);
    const ev = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    for (const type of ['insertText', 'insertCompositionText', 'insertReplacementText', 'deleteContentBackward']) {
      const typed = new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true });
      view.dom.dispatchEvent(typed);
      expect(typed.defaultPrevented).toBe(false);
    }
  });
  it('protects flow cells and rejects large attribute-based inserts, including the Prep column', () => {
    const p = policy(), view = mount(p, 'prep', '', [], true);
    const cell = view.dom.querySelector('textarea')!;
    expect(event(cell, 'paste').defaultPrevented).toBe(true);
    const setCell = (text: string, prep = false) => {
      const book = parseFlow(String(view.state.doc.firstChild!.attrs['data']));
      if (prep) book.sheets[0]!.rows[0]!.prep = { text };
      else book.sheets[0]!.rows[0]!.cells[0]!.text = text;
      view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { data: serializeFlow(book) }));
    };
    setCell('a'.repeat(41));
    expect(parseFlow(String(view.state.doc.firstChild!.attrs['data'])).sheets[0]!.rows[0]!.cells[0]!.text).toBe('');
    setCell('b'.repeat(41), true);
    expect(parseFlow(String(view.state.doc.firstChild!.attrs['data'])).sheets[0]!.rows[0]!.prep).toBeUndefined();
    setCell('typed');
    expect(parseFlow(String(view.state.doc.firstChild!.attrs['data'])).sheets[0]!.rows[0]!.cells[0]!.text).toBe('typed');
  });
  it('uses dynamic policy and removes capture handlers when destroyed', () => {
    const p = policy();
    configurePrepGuards(p);
    const view = new EditorView(document.body.appendChild(document.createElement('div')), {
      state: EditorState.create({ schema, plugins: [prepDocumentGuard('prep')] }),
    });
    expect(event(view.dom, 'copy').defaultPrevented).toBe(true);
    p.isPrepDocument = () => false;
    expect(event(view.dom, 'copy').defaultPrevented).toBe(false);
    p.isPrepDocument = () => true;
    const root = view.dom;
    view.destroy();
    document.body.appendChild(root);
    expect(event(root, 'copy').defaultPrevented).toBe(false);
  });

  it.each([false, true])('rolls back refused flow input in the visible UI (column view = %s)', columnView => {
    const p = policy(), view = mount(p, 'prep', '', [], true);
    if (columnView) view.dom.querySelector('.pmd-flow-head')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const selector = columnView ? 'textarea.pmd-flow-docsec' : 'textarea.pmd-flow-cell[data-row="0"][data-col="0"]';
    const area = () => view.dom.querySelector<HTMLTextAreaElement>(selector)!;
    expect(area()).toBeTruthy();
    area().value = 'z'.repeat(80);
    event(area(), 'input');
    expect(area().value).toBe('');
    expect(parseFlow(String(view.state.doc.firstChild!.attrs['data'])).sheets[0]!.rows[0]!.cells[0]!.text).toBe('');
    // A later legitimate edit must not accidentally include the rejected text.
    area().value = 'typed';
    event(area(), 'input');
    expect(parseFlow(String(view.state.doc.firstChild!.attrs['data'])).sheets[0]!.rows[0]!.cells[0]!.text).toBe('typed');
  });

  it('sums changes across flow cells and permits purely visual flow changes', () => {
    const p = policy(), view = mount(p, 'prep', '', [], true);
    const book = parseFlow(String(view.state.doc.firstChild!.attrs['data']));
    book.sheets[0]!.rows[0]!.cells[0]!.text = 'a'.repeat(25);
    book.sheets[0]!.rows[0]!.cells[1]!.text = 'b'.repeat(25);
    view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { data: serializeFlow(book) }));
    expect(parseFlow(String(view.state.doc.firstChild!.attrs['data'])).sheets[0]!.rows[0]!.cells[0]!.text).toBe('');
    const visual = parseFlow(String(view.state.doc.firstChild!.attrs['data']));
    visual.sheets[0]!.rows[0]!.cells[0]!.bold = true;
    view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { data: serializeFlow(visual) }));
    expect(parseFlow(String(view.state.doc.firstChild!.attrs['data'])).sheets[0]!.rows[0]!.cells[0]!.bold).toBe(true);
  });

  it('rejects unreadable local flow changes but admits and flags remote ones', () => {
    const p = policy(), view = mount(p, 'prep', '', [], true);
    const original = view.state.doc.firstChild!.attrs['data'];
    view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { data: 'bad flow' }));
    expect(view.state.doc.firstChild!.attrs['data']).toBe(original);
    view.dispatch(markSyncOrigin(view.state.tr.setNodeMarkup(0, undefined, { data: 'bad flow' })));
    expect(view.state.doc.firstChild!.attrs['data']).toBe('bad flow');
    expect(p.audit).toHaveBeenCalledWith('prep', expect.objectContaining({ kind: 'remote-change', flagged: true, reason: expect.stringContaining('Unreadable') }));
  });
});
