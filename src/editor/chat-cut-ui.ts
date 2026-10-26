/**
 * "Cut Card with Chat AI" dialog — the copy-paste cutting flow.
 *
 * 1. Copy prompt: the focused card's text + cutting rules + reply format go
 *    to the clipboard, for Grok or any other chat AI. No API key involved.
 * 2. Paste reply: the reply is parsed and every quote is checked against the
 *    card's text as the user types; the report says what was found and what
 *    was rejected.
 * 3. Apply: one transaction (Ctrl+Z undoes it), against the card as it is
 *    NOW — the card is re-found by its tag id and re-matched, so edits made
 *    while the user was in the chat app are respected.
 *
 * The dialog can stay open while the user switches apps.
 */

import type { EditorView } from 'prosemirror-view';
import { buildCutPrompt, matchCutReply, parseCutReply, type ChatCutReply, type MatchReport } from '../cutting/chat-cut.js';
import { applyChatCut, chatCutCardAtCursor, chatCutCardById } from './chat-cut-apply.js';
import { writeClipboardText } from './clipboard-write.js';
import { showToast } from './toast.js';
import { setIcon } from './icons';
import { isBackdropClick } from './backdrop-click.js';
import { isTopOverlay, popOverlay, pushOverlay } from './overlay-stack.js';

const TARGET_KEY = 'cmg-chat-cut-target-words';
const LAYER_NAME = { u: 'underline', em: 'emphasis', hl: 'highlight' } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', 'pmd-bulk-btn' + (primary ? ' pmd-bulk-btn-primary' : ''), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function loadTarget(): string {
  try { return localStorage.getItem(TARGET_KEY) ?? ''; } catch { return ''; }
}
function saveTarget(value: string): void {
  try { localStorage.setItem(TARGET_KEY, value); } catch { /* storage unavailable */ }
}

const shorten = (s: string, n = 90): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Plain-language summary lines for a match report. */
export function describeReport(report: MatchReport): { summary: string; problems: string[]; notes: string[] } {
  const c = report.counts;
  const summary = `Found ${c.u} underline, ${c.em} emphasis and ${c.hl} highlight quote${c.u + c.em + c.hl === 1 ? '' : 's'} — about ${report.highlightedWords} highlighted word${report.highlightedWords === 1 ? '' : 's'}.`;
  const problems = report.rejected.map((r) =>
    r.reason === 'too-short'
      ? `Skipped ${LAYER_NAME[r.layer]} quote with no words: “${shorten(r.quote)}”`
      : `Not in the card, skipped (${LAYER_NAME[r.layer]}): “${shorten(r.quote)}”`);
  const notes: string[] = [];
  const share = report.underlinedWords > 0 ? report.highlightedWords / report.underlinedWords : 0;
  if (report.highlightedWords >= 15 && share > 0.5) {
    problems.push(`Heavy highlighting: ${Math.round(share * 100)}% of the underlined words are highlighted. Consider asking the AI to highlight fewer, shorter word runs.`);
  }
  if (report.longHighlights > 0) {
    problems.push(`${report.longHighlights} highlight quote${report.longHighlights === 1 ? ' is' : 's are'} longer than 8 words (block highlighting).`);
  }
  if (report.autoUnderlined) notes.push(`${report.autoUnderlined} highlighted passage${report.autoUnderlined === 1 ? ' was' : 's were'} not underlined; they will be underlined too.`);
  if (report.outOfOrder.length) notes.push(`${report.outOfOrder.length} quote${report.outOfOrder.length === 1 ? ' was' : 's were'} out of reading order; the first match was used.`);
  if (report.caseInsensitive.length) notes.push(`${report.caseInsensitive.length} quote${report.caseInsensitive.length === 1 ? '' : 's'} matched only when ignoring capital letters.`);
  return { summary, problems, notes };
}

class ChatCutDialog {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly token = pushOverlay();
  private settled = false;
  private parsed: ChatCutReply | null = null;
  private report: MatchReport | null = null;

  private purpose!: HTMLTextAreaElement;
  private target!: HTMLInputElement;
  private copyStatus!: HTMLDivElement;
  private promptBox!: HTMLTextAreaElement;
  private replyBox!: HTMLTextAreaElement;
  private reportEl!: HTMLDivElement;
  private replaceExisting!: HTMLInputElement;
  private useTag!: HTMLInputElement;
  private useTagLabel!: HTMLSpanElement;
  private tagRow!: HTMLLabelElement;
  private applyBtn!: HTMLButtonElement;

