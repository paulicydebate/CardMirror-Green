/** Docked collaboration UI. Transport, joins and recovery use existing owners. */
import { settings } from '../settings.js';
import { prepDoc, prepRound } from '../prep-runtime.js';
import { onCollabCopresenceChange } from './collab-hooks.js';
import { listSessionRecords, listRecentRooms, subscribeSessionRecords, type PersistedSessionRecord } from './collab-store.js';
import { buildRejoinCandidates, type RejoinCandidate } from './rejoin-picker.js';
import { inboxStore } from '../pairing/inbox-store.js';
import { parseRoomInvite } from '../pairing/room-invite.js';
import { normalizePairingCode, looksLikePairingCode } from '../pairing/pairing-ids.js';
import { isAnyOverlayOpen } from '../overlay-stack.js';
import type { CollaborationPanelSession } from './collab-ui.js';

type Tab = 'people' | 'docs' | 'invitations';
export interface CollaborationPanelAdapter {
  current(): { uid: string; title: string } | null;
  sessions(): CollaborationPanelSession[];
  invite(uid: string, code: string, name: string): Promise<boolean>;
  join(code: string, guestPass?: string | null): Promise<boolean>;
  resume(roomId: string): Promise<void>;
  focus(uid: string): void;
  end(uid: string): Promise<void>;
  disconnect(uid: string): Promise<boolean | null>;
  verifyRecovery(uid: string): Promise<boolean>;
  configured(): boolean;
  settings(): void;
  advanced(action: 'start' | 'join' | 'copy' | 'view' | 'send' | 'inbox' | 'recover'): void;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el;
}
function button(text: string, run: () => void, className = ''): HTMLButtonElement {
  const b = element('button', className, text); b.type = 'button'; b.onclick = run; return b;
}
function at(time: number): string { return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function text(el: HTMLElement, value: string): void { if (el.textContent !== value) el.textContent = value; }

export class CollaborationPanel {
  readonly root = element('aside', 'pmd-collaboration-panel');
  private tab: Tab = 'people';
  private visible = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: Array<() => void> = [];
  private generation = 0;
  private records: PersistedSessionRecord[] = [];
  private candidates: RejoinCandidate[] = [];
  private notice = element('div', 'pmd-collaboration-notice');
  private relay = element('div', 'pmd-collaboration-relay');
  private title = element('h3');
  private status = element('div', 'pmd-collaboration-status');
  private recovery = element('div', 'pmd-collaboration-recovery');
  private invitation = element('div', 'pmd-collaboration-invitation-status');
  private partners = element('div', 'pmd-collaboration-partners');
  private docs = element('div', 'pmd-collaboration-docs');
  private invitations = element('div', 'pmd-collaboration-invitations');
  private rule = element('select');
  private ruleHelp = element('div', 'pmd-collaboration-secondary');
  private primary: HTMLButtonElement;
  private end: HTMLButtonElement;
  private keep: HTMLButtonElement;
  private verify: HTMLButtonElement;
  private tabs = new Map<Tab, HTMLButtonElement>();
  private views = new Map<Tab, HTMLElement>();
  private listSignatures = new WeakMap<HTMLElement, string>();
  private pending = new Map<string, string>();

  constructor(private adapter: CollaborationPanelAdapter) {
    this.root.hidden = true; this.root.setAttribute('aria-label', 'Collaboration');
    const head = element('header'); head.append(element('h2', '', 'Collaboration'), button('Close', () => this.close()));
    const connection = element('div', 'pmd-collaboration-connection');
    connection.append(this.relay, button('Settings', () => adapter.settings()));
    const nav = element('div', 'pmd-collaboration-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Collaboration sections');
    const content = element('div', 'pmd-collaboration-content');
    for (const [name, label] of [['people', 'People'], ['docs', 'Shared docs'], ['invitations', 'Invitations']] as const) {
      const b = button(label, () => this.select(name)); b.setAttribute('role', 'tab');
      b.id = `pmd-collaboration-tab-${name}`; b.setAttribute('aria-controls', `pmd-collaboration-view-${name}`);
      b.onkeydown = e => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; e.preventDefault(); const names = [...this.tabs.keys()]; const next = names[(names.indexOf(name) + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length]!; this.select(next); this.tabs.get(next)?.focus(); };
      const view = element('section'); view.id = `pmd-collaboration-view-${name}`; view.setAttribute('role', 'tabpanel'); view.setAttribute('aria-labelledby', b.id);
      this.tabs.set(name, b); this.views.set(name, view); nav.append(b); content.append(view);
    }
    const people = this.views.get('people')!;
    this.primary = button('Co-edit with…', () => { void this.inviteDefault(); }, 'pmd-collaboration-primary');
    const addForm = element('form', 'pmd-collaboration-add'); addForm.hidden = true;
    const nameLabel = element('label', '', 'Name'); const name = element('input'); name.required = true; name.maxLength = 100; nameLabel.append(name);
    const codeLabel = element('label', '', 'CardMirror partner code'); const code = element('input'); code.required = true; code.autocomplete = 'off'; code.spellcheck = false; codeLabel.append(code);
    const save = element('button', '', 'Save partner'); save.type = 'submit';
    addForm.append(nameLabel, codeLabel, save, button('Cancel', () => { addForm.hidden = true; }));
    addForm.onsubmit = e => {
      e.preventDefault(); const normalized = normalizePairingCode(code.value);
      if (!name.value.trim() || !looksLikePairingCode(normalized)) { this.message('Enter a name and a CardMirror partner code beginning cmk1.'); return; }
      const all = settings.get('pairingPartners');
      if (all.some(p => p.code === normalized)) { this.message('That partner is already saved. Manage partners in Settings.'); return; }
      settings.set('pairingPartners', [...all, { name: name.value.trim(), code: normalized }]);
      if (!settings.get('pairingStarred')) settings.set('pairingStarred', { kind: 'partner', ref: normalized });
      addForm.reset(); addForm.hidden = true; this.message('Partner saved.');
    };
    people.append(element('div', 'pmd-collaboration-caption', 'CURRENT DOCUMENT'), this.title, this.status, this.recovery,
      this.partners, this.primary, this.invitation, button('Add a partner', () => { addForm.hidden = !addForm.hidden; if (!addForm.hidden) name.focus(); }), addForm);
    this.views.get('docs')!.append(this.docs);
    this.views.get('invitations')!.append(this.invitations);
    const ruleArea = element('div', 'pmd-collaboration-rule'); const ruleLabel = element('label', '', 'When Round starts');
    for (const [value, label] of [['isolation', 'Disconnect partners'], ['coflow', 'Keep flowing together']]) { const option = element('option', '', label); option.value = value!; this.rule.append(option); }
    ruleLabel.append(this.rule); ruleArea.append(ruleLabel, this.ruleHelp);
    this.rule.onchange = () => { if (this.currentSession() || prepRound()) { this.render(); return; } settings.set('prepRoundCoflow', this.rule.value === 'coflow'); };
    const actions = element('div', 'pmd-collaboration-session-actions');
    this.verify = button('Verify local recovery copy', () => { const uid = adapter.current()?.uid; if (uid) void this.run(async () => this.message(await adapter.verifyRecovery(uid) ? 'Current document verified in local recovery storage. This does not confirm delivery to partners.' : 'Could not verify a recovery copy. Export your document before closing.')); });
    this.end = button('End sharing', () => { const uid = adapter.current()?.uid; if (uid) void this.run(() => adapter.end(uid)); });
    this.keep = button('Disconnect and keep recovery copy', () => { const uid = adapter.current()?.uid; if (uid) void this.run(async () => { const kept = await adapter.disconnect(uid); if (kept === true) this.message('Disconnected. Resume this saved session from Shared docs.'); else if (kept === false) this.message('Could not preserve a recovery copy. The document remains connected; export it before closing.'); }); });
    actions.append(this.verify, this.end, this.keep);
    const advanced = element('details', 'pmd-collaboration-advanced'); advanced.append(element('summary', '', 'Codes, links & card transfers'));
    const advancedActions: Array<[string, Parameters<CollaborationPanelAdapter['advanced']>[0]]> = [
      ['Start session manually', 'start'], ['Join invitation / paste link', 'join'], ['Copy edit invitation link', 'copy'], ['Copy view-only invitation link', 'view'], ['Send cards / group invites', 'send'], ['Card inbox', 'inbox'], ['Recover previous version', 'recover'],
    ];
    for (const [label, action] of advancedActions) advanced.append(button(label, () => adapter.advanced(action)));
    this.notice.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite'); this.invitation.setAttribute('aria-live', 'polite');
    this.root.append(head, connection, nav, this.notice, content, ruleArea, actions, advanced);
    document.body.append(this.root);
    this.unsubscribe.push(settings.subscribe(() => this.render()), onCollabCopresenceChange(() => this.render()),
      subscribeSessionRecords(() => { if (this.visible) void this.reload(); }), inboxStore.subscribe(() => this.render()));
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape' && !isAnyOverlayOpen()) { e.stopPropagation(); this.close(); } });
  }
  show(tab: Tab = 'people'): void {
    this.visible = true; this.root.hidden = false; document.body.classList.add('pmd-collaboration-open');
    this.select(tab); void this.reload();
    if (this.timer === null) this.timer = setInterval(() => this.render(), 750);
    this.tabs.get(tab)?.focus(); window.dispatchEvent(new Event('resize'));
  }
  close(): void {
    this.visible = false; this.root.hidden = true; document.body.classList.remove('pmd-collaboration-open'); this.generation++;
    if (this.timer !== null) clearInterval(this.timer); this.timer = null; window.dispatchEvent(new Event('resize'));
    document.querySelector<HTMLButtonElement>('.pmd-coedit-with')?.focus();
  }
  destroy(): void { this.close(); for (const stop of this.unsubscribe) stop(); this.root.remove(); }
  private message(text: string): void { this.notice.textContent = text; }
  private currentSession(): CollaborationPanelSession | undefined { const uid = this.adapter.current()?.uid; return this.adapter.sessions().find(s => s.uid === uid); }
  private select(tab: Tab): void { this.tab = tab; this.render(); }
  private async run(work: () => Promise<unknown>): Promise<void> {
    if (this.busy) return; this.busy = true; this.render();
    try { await work(); } catch (error) { this.message(error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; if (this.visible) await this.reload(); this.render(); }
  }
  private async reload(): Promise<void> {
    const token = ++this.generation;
    try {
      const [records, recents] = await Promise.all([listSessionRecords(), listRecentRooms()]);
      if (!this.visible || token !== this.generation) return;
      this.records = records; this.candidates = buildRejoinCandidates(records, recents, room => this.adapter.sessions().some(s => s.roomId === room)); this.render();
    } catch (error) { if (token === this.generation) this.message(`Could not load saved sessions: ${String(error)}`); }
  }
  private defaultPartner() {
    const visible = settings.get('pairingPartners').filter(p => p.code && !p.hidden);
    const starred = settings.get('pairingStarred');
    return visible.find(p => starred?.kind === 'partner' && p.code === starred.ref) ?? visible[0];
  }
  private async inviteDefault(): Promise<void> {
    const partner = this.defaultPartner(), doc = this.adapter.current();
    if (!partner || !doc || prepRound()) return;
    await this.run(async () => {
      if (this.adapter.current()?.uid !== doc.uid) throw new Error('The active document changed. Choose the document again.');
      const sent = await this.adapter.invite(doc.uid, partner.code, partner.name);
      if (sent) { this.pending.set(doc.uid, partner.name || 'Partner'); this.message('Invitation sent. Your partner chooses Join in Invitations or Receive.'); }
      else this.message('Invitation was not sent. Check the relay connection and account in Settings.');
    });
  }
  private list(container: HTMLElement, signature: unknown, render: () => void): void {
    const key = JSON.stringify(signature); if (this.listSignatures.get(container) === key) return;
    const focused = [...container.querySelectorAll('button')].indexOf(document.activeElement as HTMLButtonElement);
    this.listSignatures.set(container, key); container.replaceChildren(); render();
    if (focused >= 0) container.querySelectorAll('button')[focused]?.focus();
  }
  private render(): void {
    if (!this.visible) return;
    const doc = this.adapter.current(), sessions = this.adapter.sessions(), session = sessions.find(s => s.uid === doc?.uid);
    const partner = this.defaultPartner();
    const invites = inboxStore.list().map(item => ({ item, invite: parseRoomInvite(item) })).filter(x => x.invite !== null);
    for (const [name, tab] of this.tabs) {
      tab.setAttribute('aria-selected', String(name === this.tab)); tab.tabIndex = name === this.tab ? 0 : -1;
      tab.textContent = name === 'people' ? 'People' : name === 'docs' ? 'Shared docs' : `Invitations${invites.length ? ` (${invites.length})` : ''}`;
      this.views.get(name)!.hidden = name !== this.tab;
    }
    this.relay.textContent = session ? session.connected ? 'Relay connected' : 'Reconnecting to relay' : !settings.get('pairingEnabled') ? 'Card sharing is off' : this.adapter.configured() ? 'Relay configured' : 'Connect your relay / account';
    this.title.textContent = doc?.title || 'Open a document to co-edit';
    let status = !session ? 'Not shared' : !session.connected ? 'Reconnecting — unsent changes remain on this device.' : session.queued ? `${session.queued} update${session.queued === 1 ? '' : 's'} waiting to send` : 'Connected · no changes waiting to send';
    if (session?.peers.length) status += ` · Editing now: ${session.peers.join(', ')}`;
    if (session?.watchers) status += ` · ${session.watchers} watching`;
    text(this.status, status);
    this.recovery.textContent = !session ? '' : session.isolationCopy ? 'Isolation copy: closed without saving when this shared session ends.' : session.recovery.failed ? 'Recovery storage unavailable. Export this document before closing.' : session.recovery.savedAt ? `Local recovery copy saved at ${at(session.recovery.savedAt)}` : 'Preparing a local recovery copy…';
    this.recovery.dataset['warning'] = String(!!session?.recovery.failed);
    this.primary.textContent = partner ? `${session ? 'Invite' : 'Co-edit with'} ${partner.name || 'partner'}` : 'Add a partner to co-edit';
    this.primary.disabled = this.busy || !partner || !doc || prepRound() || !settings.get('pairingEnabled') || !this.adapter.configured() || session?.role === 'spectator';
    text(this.invitation, doc && this.pending.has(doc.uid) ? `Invitation sent to ${this.pending.get(doc.uid)}. Only the people listed as editing have joined.` : 'Shares this whole document. Your partner accepts the invitation.');
    const starred = settings.get('pairingStarred');
    const partners = settings.get('pairingPartners').filter(p => p.code && !p.hidden);
    this.list(this.partners, [partners, starred], () => {
      for (const p of partners) {
        const row = element('div', 'pmd-collaboration-person'); const name = element('div'); name.append(element('strong', '', p.name || 'Partner'), element('div', 'pmd-collaboration-secondary', 'Saved partner'));
        const favorite = starred?.kind === 'partner' && starred.ref === p.code;
        const star = button(favorite ? 'Default' : 'Make default', () => { settings.set('pairingStarred', { kind: 'partner', ref: p.code }); });
        star.setAttribute('aria-label', favorite ? `${p.name} is your default partner` : `Make ${p.name} your default partner`); star.setAttribute('aria-pressed', String(favorite));
        row.append(name, star); this.partners.append(row);
      }
      if (!partners.length) this.partners.append(element('p', 'pmd-collaboration-secondary', 'Save your partner’s CardMirror code once. You can then invite them by name.'));
    });
    const rule = session?.roundMode ?? (settings.get('prepRoundCoflow') ? 'coflow' : 'isolation');
    this.rule.value = rule; this.rule.disabled = this.busy || !!session || prepRound();
    this.ruleHelp.textContent = session && !session.prep ? 'This is an ordinary document. Round Mode ends its co-editing. This preference applies to new shared prep documents.' : (rule === 'coflow' ? 'Co-Flowing: shared prep documents stay connected during Round.' : 'Isolation: partners disconnect and their shared copies close when Round starts.') + (session ? ' This session keeps the host’s chosen rule.' : ` Applies when you start sharing${doc && prepDoc(doc.uid) ? ' this prep document' : ' a prep document'}.`);
    this.verify.hidden = this.keep.hidden = !session || session.isolationCopy;
    this.end.hidden = !session; this.end.textContent = session?.role === 'host' ? 'End sharing for everyone' : session?.role === 'spectator' ? 'Stop watching' : 'Leave document';
    this.end.disabled = this.busy || (!!session && session.role !== 'spectator' && (!session.connected || session.queued > 0));
    this.verify.disabled = this.keep.disabled = this.busy;
    this.renderDocs(sessions); this.renderInvitations(invites);
  }
  private renderDocs(sessions: CollaborationPanelSession[]): void {
    this.list(this.docs, [sessions.map(s => [s.uid, s.title, s.role, s.connected, s.queued, s.peers]), this.candidates.map(c => [c.roomId, c.title, c.kind, Math.floor(c.at / 60000)])], () => {
      for (const s of sessions) {
        const row = element('div', 'pmd-collaboration-doc');
        const info = element('div'); info.append(element('strong', '', s.title), element('div', 'pmd-collaboration-secondary', `${s.role === 'host' ? 'You own' : s.role === 'spectator' ? 'Watching' : 'Joined'} · ${s.peers.length ? s.peers.join(', ') : 'No other editors reported'}`), element('div', 'pmd-collaboration-secondary', !s.connected ? 'Reconnecting' : s.queued ? 'Changes waiting to send' : 'No changes waiting to send'));
        row.append(info, button('Open', () => this.adapter.focus(s.uid))); this.docs.append(row);
      }
      for (const candidate of this.candidates) {
        if (sessions.some(s => s.roomId === candidate.roomId)) continue;
        const row = element('div', 'pmd-collaboration-doc'); const info = element('div');
        const record = this.records.find(r => r.roomId === candidate.roomId);
        info.append(element('strong', '', candidate.title || 'Shared document'), element('div', 'pmd-collaboration-secondary', record ? `Local session copy · saved ${at(record.updatedAt)}` : 'Previously joined · availability checked when opening'));
        const open = button(record ? 'Resume copy' : 'Rejoin', () => { void this.run(async () => {
          if (record) await this.adapter.resume(candidate.roomId);
          else await this.adapter.join(candidate.shareCode, candidate.guestPass);
        }); }); open.disabled = this.busy; row.append(info, open); this.docs.append(row);
      }
      if (!this.docs.childElementCount) this.docs.append(element('p', 'pmd-collaboration-secondary', 'Shared documents and saved sessions will appear here.'));
    });
  }
  private renderInvitations(invites: Array<{ item: ReturnType<typeof inboxStore.list>[number]; invite: ReturnType<typeof parseRoomInvite> }>): void {
    this.list(this.invitations, [invites.map(({ item }) => [item.id, item.label, item.senderName]), this.busy], () => {
      for (const { item, invite } of invites) {
        if (!invite) continue;
        const sender = settings.get('pairingPartners').find(p => p.code === item.senderCode)?.name || item.senderName || 'A partner';
        const watch = invite.shareCode.startsWith('cmview'); const row = element('div', 'pmd-collaboration-invite');
        row.append(element('strong', '', `${sender} invited you to ${watch ? 'watch' : 'co-edit'}`), element('h3', '', invite.title || 'Shared document'), element('p', 'pmd-collaboration-secondary', 'The host’s document and Prep/Round rules are checked when joining.'));
        const join = button(watch ? 'Watch document' : 'Join document', () => { void this.run(async () => { if (await this.adapter.join(invite.shareCode)) await inboxStore.remove(item.id); }); }, 'pmd-collaboration-primary');
        const decline = button('Decline', () => { void this.run(() => inboxStore.remove(item.id)); });
        join.disabled = decline.disabled = this.busy; row.append(join, decline); this.invitations.append(row);
      }
      if (!invites.length) this.invitations.append(element('p', 'pmd-collaboration-secondary', 'No pending invitations. Card transfers are still in Card inbox.'));
    });
  }
}
