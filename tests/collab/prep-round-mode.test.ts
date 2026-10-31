// @vitest-environment jsdom
/**
 * Round Mode options for shared prep docs, through the real collab UI seams:
 * - Isolation: Round (or the host ending the doc) closes the partner's copy
 *   without saving, and that copy can't be saved or journaled meanwhile.
 * - Co-Flowing: Round keeps co-editing of shared prep docs.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { collabPluginsFor, collabPluginSourceFor, tagCollabTransaction } from '../../src/editor/collab/collab-hooks.js';
import { settings } from '../../src/editor/settings.js';
import { CollabSession } from '../../src/editor/collab/collab-session.js';
import * as collabUi from '../../src/editor/collab/collab-ui.js';
import { RoomsClient } from '../../src/editor/collab/room-client.js';
import { prepIsolationCopyBlocked, prepRuntime } from '../../src/editor/prep-runtime.js';
import { startRoomsMock, type RoomsMock } from './_rooms-mock.js';
import { settle, sleep, simpleDoc } from './_loro-helpers.js';

let mock: RoomsMock;
let client: RoomsClient;

beforeAll(async () => {
  mock = await startRoomsMock();
  (window as unknown as { electronAPI?: unknown }).electronAPI = {};
  localStorage.setItem('pmd-collab', '1');
  settings.set('pairingRelayUrl', mock.url);
  settings.set('pairingRelayToken', mock.token);
  const chip = document.createElement('div');
  chip.id = 'collab-chip';
  chip.hidden = true;
  document.body.appendChild(chip);
  client = new RoomsClient({ baseUrl: () => mock.url, token: () => mock.token });
});
afterAll(async () => { await mock.close(); });

function setMode(mode: 'prep' | 'round', prepDocIds: string[]): void {
  prepRuntime.status = { session: { sessionId: 'test', mode, prepStartedAt: new Date().toISOString(), roundStartedAt: mode === 'round' ? new Date().toISOString() : null,
    endedAt: null, newDocIds: [...prepDocIds], prepDocIds: [...prepDocIds] }, transitioning: false, error: null };
}

/** The partner joins the host's shared prep doc through the UI flow. */
async function joinAsPartner(uid: string, shareCode: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view: EditorView = new EditorView(el, {
    state: EditorState.create({ doc: simpleDoc(''), plugins: collabPluginsFor(uid) }),
    dispatchTransaction(tx) { tagCollabTransaction(tx); view.updateState(view.state.apply(tx)); },
  });
  const discarded: string[] = [];
  const deps = {
    getView: () => view,
    getOwnerUid: () => uid,
    refreshPlugins: () => view.updateState(view.state.reconfigure({ plugins: collabPluginsFor(uid) })),
    newSessionDoc: () => true,
    discardDoc: vi.fn(async (u: string) => { discarded.push(u); }),
  };
  expect(await collabUi.joinSessionWithCode(deps, shareCode)).toBe(true);
  await settle();
  return { view, deps, discarded };
}

describe('Round Mode for shared prep docs', () => {
  it('Isolation: the partner copy cannot be saved, and Round closes it without saving', async () => {
    const uid = 'isolation-partner';
    setMode('prep', [uid]);
    const { session: host, shareCode } = await CollabSession.host({ pmDoc: simpleDoc('Adv 1: econ'), client, prep: true, roundMode: 'isolation' });
    expect(host.loroDoc.getMap('meta').get('cardmirrorGreenRoundMode')).toBe('isolation');
    const { view, deps, discarded } = await joinAsPartner(uid, shareCode);
    expect(collabUi.isIsolationGuestCopyUid(uid)).toBe(true);
    expect(prepIsolationCopyBlocked(uid)).toBe(true);
    setMode('round', [uid]);
    expect(await collabUi.disconnectForPrep('round')).toBe(true);
    expect(discarded).toEqual([uid]);
    expect(deps.discardDoc).toHaveBeenCalledTimes(1);
    expect(collabPluginSourceFor(uid)).toBeNull();
    expect(prepRuntime.isolationCopies.has(uid)).toBe(false);
    await host.stop();
    view.destroy();
  }, 20_000);

  it('Isolation: the host ending the shared doc closes the partner copy', async () => {
    const uid = 'isolation-partner-2';
    setMode('prep', [uid]);
    const { session: host, shareCode } = await CollabSession.host({ pmDoc: simpleDoc('Off 1: DA'), client, prep: true, roundMode: 'isolation' });
    const { view, discarded } = await joinAsPartner(uid, shareCode);
    await host.stop();
    await client.deleteRoom(host.roomId);
    for (let i = 0; i < 40 && !discarded.length; i++) await sleep(100);
    expect(discarded).toEqual([uid]);
    expect(collabPluginSourceFor(uid)).toBeNull();
    view.destroy();
  }, 20_000);

  it('Co-Flowing: Round keeps the shared prep doc connected; End still disconnects without closing it', async () => {
    const uid = 'coflow-partner';
    setMode('prep', [uid]);
    const { session: host, shareCode } = await CollabSession.host({ pmDoc: simpleDoc('MG answers'), client, prep: true, roundMode: 'coflow' });
    const { view, discarded } = await joinAsPartner(uid, shareCode);
    expect(collabUi.isIsolationGuestCopyUid(uid)).toBe(false);
    setMode('round', [uid]);
    expect(await collabUi.disconnectForPrep('round')).toBe(true);
    expect(collabPluginSourceFor(uid)).not.toBeNull();
    expect(collabUi.hasLiveCoflowSession()).toBe(true);
    expect(await collabUi.disconnectForPrep('end')).toBe(true);
    expect(collabPluginSourceFor(uid)).toBeNull();
    expect(discarded).toEqual([]);
    await host.stop();
    view.destroy();
  }, 20_000);
});
