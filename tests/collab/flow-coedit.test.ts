// @vitest-environment jsdom
// Two people co-editing one spreadsheet flow over the real Loro binding.
import { describe, expect, it } from 'vitest';
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