  constructor(private readonly view: EditorView, private readonly tagId: string, private readonly tagText: string) {
    this.overlay = el('div', 'pmd-bulk-overlay');
    this.dialog = el('div', 'pmd-bulk-dialog pmd-ccut-dialog');
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-label', 'Cut card with chat AI');
    this.overlay.appendChild(this.dialog);
    this.overlay.addEventListener('click', (e) => {
      if (isBackdropClick(e, this.overlay)) this.close();
    });
    document.addEventListener('keydown', this.onKey, true);
    this.render();
    document.body.appendChild(this.overlay);
    this.purpose.focus();
  }

  isOpen(): boolean {
    return !this.settled;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isTopOverlay(this.token)) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  private close(): void {
    if (this.settled) return;
    this.settled = true;
    document.removeEventListener('keydown', this.onKey, true);
    popOverlay(this.token);
    this.overlay.remove();
  }

  private render(): void {
    const header = el('header', 'pmd-bulk-header');
    header.appendChild(el('h2', undefined, 'Cut card with chat AI'));
    const close = el('button', 'pmd-bulk-close');
    close.type = 'button';
    setIcon(close, 'close');
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    header.appendChild(close);
    this.dialog.appendChild(header);

    const body = el('div', 'pmd-bulk-body pmd-ccut-body');
    body.appendChild(el('p', 'pmd-bulk-blurb',
      `Card: ${this.tagText.trim() ? shorten(this.tagText.trim(), 120) : '(no tag yet)'}. ` +
      'Copy the prompt into Grok or any chat AI, then paste its reply below. Every quote is checked against this card before anything is applied.'));

    // Step 1 — prompt.
    body.appendChild(el('div', 'pmd-bulk-field-label', '1. Copy the prompt'));
    this.purpose = el('textarea', 'pmd-ccut-input');
    this.purpose.rows = 2;
    this.purpose.placeholder = 'What should this card prove? (optional)';
    this.purpose.value = this.tagText.trim();
    this.purpose.setAttribute('aria-label', 'What should this card prove');
    this.target = el('input', 'pmd-ccut-input pmd-ccut-target');
    this.target.type = 'number';
    this.target.min = '0';
    this.target.step = '5';
    this.target.placeholder = 'auto';
    this.target.value = loadTarget();
    this.target.setAttribute('aria-label', 'Highlighted words to aim for');
    const targetRow = el('label', 'pmd-ccut-row');
    targetRow.append(el('span', undefined, 'Highlight about'), this.target, el('span', undefined, 'words (blank = automatic)'));
    const copyRow = el('div', 'pmd-ccut-row');
    copyRow.appendChild(btn('Copy prompt', () => void this.copyPrompt(), true));
    this.copyStatus = el('div', 'pmd-bulk-status');
    const details = el('details', 'pmd-ccut-details');
    details.appendChild(el('summary', undefined, 'Show prompt'));
    this.promptBox = el('textarea', 'pmd-ccut-input pmd-ccut-mono');
    this.promptBox.readOnly = true;
    this.promptBox.rows = 8;
    this.promptBox.setAttribute('aria-label', 'Prompt');
    details.appendChild(this.promptBox);
    details.addEventListener('toggle', () => { if (details.open) this.promptBox.value = this.buildPrompt() ?? ''; });
    body.append(this.purpose, targetRow, copyRow, this.copyStatus, details);

    // Step 2 — reply.
    body.appendChild(el('div', 'pmd-bulk-field-label', '2. Paste the AI’s reply'));
    this.replyBox = el('textarea', 'pmd-ccut-input pmd-ccut-mono');
    this.replyBox.rows = 7;
    this.replyBox.placeholder = 'Paste the whole reply, including the ```json block';
    this.replyBox.setAttribute('aria-label', 'AI reply');
    this.replyBox.addEventListener('input', () => this.check());
    this.reportEl = el('div', 'pmd-ccut-report');
    this.reportEl.setAttribute('role', 'status');
    body.append(this.replyBox, this.reportEl);

    // Step 3 — apply.
    const replaceRow = el('label', 'pmd-bulk-radio');
    this.replaceExisting = el('input');
    this.replaceExisting.type = 'checkbox';
    this.replaceExisting.checked = true;
    replaceRow.append(this.replaceExisting, el('span', undefined, 'Replace the card’s existing underlining, emphasis and highlighting'));
    this.tagRow = el('label', 'pmd-bulk-radio');
    this.useTag = el('input');
    this.useTag.type = 'checkbox';
    this.useTag.checked = this.tagText.trim() === '';
    this.useTagLabel = el('span');
    this.tagRow.append(this.useTag, this.useTagLabel);
    this.tagRow.hidden = true;
    this.applyBtn = btn('Apply to card', () => this.apply(), true);
    this.applyBtn.disabled = true;
    const actions = el('div', 'pmd-bulk-actions');
    actions.appendChild(this.applyBtn);
    body.append(el('div', 'pmd-bulk-field-label', '3. Apply'), replaceRow, this.tagRow, actions);

    this.dialog.appendChild(body);
  }

