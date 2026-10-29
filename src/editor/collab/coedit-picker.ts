import { promptForChoice } from '../text-prompt.js';
import { showToast } from '../toast.js';
import type { PairingPartner } from '../settings.js';
export interface CoeditPickerOptions {
  documentUid: string;
  documentTitle: string;
  currentUid(): string;
  partners: PairingPartner[];
  connected: boolean;
  invite(target: { codes: string[]; label: string }): Promise<void>;
  configure(): void;
  join(): void;
}
/** Picker first: choosing a person explicitly authorizes sharing this document.
 * Codes travel over the existing encrypted mailbox, never a public directory. */
export async function openCoeditPicker(options: CoeditPickerOptions): Promise<void> {
  const partners = options.partners.filter(p => p.code && !p.hidden);
  const choices = options.connected ? partners.map((p, i) => ({ value: `person:${i}`, label: `Co-edit with ${p.name || '…' + p.code.slice(-6)}`, primary: true })) : [];
  const selected = await promptForChoice({
    message: `Co-edit “${options.documentTitle || 'Untitled document'}”`,
    detail: options.connected
      ? 'Choose a saved partner. CardMirror starts or reuses this document’s live session and sends the invitation for you. Your partner chooses Join in Receive. No session code needs to be copied.\n\nSend / Receive still handles one-time card transfers; co-editing shares live changes to this whole document.' + (!partners.length ? '\n\nAdd your partner’s CardMirror code once in Manage partners / relay.' : '')
      : 'Connect your relay/account and turn on card sharing in Collaboration settings first. Invitations use the same connection as Send / Receive. Your saved partners stay available here afterward.',
    choices: [...choices, { value: 'settings', label: 'Manage partners / relay…' }, { value: 'join', label: 'Join an invitation / paste a link…' }],
  });
  if (selected === 'settings') { options.configure(); return; }
  if (selected === 'join') { options.join(); return; }
  if (!selected?.startsWith('person:')) return;
  const partner = partners[Number(selected.slice(7))];
  if (!partner) return;
  if (options.currentUid() !== options.documentUid) { showToast('The active document changed. Open Co-edit with again for the document you want to share.'); return; }
  await options.invite({ codes: [partner.code], label: partner.name || 'Partner' });
}
