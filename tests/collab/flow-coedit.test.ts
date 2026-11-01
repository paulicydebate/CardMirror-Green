// @vitest-environment jsdom
// Two people co-editing one spreadsheet flow over the real Loro binding.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/editor/text-prompt.js', () => ({promptForText: vi.fn(), confirmDialog: vi.fn(async () => true), alertDialog: vi.fn()}));
import { promptForText } from '../../src/editor/text-prompt.js';
import { schema } from '../../src/schema/index.js';
import { flowNodeViews } from '../../src/editor/flow-nodeview.js';
import { cellAt, newWorkbook, parseFlow, serializeFlow } from '../../src/flow/flow-model.js';
import { createLoroPeers, settle, syncAll, type LoroPeer } from './_loro-helpers.js';

function seed() {
  return schema.nodes.doc!.create(null, [
    schema.nodes.flow_workbook!.create({ data: serializeFlow(newWorkbook('npda')) }),
    schema.nodes.paragraph!.create(),
  ]);
}
const flowOf = (p: LoroPeer) => parseFlow(String(p.doc().firstChild!.attrs['data']));
const cellEl = (p: LoroPeer, row: number, col: number) =>
  p.view.dom.querySelector<HTMLTextAreaElement>(`.pmd-flow-cell[data-row="${row}"][data-col="${col}"]`)!;
function typeInto(area: HTMLTextAreaElement, text: string): void {
  area.value = text;
  area.setSelectionRange(text.length, text.length);
  area.dispatchEvent(new Event('input'));
}

