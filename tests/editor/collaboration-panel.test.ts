// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollaborationPanel, type CollaborationPanelAdapter } from '../../src/editor/collab/collaboration-panel.js';
import type { CollaborationPanelSession } from '../../src/editor/collab/collab-ui.js';
import { settings } from '../../src/editor/settings.js';
import { prepRuntime } from '../../src/editor/prep-runtime.js';
import { inboxStore, type InboxItem } from '../../src/editor/pairing/inbox-store.js';
import type { PersistedSessionRecord } from '../../src/editor/collab/collab-store.js';
const fixtures = vi.hoisted(() => ({ records: [] as PersistedSessionRecord[], items: [] as InboxItem[] }));
vi.mock('../../src/editor/collab/collab-store.js', () => ({
  listSessionRecords: async () => fixtures.records, listRecentRooms: async () => [], subscribeSessionRecords: () => () => {},
}));
vi.mock('../../src/editor/pairing/inbox-store.js', () => ({ inboxStore: {
  list: () => fixtures.items, subscribe: () => () => {}, remove: vi.fn(async (id: string) => { fixtures.items = fixtures.items.filter(i => i.id !== id); }),
} }));
const codeA='cmk1.synthetic-alex',codeB='cmk1.synthetic-jordan';
let panel: CollaborationPanel | null = null;
function fixture() {
  let sessions: CollaborationPanelSession[] = [];
  const adapter: CollaborationPanelAdapter = {
    current: () => ({ uid: 'doc1', title: 'Gov case.cmir' }), sessions: () => sessions,
    invite: vi.fn(async () => true), join: vi.fn(async () => false), resume: vi.fn(async () => {}), focus: vi.fn(),
    end: vi.fn(async () => {}), disconnect: vi.fn(async () => false), verifyRecovery: vi.fn(async () => true),
    configured: () => true, settings: vi.fn(), advanced: vi.fn(),
  };
  panel = new CollaborationPanel(adapter); panel.show();
  return { adapter, root: panel.root, session(value: Partial<CollaborationPanelSession> = {}) {
    sessions = [{ uid:'doc1',roomId:'room1',title:'Gov case.cmir',role:'host',connected:true,queued:0,peers:[],watchers:0,
      prep:true,roundMode:'isolation',isolationCopy:false,recovery:{savedAt:Date.now(),failed:false},...value }];
    settings.set('pairingDisplayName','Updated');
  } };
}
function click(root: HTMLElement, name: string) {
  const b = [...root.querySelectorAll<HTMLButtonElement>('button')].find(e => e.textContent === name);
  if (!b) throw new Error(`Missing button ${name}`); b.click(); return b;
}
beforeEach(() => {
  fixtures.records=[];fixtures.items=[];vi.clearAllMocks();
  settings.set('pairingPartners',[{name:'Alex',code:codeA},{name:'Jordan',code:codeB},{name:'Hidden',code:'cmk1.hidden',hidden:true}]);
  settings.set('pairingEnabled',true); settings.set('pairingStarred',{kind:'partner',ref:codeA});
});
afterEach(() => { panel?.destroy();panel=null;document.body.replaceChildren();prepRuntime.status={session:null,error:null,transitioning:false};settings.set('pairingDisplayName',''); });
describe('docked collaboration panel', () => {
  it('remembers a default partner and targets the current document, without exposing hidden contacts', async () => {
    const {root,adapter}=fixture();
    expect(root.textContent).not.toContain('Hidden');
    root.querySelector<HTMLButtonElement>('[aria-label="Make Jordan your default partner"]')!.click();
    expect(settings.get('pairingStarred')).toEqual({kind:'partner',ref:codeB});
    click(root,'Co-edit with Jordan');
    await vi.waitFor(()=>expect(adapter.invite).toHaveBeenCalledWith('doc1',codeB,'Jordan'));
    await vi.waitFor(()=>expect(root.textContent).toContain('Invitation sent to Jordan'));
    expect(root.textContent).not.toContain('Jordan joined');
    panel!.close();panel!.show();expect(root.textContent).toContain('Co-edit with Jordan');
  });
  it('does not claim delivery when invitation transport fails', async () => {
    const f=fixture();vi.mocked(f.adapter.invite).mockResolvedValue(false);click(f.root,'Co-edit with Alex');
    await vi.waitFor(()=>expect(f.root.textContent).toContain('Invitation was not sent'));
    expect(f.root.textContent).not.toContain('Invitation sent to Alex');
  });
  it('shows actual peers and distinguishes queued transport, recovery failures and host-chosen Round rules', () => {
    const f=fixture();f.session({connected:false,queued:4,peers:['Maya'],roundMode:'coflow',recovery:{savedAt:null,failed:true}});
    expect(f.root.textContent).toContain('Reconnecting');expect(f.root.textContent).toContain('Maya');
    expect(f.root.textContent).toContain('Recovery storage unavailable');
    expect(f.root.querySelector('select')!.value).toBe('coflow');expect(f.root.querySelector('select')!.disabled).toBe(true);
    expect([...f.root.querySelectorAll('button')].find(b=>b.textContent==='End sharing for everyone')!.disabled).toBe(true);
    expect([...f.root.querySelectorAll('button')].find(b=>b.textContent==='Disconnect and keep recovery copy')!.disabled).toBe(false);
  });
  it('preserves input and caret-bearing elements across connection updates; declines recovery copying for Isolation guests', () => {
    const f=fixture();click(f.root,'Add a partner');const input=f.root.querySelector('form input') as HTMLInputElement;
    input.value='Typing a name';input.focus();input.setSelectionRange(3,3);
    f.session({role:'participant',isolationCopy:true});
    expect(f.root.querySelector('form input')).toBe(input);expect(input.value).toBe('Typing a name');expect(input.selectionStart).toBe(3);
    expect([...f.root.querySelectorAll('button')].find(b=>b.textContent==='Disconnect and keep recovery copy')!.hidden).toBe(true);
  });
  it('resumes saved sessions without displaying credentials or replacing the document directly', async () => {
    fixtures.records=[{roomId:'saved-room',shareCode:'SECRET-SHARE-CREDENTIAL',role:'participant',lastSeq:0,sentVersion:new Uint8Array(),snapshot:new Uint8Array(),increments:[],persistedVersion:new Uint8Array(),docTitle:'Saved flow',updatedAt:Date.now()}];
    const f=fixture();await vi.waitFor(()=>expect(f.root.textContent).toContain('Saved flow'));
    click(f.root,'Shared docs');click(f.root,'Resume copy');
    await vi.waitFor(()=>expect(f.adapter.resume).toHaveBeenCalledWith('saved-room'));
    expect(f.root.outerHTML).not.toContain('SECRET-SHARE-CREDENTIAL');
  });
  it('keeps an invitation after a failed/canceled join and consumes only an accepted invitation', async () => {
    fixtures.items=[{id:'invite1',label:'Gov',type:'room-invite',sliceJson:{shareCode:'cmshare3.SYNTHETIC',title:'Shared case'},senderName:'Maya',senderCode:'cmk1.maya',receivedAt:Date.now(),read:false}];
    const f=fixture();click(f.root,'Invitations (1)');click(f.root,'Join document');
    await vi.waitFor(()=>expect(f.adapter.join).toHaveBeenCalledWith('cmshare3.SYNTHETIC'));
    await vi.waitFor(()=>expect(f.root.querySelector('.pmd-collaboration-invite button')!.hasAttribute('disabled')).toBe(false));
    expect(inboxStore.remove).not.toHaveBeenCalled();
    vi.mocked(f.adapter.join).mockResolvedValue(true);click(f.root,'Join document');
    await vi.waitFor(()=>expect(inboxStore.remove).toHaveBeenCalledWith('invite1'));
  });
  it('does not claim a recovery copy was kept if verification fails', async () => {
    const f=fixture();f.session({connected:false});click(f.root,'Disconnect and keep recovery copy');
    await vi.waitFor(()=>expect(f.root.textContent).toContain('Could not preserve a recovery copy'));
    expect(f.root.textContent).not.toContain('Disconnected. Resume');
  });
});
