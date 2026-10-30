// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {EditorState} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {history, undo} from 'prosemirror-history';
import {schema} from '../../src/schema/index.js';
import {newWorkbook, parseFlow, serializeFlow} from '../../src/flow/flow-model.js';
import {flowNodeViews} from '../../src/editor/flow-nodeview.js';
import {setFlowDocSources} from '../../src/editor/flow-doc-sources.js';
import {getSpeechDocResolver} from '../../src/editor/speech-doc-registry.js';
import {prepRuntime} from '../../src/editor/prep-runtime.js';

let view: EditorView | null = null;
afterEach(() => { getSpeechDocResolver().unregisterView('flow-import-test'); prepRuntime.pending.clear(); prepRuntime.isolationCopies.clear(); view?.destroy(); document.body.replaceChildren(); setFlowDocSources({list: async () => [], read: async () => ({tags: []})}); });
function mount() {
  const book = newWorkbook('policy'); book.sheets[0]!.rows[0]!.cells[0]!.text = 'Existing argument';
  view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: EditorState.create({doc: schema.nodes.doc!.create(null, schema.nodes.flow_workbook!.create({data: serializeFlow(book)})), plugins: [history()]}), nodeViews: flowNodeViews,
  });
  getSpeechDocResolver().registerView('flow-import-test', view);
  return view;
}
const current = () => parseFlow(String(view!.state.doc.firstChild!.attrs['data']));
const importButton = () => [...document.querySelectorAll<HTMLButtonElement>('.pmd-flow-tool')].find(b => b.textContent === 'Import tags')!;

describe('import open document tags into Flow', () => {
  it('previews one tab per position and imports/undoes all of them together', async () => {
    setFlowDocSources({list: async () => [{uid: 'source', filename: '1AC.cmir'}], read: async () => ({tags: ['Economy', 'Climate', 'Uniqueness'], positions: [{name: 'AD1', start: 0}, {name: 'AD2', start: 1}, {name: 'Politics DA', start: 2}]})});
    const v = mount(); importButton().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('AD1 (1) · AD2 (1) · Politics DA (1)'));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await vi.waitFor(() => expect(current().sheets).toHaveLength(5));
    expect(current().sheets.slice(2).map(sheet => sheet.name)).toEqual(['AD1', 'AD2', 'Politics DA']);
    undo(v.state, v.dispatch); expect(current().sheets).toHaveLength(2);
  });
  it('lets users turn off the position split and use the filename instead', async () => {
    setFlowDocSources({list: async () => [{uid: 'source', filename: '1AC.cmir'}], read: async () => ({tags: ['Economy', 'Climate'], positions: [{name: 'AD1', start: 0}, {name: 'AD2', start: 1}]})});
    mount(); importButton().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('AD1 (1)'));
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(document.body.textContent).toContain('New tabs: 1AC (2)');
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await vi.waitFor(() => expect(current().sheets).toHaveLength(3));
    expect(current().sheets.at(-1)!.name).toBe('1AC');
  });
  it('shows a count, imports current tags into the chosen column and undoes as one action', async () => {
    const read = vi.fn(async () => ({tags: ['Preview tag']}));
    setFlowDocSources({list: async () => [{uid: 'source', filename: 'C:\\Debate\\Politics DA.docx'}], read});
    const v = mount(); importButton().click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('1 tags found'));
    const selects = document.querySelectorAll<HTMLSelectElement>('.pmd-flow-import-dialog select');
    selects[1]!.value = 'neg'; selects[1]!.dispatchEvent(new Event('change'));
    expect([...selects[2]!.options].map(o => o.value)).not.toContain('1AC');
    selects[2]!.value = '2AC';
    read.mockResolvedValue({tags: ['Updated tag one', 'Updated tag two']});
    document.querySelector<HTMLButtonElement>('.pmd-flow-import-dialog button[type="submit"]')!.click();
    await vi.waitFor(() => expect(current().sheets).toHaveLength(3));
    const sheet = current().sheets.at(-1)!;
    expect(sheet.name).toBe('Politics DA'); expect(sheet.side).toBe('neg');
    expect(sheet.rows.slice(0,2).map(row => row.cells[1]!.text)).toEqual(['Updated tag one', 'Updated tag two']);
    expect(current().sheets[0]!.rows[0]!.cells[0]!.text).toBe('Existing argument');
    expect(read).toHaveBeenCalledTimes(2);
    undo(v.state, v.dispatch); expect(current().sheets).toHaveLength(2);
  });
  it('does not import an empty source, and cancellation leaves Flow untouched', async () => {
    setFlowDocSources({list: async () => [{uid: 'source', filename: 'No tags.cmir'}], read: async () => ({tags: []})});
    mount(); importButton().click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('No tags found'));
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>('.pmd-route-cancel')!.click();
    expect(current().sheets).toHaveLength(2);
  });
  it('refuses imports into a protected prep Flow before listing or reading documents', async () => {
    const list = vi.fn(async () => []); setFlowDocSources({list, read: async () => ({tags: []})});
    mount(); prepRuntime.pending.add('flow-import-test'); importButton().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Importing tags is unavailable'));
    expect(list).not.toHaveBeenCalled(); expect(current().sheets).toHaveLength(2);
  });
  it('does not create a tab when the source closes after preview', async () => {
    const read = vi.fn(async () => ({tags: ['Tag']}));
    setFlowDocSources({list: async () => [{uid: 'source', filename: 'Case.cmir'}], read});
    mount(); importButton().click();
    await vi.waitFor(() => expect(document.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false));
    read.mockRejectedValue(new Error('The source document has closed.'));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('The source document has closed.'));
    expect(current().sheets).toHaveLength(2);
  });
  it('refuses transfers into an Isolation guest copy', async () => {
    const list = vi.fn(async () => []); setFlowDocSources({list, read: async () => ({tags: []})});
    mount(); prepRuntime.isolationCopies.add('flow-import-test'); importButton().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Importing tags is unavailable'));
    expect(list).not.toHaveBeenCalled();
  });
});
