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
import { promptForText } from '../../src/editor/text-prompt.js';
import { flowWorkspacePlugin } from '../../src/editor/flow-workspace.js';
import { prepDocumentGuard } from '../../src/editor/prep-document-guard.js';
import { loadFlowTheme } from '../../src/editor/flow-theme.js';
import type { Plugin } from 'prosemirror-state';
import { flowNodeViews } from '../../src/editor/flow-nodeview.js';
import { newWorkbook, parseFlow, serializeFlow, cellAt } from '../../src/flow/flow-model.js';
import { parseNative, serializeNative } from '../../src/native/index.js';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; document.body.replaceChildren(); localStorage.clear(); });

const frame = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

function mount(extra: Plugin[] = []): EditorView {
  const doc = schema.nodes.doc!.create(null, [
    schema.nodes.flow_workbook!.create({ data: serializeFlow(newWorkbook('npda')) }),
    schema.nodes.paragraph!.create(),
  ]);
  view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: EditorState.create({ doc, plugins: [flowWorkspacePlugin(), history(), ...extra] }),
    nodeViews: flowNodeViews,
  });
  return view;
}

const book = (v: EditorView) => parseFlow(String(v.state.doc.firstChild!.attrs['data']));
const cell = (v: EditorView, row: number, col: number): HTMLTextAreaElement =>
  v.dom.querySelector<HTMLTextAreaElement>(`textarea.pmd-flow-cell[data-row="${row}"][data-col="${col}"]`)!;
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
    expect(v.dom.querySelectorAll('textarea.pmd-flow-cell')).toHaveLength(6 * 50);
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
    const last = cell(v, 49, 2);
    last.focus();
    const originalFirst = cell(v, 0, 0);
    key(last, 'Enter');
    // Existing rows stay mounted, and the new cell is immediately ready for typing.
    expect(cell(v, 0, 0)).toBe(originalFirst);
    expect(document.activeElement).toBe(cell(v, 50, 2));
    type(cell(v, 50, 2), 'New argument');
    expect(cellAt(book(v).sheets[0]!, 50, 2).text).toBe('New argument');
    key(cell(v, 50, 2), 'Enter');
    expect(document.activeElement).toBe(cell(v, 51, 2));
    expect(cell(v, 0, 0)).toBe(originalFirst);
    await frame();
    const c = cell(v, 2, 3);
    type(c, 'Turn');
    key(c, 'X', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(cellAt(book(v).sheets[0]!, 2, 3)).toMatchObject({ text: 'Turn', crossed: true });
    expect(c.classList.contains('pmd-flow-crossed')).toBe(true);
  });

  it('appends a row in the Prep column and keeps its content on save', async () => {
    const v = mount();
    const last = cell(v, 49, 1);
    last.focus();
    key(last, 'P', { ctrlKey: true, metaKey: true, shiftKey: true });
    await frame();
    const prep = v.dom.querySelector<HTMLTextAreaElement>('textarea[data-row="49"][data-col="prep"]')!;
    prep.focus();
    key(prep, 'Enter');
    const next = v.dom.querySelector<HTMLTextAreaElement>('textarea[data-row="50"][data-col="prep"]')!;
    expect(document.activeElement).toBe(next);
    type(next, 'Next answer');
    const reopened = parseNative(serializeNative(v.state.doc)).doc;
    expect(parseFlow(String(reopened.firstChild!.attrs['data'])).sheets[0]!.rows[50]!.prep?.text).toBe('Next answer');
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
    (Array.from(v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-tool')).find((b) => b.textContent === 'Delete sheet')!).click();
    await frame();
    expect(book(v).sheets.map((s) => s.name)).toEqual(['Gov case', 'Off 1']);
  });

  it('renames the current sheet by double-clicking its top-row name', async () => {
    const v = mount();
    (v.dom.querySelectorAll('.pmd-flow-tab')[1] as HTMLButtonElement).click();
    v.dom.querySelector('.pmd-flow-title')!.dispatchEvent(new MouseEvent('dblclick'));
    await frame();
    expect(book(v).sheets[0]!.name).toBe('Gov case');
    expect(book(v).sheets[1]!.name).toBe('Politics DA');
    expect(v.dom.querySelector('.pmd-flow-title')!.textContent).toBe('Politics DA');
    expect(v.dom.querySelector('.pmd-flow-tab-active')!.textContent).toBe('Politics DA');
  });
  it('leaves the sheet name unchanged when top-row renaming is cancelled', async () => {
    vi.mocked(promptForText).mockResolvedValueOnce(null);
    const v = mount();
    v.dom.querySelector('.pmd-flow-title')!.dispatchEvent(new MouseEvent('dblclick'));
    await frame();
    expect(book(v).sheets[0]!.name).toBe('Gov case');
  });
  it('reorders sheets by drag and by Alt+arrow without changing their data', () => {
    const v = mount(); type(cell(v, 0, 0), 'Gov claim');
    const tabs = v.dom.querySelectorAll('.pmd-flow-tab');
    tabs[1]!.dispatchEvent(new Event('dragstart', {bubbles: true, cancelable: true}));
    tabs[0]!.dispatchEvent(new Event('drop', {bubbles: true, cancelable: true}));
    expect(book(v).sheets.map(s => s.name)).toEqual(['Off 1', 'Gov case']);
    expect(book(v).sheets[1]!.rows[0]!.cells[0]!.text).toBe('Gov claim');
    key(v.dom.querySelectorAll<HTMLElement>('.pmd-flow-tab')[0]!, 'ArrowDown', {altKey: true});
    expect(book(v).sheets.map(s => s.name)).toEqual(['Gov case', 'Off 1']);
  });

  it('selects a rectangle with Shift-click and clears only its cells', () => {
    const v = mount();
    type(cell(v, 0, 0), 'A'); type(cell(v, 0, 1), 'B'); type(cell(v, 1, 0), 'C'); type(cell(v, 1, 1), 'D'); type(cell(v, 2, 2), 'Keep');
    cell(v, 0, 0).dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true}));
    cell(v, 1, 1).dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true, shiftKey: true}));
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(4);
    key(cell(v, 1, 1), 'Delete');
    for (const [r,c] of [[0,0],[0,1],[1,0],[1,1]]) expect(cellAt(book(v).sheets[0]!, r!, c!).text).toBe('');
    expect(cellAt(book(v).sheets[0]!, 2, 2).text).toBe('Keep');
    expect(v.state.doc.firstChild!.type.name).toBe('flow_workbook');
    expect(v.dom.classList.contains('pmd-flow-workspace')).toBe(true);
  });

  it('clears separate modifier-clicked cells and supports Shift-arrow ranges', () => {
    const v = mount(); type(cell(v, 0, 0), 'A'); type(cell(v, 1, 1), 'Keep'); type(cell(v, 2, 2), 'B');
    cell(v, 0, 0).dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true}));
    cell(v, 2, 2).dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true, ctrlKey: true}));
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(2);
    key(cell(v, 2, 2), 'Backspace');
    expect(cellAt(book(v).sheets[0]!, 1, 1).text).toBe('Keep');
    cell(v, 3, 0).dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true}));
    key(cell(v, 3, 0), 'ArrowRight', {shiftKey: true}); key(cell(v, 3, 1), 'ArrowDown', {shiftKey: true});
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(4);
    key(cell(v, 4, 1), 'Escape'); expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(1);
  });

  it('drags across rows, clears with Backspace and restores the range with one undo', () => {
    const v = mount();
    for (let row = 0; row < 5; row++) type(cell(v, row, 0), `Argument ${row}`);
    type(cell(v, 2, 1), 'Keep adjacent');
    cell(v, 0, 0).focus();
    cell(v, 0, 0).dispatchEvent(new MouseEvent('mousedown', {button: 0, buttons: 1, bubbles: true}));
    cell(v, 3, 0).dispatchEvent(new MouseEvent('mousemove', {buttons: 1, bubbles: true, cancelable: true}));
    cell(v, 3, 0).dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true, cancelable: true}));
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(4);
    expect(document.activeElement).toBe(cell(v, 3, 0));
    key(cell(v, 3, 0), 'Backspace');
    for (let row = 0; row < 4; row++) expect(cellAt(book(v).sheets[0]!, row, 0).text).toBe('');
    expect(cellAt(book(v).sheets[0]!, 4, 0).text).toBe('Argument 4');
    expect(cellAt(book(v).sheets[0]!, 2, 1).text).toBe('Keep adjacent');
    undo(v.state, v.dispatch);
    for (let row = 0; row < 5; row++) expect(cellAt(book(v).sheets[0]!, row, 0).text).toBe(`Argument ${row}`);
  });

  it('drags rectangles upwards and stops selecting after release or blur', () => {
    const v = mount();
    cell(v, 3, 2).dispatchEvent(new MouseEvent('mousedown', {button: 0, buttons: 1, bubbles: true}));
    cell(v, 1, 1).dispatchEvent(new MouseEvent('mousemove', {buttons: 1, bubbles: true}));
    cell(v, 1, 1).dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true}));
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(6);
    cell(v, 8, 3).dispatchEvent(new MouseEvent('mousemove', {buttons: 1, bubbles: true}));
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(6);
    cell(v, 0, 0).dispatchEvent(new MouseEvent('mousedown', {button: 0, buttons: 1, bubbles: true}));
    window.dispatchEvent(new Event('blur'));
    cell(v, 8, 3).dispatchEvent(new MouseEvent('mousemove', {buttons: 1, bubbles: true}));
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(1);
  });

  it('preserves native text dragging within one cell', () => {
    const v = mount(); const area = cell(v, 0, 0); type(area, 'Select some text');
    area.dispatchEvent(new MouseEvent('mousedown', {button: 0, buttons: 1, bubbles: true}));
    area.setSelectionRange(2, 7);
    const move = new MouseEvent('mousemove', {buttons: 1, bubbles: true, cancelable: true});
    area.dispatchEvent(move);
    area.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true}));
    expect(move.defaultPrevented).toBe(false);
    expect(area.selectionStart).toBe(2); expect(area.selectionEnd).toBe(7);
    expect(v.dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(1);
  });

  it('keeps normal Shift-left text selection inside an edited cell', () => {
    const v = mount(); type(cell(v, 0, 0), 'Text');
    const area = cell(v, 0, 0); area.setSelectionRange(4,4);
    const event = new KeyboardEvent('keydown', {key: 'ArrowLeft', shiftKey: true, cancelable: true, bubbles: true});
    area.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });

  it('lets Appearance configure the highlight color and key for this computer', async () => {
    const v = mount(); type(cell(v, 0, 0), 'Highlight me');
    Array.from(v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-tool')).find(b => b.textContent === 'Appearance')!.click();
    const color = v.dom.querySelector<HTMLInputElement>('input[aria-label="Highlight color"]')!;
    color.value = '#ffcc00'; color.dispatchEvent(new Event('change'));
    const shortcut = v.dom.querySelector<HTMLInputElement>('input[aria-label="Highlight shortcut"]')!;
    const original = shortcut.value;
    key(shortcut, 'Control', {ctrlKey: true}); expect(shortcut.value).toBe(original);
    key(shortcut, 'v', {ctrlKey: true}); expect(shortcut.value).toBe(original);
    const tab = new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true});
    shortcut.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false);
    key(shortcut, 'F9'); await frame();
    expect(loadFlowTheme()).toMatchObject({highlightColor: '#ffcc00', highlightKey: 'F9'});
    expect((v.dom.querySelector('.pmd-flow-root') as HTMLElement).style.getPropertyValue('--flow-hl')).toBe('#ffcc00');
    key(cell(v, 0, 0), 'F9');
    expect(cellAt(book(v).sheets[0]!,0,0).hl).toEqual([[0,12]]);
    key(cell(v, 0, 0), 'H', {ctrlKey: true, shiftKey: true});
    expect(cellAt(book(v).sheets[0]!,0,0).hl).toEqual([[0,12]]);
  });

  it('reorders internal tabs during Prep but still refuses external drops', () => {
    const audit = vi.fn();
    const v = mount([prepDocumentGuard('prep', () => ({isPrepDocument: () => true, loggingFailed: () => false, audit, notify: () => {}}))]);
    const tabs = v.dom.querySelectorAll('.pmd-flow-tab');
    const start = new Event('dragstart', {bubbles:true,cancelable:true}); tabs[1]!.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(false);
    const drop = new Event('drop', {bubbles:true,cancelable:true}); tabs[0]!.dispatchEvent(drop);
    expect(book(v).sheets[0]!.name).toBe('Off 1');
    const external = new Event('drop', {bubbles:true,cancelable:true}); cell(v,0,0).dispatchEvent(external);
    expect(external.defaultPrevented).toBe(true);
    expect(audit).toHaveBeenCalledWith('prep', expect.objectContaining({kind:'blocked'}));
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

  it('applies backgrounds and colorways to every flow and keeps them out of the file', () => {
    localStorage.clear();
    const v = mount();
    const root = v.dom.querySelector<HTMLElement>('.pmd-flow-root')!;
    // Default: dark with Green & Pink.
    expect(root.dataset['flowTheme']).toBe('dark');
    expect(root.style.getPropertyValue('--flow-aff')).toBe('#4ade80');
    expect(root.style.getPropertyValue('--flow-neg')).toBe('#f472b6');
    (Array.from(v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-tool')).find((b) => b.textContent === 'Appearance')!).click();
    expect(v.dom.querySelectorAll('.pmd-flow-colorway').length).toBeGreaterThanOrEqual(10);
    v.dom.querySelector<HTMLButtonElement>('.pmd-flow-colorway[data-colorway="yellow-purple"]')!.click();
    expect(root.style.getPropertyValue('--flow-neg')).toBe('#c084fc');
    v.dom.querySelector<HTMLButtonElement>('.pmd-flow-seg[data-base="light"]')!.click();
    // Same colorway, darker shades for a light background.
    expect(root.style.getPropertyValue('--flow-neg')).toBe('#7e22ce');
    v.dom.querySelector<HTMLButtonElement>('.pmd-flow-seg[data-base="classic"]')!.click();
    expect(root.classList.contains('pmd-flow-usefills')).toBe(true);
    expect(root.style.getPropertyValue('--flow-fill-1')).toBe('#ccffcc');
    // Parli template colors per speech: PMC yellow, LOC green, MG orange, MO cyan, LOR yellow, PMR cyan.
    const slots = Array.from(v.dom.querySelectorAll('.pmd-flow-head')).map((h) => /pmd-flow-fill-(\d)/.exec(h.className)![1]);
    expect(slots).toEqual(['0', '1', '2', '3', '0', '3']);
    const color = v.dom.querySelectorAll<HTMLInputElement>('.pmd-flow-appearance input[type="color"]')[1]!;
    color.value = '#123456';
    color.dispatchEvent(new Event('input'));
    expect(root.style.getPropertyValue('--flow-neg')).toBe('#123456');
    expect(JSON.parse(localStorage.getItem('cmg-flow-theme')!)).toMatchObject({ base: 'classic', negText: '#123456' });
    expect(String(v.state.doc.firstChild!.attrs['data'])).not.toContain('classic');
    localStorage.clear();
  });

  it('toolbar acts on the last focused cell', () => {
    const v = mount();
    const c = cell(v, 1, 2);
    type(c, 'Turn');
    c.dispatchEvent(new Event('focus'));
    (Array.from(v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-tool')).find((b) => b.textContent === 'B')!).click();
    expect(cellAt(book(v).sheets[0]!, 1, 2)).toMatchObject({ text: 'Turn', bold: true });
    (Array.from(v.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-tool')).find((b) => b.textContent === '+ Row')!).click();
    expect(cellAt(book(v).sheets[0]!, 2, 2).text).toBe('');
    expect(cellAt(book(v).sheets[0]!, 1, 2).text).toBe('Turn');
  });

  it('document view: Enter starts a new argument in its own cell', async () => {
    const v = mount();
    type(cell(v, 0, 1), 'Existing LOC answer');
    v.dom.querySelectorAll('.pmd-flow-head')[0]!.dispatchEvent(new MouseEvent('dblclick'));
    await frame();
    const secs = () => Array.from(v.dom.querySelectorAll<HTMLTextAreaElement>('.pmd-flow-docsec'));
    type(secs()[0]!, 'Adv 1 econ');
    secs()[0]!.setSelectionRange(10, 10);
    key(secs()[0]!, 'Enter');
    await frame();
    expect(document.activeElement).toBe(secs()[1]);
    type(secs()[1]!, 'Adv 2 war');
    key(secs()[1]!, 'Enter');
    await frame();
    type(secs()[2]!, 'Adv 3 rights');
    const sheet = () => book(v).sheets[0]!;
    expect([0, 1, 2].map((r) => cellAt(sheet(), r, 0).text)).toEqual(['Adv 1 econ', 'Adv 2 war', 'Adv 3 rights']);
    expect(cellAt(sheet(), 0, 1).text).toBe('Existing LOC answer');
    // Splitting mid-text moves the rest to a new argument; Backspace at its start joins back.
    secs()[1]!.setSelectionRange(5, 5);
    key(secs()[1]!, 'Enter');
    await frame();
    expect(secs().map((s) => s.value)).toEqual(['Adv 1 econ', 'Adv 2', ' war', 'Adv 3 rights']);
    secs()[2]!.setSelectionRange(0, 0);
    key(secs()[2]!, 'Backspace');
    await frame();
    expect(secs().map((s) => s.value)).toEqual(['Adv 1 econ', 'Adv 2 war', 'Adv 3 rights']);
    expect([0, 1, 2, 3].map((r) => cellAt(sheet(), r, 0).text)).toEqual(['Adv 1 econ', 'Adv 2 war', '', 'Adv 3 rights']);
  });

  it('document view: a blank argument stays a blank cell in the sheet', async () => {
    const v = mount();
    v.dom.querySelectorAll('.pmd-flow-head')[0]!.dispatchEvent(new MouseEvent('dblclick'));
    await frame();
    const secs = () => Array.from(v.dom.querySelectorAll<HTMLTextAreaElement>('.pmd-flow-docsec'));
    type(secs()[0]!, 'res');
    key(secs()[0]!, 'Enter');
    await frame();
    type(secs()[1]!, '  ');
    key(secs()[1]!, 'Enter');
    await frame();
    type(secs()[2]!, 'Plan');
    (Array.from(v.dom.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Back to sheet')!).click();
    await frame();
    expect([0, 1, 2].map((r) => cellAt(book(v).sheets[0]!, r, 0).text)).toEqual(['res', '  ', 'Plan']);
    expect(cell(v, 2, 0).value).toBe('Plan');
  });

  it('document view: pasted lines and old multi-line cells become separate arguments', async () => {
    const v = mount();
    type(cell(v, 0, 0), 'one\ntwo\nthree');
    v.dom.querySelectorAll('.pmd-flow-head')[0]!.dispatchEvent(new MouseEvent('dblclick'));
    await frame();
    const split = v.dom.querySelector<HTMLButtonElement>('.pmd-flow-split')!;
    expect(split).not.toBeNull();
    split.click();
    await frame();
    expect([0, 1, 2].map((r) => cellAt(book(v).sheets[0]!, r, 0).text)).toEqual(['one', 'two', 'three']);
    const secs = () => Array.from(v.dom.querySelectorAll<HTMLTextAreaElement>('.pmd-flow-docsec'));
    const last = secs()[2]!;
    last.setSelectionRange(5, 5);
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => ' A\nB\nC' } });
    last.dispatchEvent(paste);
    await frame();
    expect(secs().map((s) => s.value)).toEqual(['one', 'two', 'three A', 'B', 'C']);
  });

  it('highlights selected text (or the whole cell) and paints it behind the text', () => {
    const v = mount();
    const c = cell(v, 0, 0);
    type(c, 'nuclear war is likely');
    c.focus();
    c.setSelectionRange(0, 11);
    key(c, 'H', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(cellAt(book(v).sheets[0]!, 0, 0).hl).toEqual([[0, 11]]);
    const marks = () => Array.from(c.parentElement!.querySelectorAll('mark.pmd-flow-mark')).map((m) => m.textContent);
    expect(marks()).toEqual(['nuclear war']);
    // Typing inside the highlight keeps it highlighted.
    c.value = 'nuclear world war is likely';
    c.dispatchEvent(new Event('input'));
    expect(marks()).toEqual(['nuclear world war']);
    // Nothing selected: toggles the whole cell (here: clears it).
    c.setSelectionRange(3, 3);
    key(c, 'H', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(cellAt(book(v).sheets[0]!, 0, 0).hl).toBeUndefined();
    key(c, 'H', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(cellAt(book(v).sheets[0]!, 0, 0).hl).toEqual([[0, 27]]);
  });

  it('opens the Prep column next to the current speech and keeps it with the rows', async () => {
    const v = mount();
    const loc = cell(v, 1, 1);
    loc.focus();
    key(loc, 'P', { ctrlKey: true, metaKey: true, shiftKey: true });
    await frame();
    const heads = Array.from(v.dom.querySelectorAll('.pmd-flow-head')).map((h) => h.textContent);
    expect(heads).toEqual(['PMC', 'LOC', 'Prep', 'MG', 'MO', 'LOR', 'PMR']);
    const prep = v.dom.querySelector<HTMLTextAreaElement>('textarea.pmd-flow-cell[data-row="1"][data-col="prep"]')!;
    expect(document.activeElement).toBe(prep);
    type(prep, 'Thumper: China tensions');
    expect(book(v).sheets[0]!.rows[1]!.prep?.text).toBe('Thumper: China tensions');
    // Tab goes on to MG; Shift+Tab from MG comes back to Prep.
    key(prep, 'Tab');
    expect(document.activeElement).toBe(cell(v, 1, 2));
    key(cell(v, 1, 2), 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(prep);
    key(prep, 'P', { ctrlKey: true, metaKey: true, shiftKey: true });
    await frame();
    expect(v.dom.querySelector('.pmd-flow-prep-head')).toBeNull();
    // The prep text is saved even while the column is hidden.
    expect(book(v).sheets[0]!.rows[1]!.prep?.text).toBe('Thumper: China tensions');
  });

  it('undo after typing is not mistaken for a partner’s stale copy', () => {
    const v = mount();
    type(cell(v, 0, 0), 'A');
    type(cell(v, 0, 0), 'AB');
    undo(v.state, v.dispatch);
    expect(cell(v, 0, 0).value).not.toBe('AB');
  });

  it('re-renders when the data changes from outside', () => {
    const v = mount();
    const pos = 0;
    const next = newWorkbook('policy');
    v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { data: serializeFlow(next) }));
    expect(Array.from(v.dom.querySelectorAll('.pmd-flow-head')).map((h) => h.textContent)[0]).toBe('1AC');
  });
});
