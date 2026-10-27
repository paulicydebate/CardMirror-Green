// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UndoManager } from 'loro-crdt';
import { LoroUndoPlugin, undo, redo, loroSyncPluginKey, loroUndoPluginKey } from 'loro-prosemirror';
import { schema } from '../../src/schema/index.js';
import { flowNodeViews } from '../../src/editor/flow-nodeview.js';
import { prepDocumentGuard, PREP_LOCAL_HISTORY_META, PREP_FLOW_RECONCILE_ORIGIN, type PrepGuardEvent } from '../../src/editor/prep-document-guard.js';
import { markSyncOrigin } from '../../src/editor/sync-origin.js';
import { newWorkbook, parseFlow, serializeFlow } from '../../src/flow/flow-model.js';
import { createLoroPeers, settle, syncAll, type LoroPeer } from './_loro-helpers.js';

let peers: LoroPeer[] = [];
afterEach(() => { for (const peer of peers) peer.destroy(); peers = []; vi.restoreAllMocks(); });
async function setup() {
  const audits = [[], []] as PrepGuardEvent[][];
  let index = 0;
  let armed = false;
  const doc = schema.nodes.doc!.create(null, [schema.nodes.flow_workbook!.create({data: serializeFlow(newWorkbook('npda'))}), schema.nodes.paragraph!.create()]);
  peers = await createLoroPeers(doc, 2, ldoc => {
    const log = audits[index++]!;
    return [prepDocumentGuard('prep', () => ({isPrepDocument: () => armed, loggingFailed: () => false, audit: (_uid, event) => log.push(event), notify: () => {}})), LoroUndoPlugin({doc: ldoc as Parameters<typeof LoroUndoPlugin>[0]['doc'], undoManager: new UndoManager(ldoc, {excludeOriginPrefixes: [PREP_FLOW_RECONCILE_ORIGIN]}) as Parameters<typeof LoroUndoPlugin>[0]['undoManager']})];
  }, flowNodeViews);
  for (const peer of peers) peer.view.setProps({dispatchTransaction(tr) {
    if (loroUndoPluginKey.getState(peer.view.state)?.isUndoing.current) tr.setMeta(PREP_LOCAL_HISTORY_META, true);
    if (tr.getMeta(loroSyncPluginKey) !== undefined || tr.getMeta(loroUndoPluginKey) !== undefined) markSyncOrigin(tr);
    peer.view.updateState(peer.view.state.apply(tr));
  }});
  // The initial seed arrived before the production-like transaction tagger.
  await settle();
  armed = true;
  for (const log of audits) log.length = 0;
  const tabs = peers[1]!.view.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-tab');
  tabs[1]!.click();
  return audits;
}
function type(peer: LoroPeer, text: string) {
  for (const char of text) {
    const area = peer.view.dom.querySelector<HTMLTextAreaElement>('.pmd-flow-cell[data-row="0"][data-col="0"]')!;
    area.value += char;
    area.dispatchEvent(new Event('input'));
  }
}
function text(peer: LoroPeer, sheet: number) { return parseFlow(String(peer.doc().firstChild!.attrs['data'])).sheets[sheet]!.rows[0]!.cells[0]!.text; }
async function converge() { await syncAll(peers); await settle(8); await syncAll(peers); await settle(8); }

describe('Prep flow collaborators on different sheets', () => {
  it('syncs and audits partner typing while the host stays on Gov case', async () => {
    const audits = await setup();
    type(peers[1]!, 'Off case partner');
    await converge();
    expect(text(peers[0]!, 1)).toBe('Off case partner');
    expect(audits[0]!.some(e => e.kind === 'remote-change' && e.inserted?.some(t => t.includes('Off case partner')))).toBe(true);
  });
  it.each([10, 60])('keeps concurrent %i-character typing on Gov case and Off 1', async size => {
    await setup();
    type(peers[0]!, 'G'.repeat(size));
    type(peers[1]!, 'O'.repeat(size));
    await converge();
    for (const peer of peers) {
      expect(text(peer, 0)).toBe('G'.repeat(size));
      expect(text(peer, 1)).toBe('O'.repeat(size));
    }
  });
  it('preserves pending edits after a delayed partner update and audits both sheets', async () => {
    const audits = await setup();
    type(peers[0]!, 'Gov claim '.repeat(8));
    type(peers[1]!, 'Off answer '.repeat(8));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    await converge();
    for (const peer of peers) {
      expect(text(peer, 0)).toBe('Gov claim '.repeat(8));
      expect(text(peer, 1)).toBe('Off answer '.repeat(8));
    }
    for (const audit of audits) {
      expect(audit.some(e => e.kind === 'blocked')).toBe(false);
      expect(audit.some(e => e.kind === 'remote-change' && !e.reconciliation && e.inserted?.length)).toBe(true);
      expect(audit.filter(e => e.kind === 'change').reduce((n, e) => n + (e.inserted?.join('').length ?? 0), 0)).toBeGreaterThan(40);
    }
    expect(audits.flat().some(e => e.reconciliation)).toBe(true);
  });
  it('survives repeated long bursts on different tabs after prior synchronization', async () => {
    await setup();
    for (let round = 0; round < 4; round++) {
      type(peers[0]!, 'G'.repeat(55));
      type(peers[1]!, 'O'.repeat(55));
      await converge();
      for (const peer of peers) {
        expect(text(peer, 0)).toBe('G'.repeat((round + 1) * 55));
        expect(text(peer, 1)).toBe('O'.repeat((round + 1) * 55));
      }
    }
  });
  it('undoes and redoes local text without erasing the partner sheet', async () => {
    await setup();
    type(peers[0]!, 'Gov text');
    await converge();
    type(peers[1]!, 'Off text');
    await converge();
    const host = peers[0]!;
    expect(undo(host.view.state, host.view.dispatch.bind(host.view), host.view)).toBe(true);
    await settle(8);
    await converge();
    for (const peer of peers) {
      expect(text(peer, 0)).toBe('');
      expect(text(peer, 1)).toBe('Off text');
    }
    expect(redo(host.view.state, host.view.dispatch.bind(host.view), host.view)).toBe(true);
    await settle(8);
    await converge();
    for (const peer of peers) {
      expect(text(peer, 0)).toBe('Gov text');
      expect(text(peer, 1)).toBe('Off text');
    }
  });
  it('does not resurrect text that a partner deliberately clears after synchronization', async () => {
    await setup();
    type(peers[0]!, 'Gov original');
    await converge();
    // The guest has received and acknowledged the host cell before deleting it.
    peers[1]!.view.dom.querySelectorAll<HTMLButtonElement>('.pmd-flow-tab')[0]!.click();
    const area = peers[1]!.view.dom.querySelector<HTMLTextAreaElement>('.pmd-flow-cell[data-row="0"][data-col="0"]')!;
    area.value = '';
    area.dispatchEvent(new Event('input'));
    await converge();
    for (const peer of peers) expect(text(peer, 0)).toBe('');
  });
});