describe('flow co-editing', () => {
  it('keeps a partner’s new argument when typing in expanded column view', async () => {
    const peers = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    try {
      const [a,b] = peers;
      typeInto(cellEl(a!,0,0),'Mine');
      await syncAll(peers); await settle(5);
      a!.view.dom.querySelectorAll('.pmd-flow-head')[0]!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      await new Promise(resolve => setTimeout(resolve,40));
      const area = a!.view.dom.querySelector<HTMLTextAreaElement>('textarea.pmd-flow-docsec')!; area.focus();
      typeInto(cellEl(b!,1,0),'Partner');
      await syncAll(peers); await settle(5); area.focus();
      typeInto(area,'Mine edited');
      area.setSelectionRange(area.value.length, area.value.length);
      area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await syncAll(peers); await settle(5); await syncAll(peers); await settle(5);
      for (const peer of peers) {
        expect(flowOf(peer).sheets[0]!.rows[0]!.cells[0]!.text).toBe('Mine edited');
        expect(flowOf(peer).sheets[0]!.rows.some(row => row.cells[0]!.text === 'Partner')).toBe(true);
      }
    } finally { peers.forEach(p => p.destroy()); }
  });

  it('keeps focus on the same row when the partner inserts above it', async () => {
    const peers = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    try {
      const [a,b] = peers; const editing = cellEl(a!,3,0); editing.focus(); typeInto(editing,'Keep typing');
      const beforeId = flowOf(a!).sheets[0]!.rows[3]!.id;
      const other = cellEl(b!,0,0); other.focus();
      other.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,metaKey:true,bubbles:true,cancelable:true}));
      await new Promise(resolve => setTimeout(resolve, 40)); editing.focus();
      await syncAll(peers); await settle(8); await syncAll(peers); await settle(8);
      const sheet = flowOf(a!).sheets[0]!; const index = sheet.rows.findIndex(row => row.id === beforeId);
      expect(index).toBeGreaterThan(3);
      expect(sheet.rows[index]!.cells[0]!.text).toBe('Keep typing');
      expect(document.activeElement).toBe(cellEl(a!,index,0));
    } finally { peers.forEach(p => p.destroy()); }
  });

  it('keeps both participants’ new rows after they press Enter simultaneously', async () => {
    const peers = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    try {
      for (const [i, peer] of peers.entries()) {
        const last = cellEl(peer,49,i); last.focus();
        last.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        typeInto(cellEl(peer,50,i), i === 0 ? 'Argument A' : 'Argument B');
      }
      for (let i=0;i<4;i++) { await syncAll(peers); await settle(5); }
      for (const peer of peers) {
        const sheet = flowOf(peer).sheets[0]!;
        expect(sheet.rows.some(r => r.cells[0]!.text === 'Argument A')).toBe(true);
        expect(sheet.rows.some(r => r.cells[1]!.text === 'Argument B')).toBe(true);
      }
      expect(String(peers[0]!.doc().firstChild!.attrs['data'])).toBe(String(peers[1]!.doc().firstChild!.attrs['data']));
    } finally { peers.forEach(p => p.destroy()); }
  });

  it('keeps a newly appended row and its text when a partner edits concurrently', async () => {
    const peers = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    const [a,b] = peers;
    try {
      const last = cellEl(a!,49,0); last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      typeInto(cellEl(a!,50,0), 'New row argument');
      typeInto(cellEl(b!,0,1), 'Concurrent partner text');
      await syncAll(peers); await settle(6); await syncAll(peers); await settle(6); await syncAll(peers); await settle(6);
      for (const peer of peers) {
        expect(flowOf(peer).sheets[0]!.rows.some(row => row.cells[0]!.text === 'New row argument')).toBe(true);
        expect(flowOf(peer).sheets[0]!.rows[0]!.cells[1]!.text).toBe('Concurrent partner text');
      }
    } finally { peers.forEach(p => p.destroy()); }
  });

  it('converges when both people create and type in named Prep columns', async () => {
    const peers = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    try {
      for (const p of peers) {
        const first = cellEl(p, 0, 0); first.focus();
        first.dispatchEvent(new KeyboardEvent('keydown', {key:'P',ctrlKey:true,metaKey:true,shiftKey:true,bubbles:true,cancelable:true}));
      }
      await settle();
      vi.mocked(promptForText).mockResolvedValueOnce('A2 T').mockResolvedValueOnce('A2 K');
      for (const p of peers) {
        p.view.dom.querySelector<HTMLButtonElement>('[aria-label="Create Prep column"]')!.click();
        await settle();
      }
      typeInto(peers[0]!.view.dom.querySelector<HTMLTextAreaElement>('textarea[data-row="0"][data-col="prep"]')!, 'Theory');
      typeInto(peers[1]!.view.dom.querySelector<HTMLTextAreaElement>('textarea[data-row="0"][data-col="prep"]')!, 'Kritik');
      await syncAll(peers); await settle(6); await syncAll(peers); await settle(6); await syncAll(peers); await settle(6);
      for (const p of peers) {
        const sheet = flowOf(p).sheets[0]!;
        expect(sheet.prepOptions?.map(o => o.name).sort()).toEqual(['A2 K', 'A2 T']);
        for (const option of sheet.prepOptions!) expect(sheet.rows[0]!.namedPrep?.[option.id]?.text).toBe(option.name === 'A2 T' ? 'Theory' : 'Kritik');
      }
      expect(String(peers[0]!.doc().firstChild!.attrs['data'])).toBe(String(peers[1]!.doc().firstChild!.attrs['data']));
    } finally { peers.forEach(p => p.destroy()); }
  });

  it('keeps both people’s concurrent typing in different cells', async () => {
    const [a, b] = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    await settle();
    // Both type before either sees the other (a real race).
    typeInto(cellEl(a!, 0, 0), 'Adv 1 econ');
    typeInto(cellEl(b!, 1, 1), 'No link');
    await syncAll([a!, b!]);
    await settle(6);
    await syncAll([a!, b!]);
    await settle(6);
    for (const p of [a!, b!]) {
      const sheet = flowOf(p).sheets[0]!;
      expect(cellAt(sheet, 0, 0).text).toBe('Adv 1 econ');
      expect(cellAt(sheet, 1, 1).text).toBe('No link');
    }
  });

  it('keeps a sheet reorder while a collaborator concurrently types', async () => {
    const peers = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    const [a,b] = peers;
    try {
      for (let i = 0; i < 60; i++) typeInto(cellEl(a!,0,0), 'G'.repeat(i+1));
      const tab = b!.view.dom.querySelectorAll<HTMLElement>('.pmd-flow-tab')[1]!;
      tab.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp',altKey:true,bubbles:true,cancelable:true}));
      await syncAll(peers); await settle(6); await syncAll(peers); await settle(6);
      for (const p of peers) {
        expect(flowOf(p).sheets.map(s => s.name)).toEqual(['Off 1','Gov case']);
        expect(flowOf(p).sheets.find(s => s.name === 'Gov case')!.rows[0]!.cells[0]!.text).toBe('G'.repeat(60));
      }
    } finally { peers.forEach(p => p.destroy()); }
  });

  it('does not replace or reset the cell someone is typing in when a partner edits', async () => {
    const [a, b] = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    await settle();
    const mine = cellEl(a!, 2, 0);
    mine.focus();
    typeInto(mine, 'half-typed');
    await syncAll([a!, b!]);
    await settle(6);
    typeInto(cellEl(b!, 5, 2), 'partner text');
    await syncAll([a!, b!]);
    await settle(6);
    // Same element, still focused, caret kept.
    expect(cellEl(a!, 2, 0)).toBe(mine);
    expect(document.activeElement).toBe(mine);
    expect(mine.value).toBe('half-typed');
    expect(mine.selectionStart).toBe('half-typed'.length);
    expect(cellEl(a!, 5, 2).value).toBe('partner text');
  });

  it('survives repeated races: typing, highlighting and prep in the same rows', async () => {
    const [a, b] = await createLoroPeers(seed(), 2, undefined, flowNodeViews);
    await settle();
    for (let round = 0; round < 6; round++) {
      typeInto(cellEl(a!, round, 0), `A${round} claim`);
      typeInto(cellEl(b!, round, 1), `B${round} answer`);
      if (round % 2) typeInto(cellEl(a!, round, 0), `A${round} claim extended`);
      await syncAll([a!, b!]);
      await settle(4);
    }
    await syncAll([a!, b!]);
    await settle(6);
    await syncAll([a!, b!]);
    await settle(6);
    for (const p of [a!, b!]) {
      const sheet = flowOf(p).sheets[0]!;
      for (let round = 0; round < 6; round++) {
        expect(cellAt(sheet, round, 0).text).toBe(round % 2 ? `A${round} claim extended` : `A${round} claim`);
        expect(cellAt(sheet, round, 1).text).toBe(`B${round} answer`);
      }
    }
    expect(String(a!.doc().firstChild!.attrs['data'])).toBe(String(b!.doc().firstChild!.attrs['data']));
  });
});