  private buildPrompt(): string | null {
    const card = chatCutCardById(this.view, this.tagId);
    if (!card) return null;
    const words = Number(this.target.value);
    return buildCutPrompt({
      tag: card.tag,
      cite: card.cite,
      paragraphs: card.paragraphs,
      purpose: this.purpose.value,
      targetWords: Number.isFinite(words) && words > 0 ? words : null,
    });
  }

  private async copyPrompt(): Promise<void> {
    saveTarget(this.target.value);
    const prompt = this.buildPrompt();
    if (!prompt) {
      this.copyStatus.textContent = 'This card is no longer in the document.';
      return;
    }
    this.promptBox.value = prompt;
    const ok = await writeClipboardText(prompt);
    if (this.settled) return;
    this.copyStatus.textContent = ok
      ? 'Copied. Paste it into Grok (or any chat AI), then copy its whole reply and paste it below.'
      : 'Could not copy. Open “Show prompt”, select all and copy it yourself.';
  }

  /** Parse + match the pasted reply against the card as it is now. */
  private check(): void {
    this.parsed = null;
    this.report = null;
    this.applyBtn.disabled = true;
    this.tagRow.hidden = true;
    this.reportEl.replaceChildren();
    this.reportEl.classList.remove('pmd-ccut-error');
    const text = this.replyBox.value;
    if (!text.trim()) return;
    const parsed = parseCutReply(text);
    if (!parsed.ok) {
      this.reportEl.textContent = parsed.error;
      this.reportEl.classList.add('pmd-ccut-error');
      return;
    }
    const card = chatCutCardById(this.view, this.tagId);
    if (!card) {
      this.reportEl.textContent = 'This card is no longer in the document.';
      this.reportEl.classList.add('pmd-ccut-error');
      return;
    }
    const report = matchCutReply(card.paragraphs, parsed.reply);
    this.parsed = parsed.reply;
    this.report = report;
    const { summary, problems, notes } = describeReport(report);
    this.reportEl.appendChild(el('div', 'pmd-ccut-summary', summary));
    if (problems.length) {
      const list = el('ul', 'pmd-ccut-problems');
      for (const p of problems) list.appendChild(el('li', undefined, p));
      this.reportEl.appendChild(list);
    }
    for (const n of notes) this.reportEl.appendChild(el('div', 'pmd-ccut-note', n));
    if (parsed.reply.tag) {
      this.useTagLabel.textContent = `Use the AI’s tag: “${shorten(parsed.reply.tag, 160)}”`;
      this.tagRow.hidden = false;
    }
    this.applyBtn.disabled = report.spans.length === 0 && !parsed.reply.tag;
  }

  private apply(): void {
    // Re-check against the current card text right before applying.
    this.check();
    if (!this.parsed || !this.report) return;
    const ok = applyChatCut(this.view, this.tagId, this.report, {
      replaceExisting: this.replaceExisting.checked,
      newTag: this.useTag.checked && !this.tagRow.hidden ? this.parsed.tag : null,
    });
    if (!ok) {
      this.reportEl.textContent = 'This card is no longer in the document.';
      this.reportEl.classList.add('pmd-ccut-error');
      return;
    }
    const skipped = this.report.rejected.length;
    showToast(`Cut applied${skipped ? ` (${skipped} quote${skipped === 1 ? '' : 's'} skipped)` : ''}. Undo with Ctrl+Z / Cmd+Z.`);
    this.close();
    this.view.focus();
  }
}

let current: ChatCutDialog | null = null;

/** Open the copy-paste cutting dialog for the card at the cursor. */
export function openChatCut(view: EditorView): void {
  if (current?.isOpen()) return;
  const card = chatCutCardAtCursor(view);
  if (!card) {
    showToast('Put the cursor in a card that has body text, then try again.');
    return;
  }
  current = new ChatCutDialog(view, card.tagId, card.tag);
}
