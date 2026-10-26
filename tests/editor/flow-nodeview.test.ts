// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/editor/text-prompt.js', () => ({
  promptForText: vi.fn(async () => 'Politics DA'),
  confirmDialog: vi.fn(async () => true),
}));

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo } from 'prosemirror-history';
import { schema } from '../../src/schema/index.js';
import { flowNodeViews } from '../../src/editor/flow-nodeview.js';
import { newWorkbook, parseFlow, serializeFlow, cellAt } from '../../src/flow/flow-model.js';
import { parseNative, serializeNative } from '../../src/native/index.js';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; document.body.replaceChildren(); });

const frame = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

function mount(): EditorView {
  const doc = schema.nodes.doc!.create(null, [
    schema.nodes.flow_workbook!.create({ data: serializeFlow(newWorkbook('npda')) }),
    schema.nodes.paragraph!.create(),
  ]);
  view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: EditorState.create({ doc, plugins: [history()] }),
    nodeViews: flowNodeViews,
  });
  return view;
}

const book = (v: EditorView) => parseFlow(String(v.state.doc.firstChild!.attrs['data']));
const cell = (v: EditorView, row: number, col: number): HTMLTextAreaElement =>
  v.dom.querySelector<HTMLTextAreaElement>(`.pmd-flow-cell[data-row="${row}"][data-col="${col}"]`)!;
function type(area: HTMLTextAreaElement, text: string): void {
  area.value = text;
  area.dispatchEvent(new Event('input'));
}
function key(area: HTMLElement, k: string, opts: KeyboardEventInit = {}): void {
  area.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}

describe('flow NodeView', () => {
  it('renders NPDA sheets and colors speeches by side', () => {
    const v = mount();
    const tabs = Array.from(v.dom.querySelectorAll('.pmd-flow-tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['Gov case', 'Off 1']);
    const heads = Array.from(v.dom.querySelectorAll('.pmd-flow-head'));
    expect(heads.map((h) => h.textContent)).toEqual(['PMC', 'LOC', 'MG', 'MO', 'LOR', 'PMR']);
    expect(heads.map((h) => h.classList.contains('pmd-flow-side-aff'))).toEqual([true, false, true, false, false, true]);
    expect(v.dom.querySelectorAll('.pmd-flow-cell')).toHaveLength(6 * 20);
  });

  it('commits typing to the document, survives save/load, and undoes', () => {
    const v = mount();
    type(cell(v, 0, 0), 'Adv 1: econ');
    type(cell(v, 0, 1), 'No link');
    expect(cellAt(book(v).sheets[0]!, 0, 1).text).toBe('No link');
    const reopened = parseNative(serializeNative(v.state.doc)).doc;
    expect(cellAt(parseFlow(String(reopened.firstChild!.attrs['data'])).sheets[0]!, 0, 0).text).toBe('Adv 1: econ');
    undo(v.state, v.dispatch);
    undo(v.state, v.dispatch);
    expect(cellAt(book(v).sheets[0]!, 0, 0).text).toBe('');
    expect(cell(v, 0, 0).value).toBe('');
  });

  it('moves with Enter and Tab, adds rows at the bottom, and toggles marks', async () => {
    const v = mount();
    const first = cell(v, 0, 0);
    first.focus();
    key(first, 'Tab');
    expect(document.activeElement).toBe(cell(v, 0, 1));
    key(cell(v, 0, 1), 'Enter');
    expect(document.activeElement).toBe(cell(v, 1, 1));
    const last = cell(v, 19, 2);
    last.focus();
    key(last, 'Enter');
    await frame();
    // A new empty row appears on screen (empty trailing rows are not saved).
    expect(document.activeElement).toBe(cell(v, 20, 2));
    const c = cell(v, 2, 3);
    type(c, 'Turn');
    key(c, 'X', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(cellAt(book(v).sheets[0]!, 2, 3)).toMatchObject({ text: 'Turn', crossed: true });
    expect(c.classList.contains('pmd-flow-crossed')).toBe(true);
  });

  it('adds, renames and deletes sheets', async () => {
    const v = mount();
    (Array.from(v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-add')).find((b) => b.textContent === '+ Opp')!).click();
    expect(book(v).sheets.map((s) => s.name)).toEqual(['Gov case', 'Off 2', 'Off 1']);
    expect(v.dom.querySelector('.pmd-flow-tab-active')!.textContent).toBe('Off 2');
    expect(Array.from(v.dom.querySelectorAll('.pmd-flow-head')).map((h) => h.textContent)[0]).toBe('LOC');
    v.dom.querySelector('.pmd-flow-tab-active')!.dispatchEvent(new MouseEvent('dblclick'));
    await frame();
    expect(book(v).sheets[1]!.name).toBe('Politics DA');
    (Array.from(v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-add')).find((b) => b.textContent === 'Delete sheet')!).click();
    await frame();
    expect(book(v).sheets.map((s) => s.name)).toEqual(['Gov case', 'Off 1']);
  });

  it('expands a column into a document and back, keeping rows aligned', async () => {
    const v = mount();
    type(cell(v, 0, 0), 'Adv 1');
    type(cell(v, 0, 1), 'A1 answer');
    type(cell(v, 3, 0), 'Adv 2');
    v.dom.querySelectorAll('.pmd-flow-head')[0]!.dispatchEvent(new MouseEvent('dblclick'));
    const secs = () => Array.from(v.dom.querySelectorAll<HTMLTextAreaElement>('.pmd-flow-docsec'));
    expect(secs().map((s) => s.value)).toEqual(['Adv 1', 'Adv 2']);
    type(secs()[0]!, 'Adv 1 — econ collapse');
    (v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-addsec')[0]!).click();
    await frame();
    type(secs()[1]!, 'Adv 1.5 added in doc view');
    type(secs()[1]!, 'Adv 1.5 edited again');
    key(secs()[0]!, 'Escape');
    await frame();
    const sheet = book(v).sheets[0]!;
    expect([0, 1, 2, 3].map((r) => [cellAt(sheet, r, 0).text, cellAt(sheet, r, 1).text])).toEqual([
      ['Adv 1 — econ collapse', 'A1 answer'],
      ['Adv 1.5 edited again', ''],
      ['', ''],
      ['Adv 2', ''],
    ]);
    expect(v.dom.querySelector('.pmd-flow-grid')).not.toBeNull();
  });

  it('re-renders when the data changes from outside', () => {
    const v = mount();
    const pos = 0;
    const next = newWorkbook('policy');
    v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { data: serializeFlow(next) }));
    expect(Array.from(v.dom.querySelectorAll('.pmd-flow-head')).map((h) => h.textContent)[0]).toBe('1AC');
  });
});
