/**
 * OpenCaselist panel — sign in, browse caselist → school → team, and open a
 * team's disclosed open-source file in the editor.
 *
 * Desktop only. All network work happens in the main process
 * (apps/desktop/src/opencaselist-ipc.ts), which keeps the session token; this
 * panel only ever sees lists and file bytes. The password field is cleared as
 * soon as it is read and the password is never stored.
 *
 * Opened files arrive as new, unsaved documents (no file on disk yet), so Save
 * asks where to put them.
 */

import { getElectronHost } from './host/index.js';
import { setIcon } from './icons';
import { isBackdropClick } from './backdrop-click.js';
import { isTopOverlay, popOverlay, pushOverlay } from './overlay-stack.js';

type Result<T> = { ok: true; value: T } | { ok: false; error: string; signedOut: boolean };
interface CaselistItem { name: string; label: string; event: string | null; level: string | null; year: number | null }
interface NamedItem { name: string; label: string }
interface RoundItem {
  roundId: number;
  tournament: string;
  side: string;
  round: string;
  opponent: string;
  judge: string;
  opensource: string | null;
  filename: string | null;
  openable: boolean;
}
interface DownloadedFile { filename: string; bytes: Uint8Array; sourceUrl: string }

export interface OpenCaselistPanelOptions {
  /** Open downloaded bytes the way File → Open would (new window / slot
   *  picker / in place), as an unsaved document. */
  openFile(file: { name: string; bytes: Uint8Array }): Promise<void>;
}

const LAST_CASELIST_KEY = 'cmg-opencaselist-last-caselist';

function rememberCaselist(name: string): void {
  try { localStorage.setItem(LAST_CASELIST_KEY, name); } catch { /* storage unavailable */ }
}
function lastCaselist(): string | null {
  try { return localStorage.getItem(LAST_CASELIST_KEY); } catch { return null; }
}

/** Human label for a disclosed round's side code. */
export function sideLabel(side: string): string {
  const s = side.trim().toUpperCase();
  if (s === 'A') return 'Aff';
  if (s === 'N') return 'Neg';
  return side;
}

/** Case-insensitive filter over a list's labels and names. */
export function filterItems<T extends NamedItem>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(i => i.label.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
}

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

function field(label: string, control: HTMLElement): HTMLDivElement {
  const wrap = el('div', 'pmd-bulk-field pmd-ocl-field');
  const lab = el('label', 'pmd-bulk-field-label', label);
  if (control.id) lab.htmlFor = control.id;
  wrap.append(lab, control);
  return wrap;
}

class OpenCaselistPanel {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly accountEl: HTMLDivElement;
  private settled = false;
  private readonly overlayToken = pushOverlay();
  /** Bumped on every navigation so a slow, superseded response is ignored. */
  private generation = 0;

  private caselists: CaselistItem[] = [];
  private schools: NamedItem[] = [];
  private teams: NamedItem[] = [];
  private caselist: string | null = null;
  private school: string | null = null;
  private team: string | null = null;

  private caselistSelect!: HTMLSelectElement;
  private schoolFilter!: HTMLInputElement;
  private schoolList!: HTMLSelectElement;
  private teamList!: HTMLSelectElement;
  private roundsEl!: HTMLDivElement;

  constructor(private readonly options: OpenCaselistPanelOptions) {
    this.overlay = el('div', 'pmd-bulk-overlay');
    this.dialog = el('div', 'pmd-bulk-dialog pmd-ocl-dialog');
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-label', 'OpenCaselist');
    this.overlay.appendChild(this.dialog);
    this.overlay.addEventListener('click', (e) => {
      if (isBackdropClick(e, this.overlay)) this.close();
    });
    document.addEventListener('keydown', this.onKey, true);

    const header = el('header', 'pmd-bulk-header');
    header.appendChild(el('h2', undefined, 'OpenCaselist'));
    this.accountEl = el('div', 'pmd-ocl-account');
    header.appendChild(this.accountEl);
    const close = el('button', 'pmd-bulk-close');
    close.type = 'button';
    setIcon(close, 'close');
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    header.appendChild(close);
    this.dialog.appendChild(header);

    this.body = el('div', 'pmd-bulk-body pmd-ocl-body');
    this.dialog.appendChild(this.body);
    this.statusEl = el('div', 'pmd-bulk-status pmd-ocl-status');
    this.statusEl.setAttribute('role', 'status');
    this.dialog.appendChild(this.statusEl);

    document.body.appendChild(this.overlay);
    void this.start();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isTopOverlay(this.overlayToken)) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  isOpen(): boolean {
    return !this.settled;
  }

  private close(): void {
    if (this.settled) return;
    this.settled = true;
    this.generation++;
    document.removeEventListener('keydown', this.onKey, true);
    popOverlay(this.overlayToken);
    this.overlay.remove();
  }

  private setStatus(message: string, isError = false): void {
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('pmd-ocl-error', isError);
  }

  private async call<T>(op: string, ...args: unknown[]): Promise<Result<T>> {
    const host = getElectronHost();
    if (!host) return { ok: false, error: 'OpenCaselist needs the desktop app.', signedOut: false };
    try {
      return (await host.opencaselist(op, ...args)) as Result<T>;
    } catch {
      return { ok: false, error: 'Could not reach the OpenCaselist service.', signedOut: false };
    }
  }

  /** Shared failure handling: back to sign-in on an expired session. */
  private fail(result: { error: string; signedOut: boolean }): void {
    if (result.signedOut) {
      this.showSignIn(result.error);
      return;
    }
    this.setStatus(result.error, true);
  }

  private async start(): Promise<void> {
    this.setStatus('Checking sign-in…');
    const status = await this.call<{ signedIn: boolean }>('status');
    if (this.settled) return;
    if (!status.ok) {
      this.fail(status);
      return;
    }
    if (status.value.signedIn) await this.showBrowser();
    else this.showSignIn();
  }

  // ── Sign-in ─────────────────────────────────────────────────────────

  private showSignIn(message?: string): void {
    this.generation++;
    this.accountEl.replaceChildren();
    this.body.replaceChildren();
    const form = el('form', 'pmd-ocl-signin');
    form.autocomplete = 'off';
    form.appendChild(el('p', 'pmd-bulk-blurb',
      'Sign in with your Tabroom account. Your password goes only to OpenCaselist and is never saved. ' +
      'CardMirror Green keeps just the sign-in session, encrypted on this computer.'));
    const email = el('input', 'pmd-ocl-input');
    email.type = 'email';
    email.id = 'pmd-ocl-email';
    email.autocomplete = 'username';
    email.required = true;
    const password = el('input', 'pmd-ocl-input');
    password.type = 'password';
    password.id = 'pmd-ocl-password';
    password.autocomplete = 'current-password';
    password.required = true;
    form.append(field('Tabroom email', email), field('Password', password));
    const submit = el('button', 'pmd-bulk-btn pmd-bulk-btn-primary', 'Sign in');
    submit.type = 'submit';
    const actions = el('div', 'pmd-bulk-actions');
    actions.appendChild(submit);
    form.appendChild(actions);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const user = email.value;
      const pass = password.value;
      // Don't keep the password in the page any longer than needed.
      password.value = '';
      if (!user.trim() || !pass) {
        this.setStatus('Enter both your Tabroom email and password.', true);
        return;
      }
      submit.disabled = true;
      this.setStatus('Signing in…');
      void this.call<{ signedIn: true }>('login', user, pass).then(async (result) => {
        if (this.settled) return;
        submit.disabled = false;
        if (!result.ok) {
          this.setStatus(result.error, true);
          password.focus();
          return;
        }
        await this.showBrowser();
      });
    });
    this.body.appendChild(form);
    this.setStatus(message ?? '', !!message);
    email.focus();
  }

  private async signOut(): Promise<void> {
    const result = await this.call<{ signedIn: false }>('logout');
    if (this.settled) return;
    if (!result.ok) {
      this.setStatus(result.error, true);
      return;
    }
    this.caselist = this.school = this.team = null;
    this.showSignIn('Signed out.');
  }

  // ── Browser ─────────────────────────────────────────────────────────

  private async showBrowser(): Promise<void> {
    const gen = ++this.generation;
    this.accountEl.replaceChildren(el('span', 'pmd-ocl-signed-in', 'Signed in'), btn('Sign out', () => void this.signOut()));
    this.body.replaceChildren();

    this.caselistSelect = el('select', 'pmd-ocl-input');
    this.caselistSelect.id = 'pmd-ocl-caselist';
    this.caselistSelect.addEventListener('change', () => void this.pickCaselist(this.caselistSelect.value));

    this.schoolFilter = el('input', 'pmd-ocl-input');
    this.schoolFilter.type = 'search';
    this.schoolFilter.id = 'pmd-ocl-school-filter';
    this.schoolFilter.placeholder = 'Filter schools';
    this.schoolFilter.addEventListener('input', () => this.renderSchools());
    this.schoolList = el('select', 'pmd-ocl-list');
    this.schoolList.size = 8;
    this.schoolList.setAttribute('aria-label', 'Schools');
    this.schoolList.addEventListener('change', () => void this.pickSchool(this.schoolList.value));

    this.teamList = el('select', 'pmd-ocl-list');
    this.teamList.id = 'pmd-ocl-team';
    this.teamList.size = 8;
    this.teamList.addEventListener('change', () => void this.pickTeam(this.teamList.value));

    const schoolCol = field('School', this.schoolFilter);
    schoolCol.appendChild(this.schoolList);
    const columns = el('div', 'pmd-ocl-columns');
    columns.append(schoolCol, field('Team', this.teamList));

    this.roundsEl = el('div', 'pmd-ocl-rounds');

    this.body.append(field('Caselist', this.caselistSelect), columns, this.roundsEl);

    this.setStatus('Loading caselists…');
    const result = await this.call<CaselistItem[]>('caselists');
    if (this.settled || gen !== this.generation) return;
    if (!result.ok) {
      this.fail(result);
      return;
    }
    this.caselists = result.value;
    const placeholder = el('option', undefined, this.caselists.length ? 'Choose a caselist' : 'No caselists found');
    placeholder.value = '';
    this.caselistSelect.replaceChildren(placeholder, ...this.caselists.map(c => {
      const o = el('option', undefined, c.label);
      o.value = c.name;
      return o;
    }));
    this.setStatus('');
    const remembered = this.caselist ?? lastCaselist();
    if (remembered && this.caselists.some(c => c.name === remembered)) {
      this.caselistSelect.value = remembered;
      await this.pickCaselist(remembered);
    } else {
      this.caselistSelect.focus();
    }
  }

  private async pickCaselist(name: string): Promise<void> {
    const gen = ++this.generation;
    this.caselist = name || null;
    this.school = this.team = null;
    this.schools = [];
    this.teams = [];
    this.renderSchools();
    this.renderTeams();
    this.roundsEl.replaceChildren();
    if (!this.caselist) return;
    rememberCaselist(this.caselist);
    this.setStatus('Loading schools…');
    const result = await this.call<NamedItem[]>('schools', this.caselist);
    if (this.settled || gen !== this.generation) return;
    if (!result.ok) {
      this.fail(result);
      return;
    }
    this.schools = result.value;
    this.renderSchools();
    this.setStatus(`${this.schools.length} school${this.schools.length === 1 ? '' : 's'}.`);
    this.schoolFilter.focus();
  }

  private renderSchools(): void {
    const shown = filterItems(this.schools, this.schoolFilter.value);
    this.schoolList.replaceChildren(...shown.map(s => {
      const o = el('option', undefined, s.label);
      o.value = s.name;
      o.selected = s.name === this.school;
      return o;
    }));
  }

  private renderTeams(): void {
    this.teamList.replaceChildren(...this.teams.map(t => {
      const o = el('option', undefined, t.label);
      o.value = t.name;
      o.selected = t.name === this.team;
      return o;
    }));
  }

  private async pickSchool(name: string): Promise<void> {
    if (!this.caselist || !name) return;
    const gen = ++this.generation;
    this.school = name;
    this.team = null;
    this.teams = [];
    this.renderTeams();
    this.roundsEl.replaceChildren();
    this.setStatus('Loading teams…');
    const result = await this.call<NamedItem[]>('teams', this.caselist, name);
    if (this.settled || gen !== this.generation) return;
    if (!result.ok) {
      this.fail(result);
      return;
    }
    this.teams = result.value;
    this.renderTeams();
    this.setStatus(this.teams.length ? '' : 'This school has no teams on this caselist.');
  }

  private async pickTeam(name: string): Promise<void> {
    if (!this.caselist || !this.school || !name) return;
    const gen = ++this.generation;
    this.team = name;
    this.roundsEl.replaceChildren();
    this.setStatus('Loading disclosed rounds…');
    const result = await this.call<RoundItem[]>('rounds', this.caselist, this.school, name);
    if (this.settled || gen !== this.generation) return;
    if (!result.ok) {
      this.fail(result);
      return;
    }
    this.renderRounds(result.value);
  }

  private renderRounds(rounds: RoundItem[]): void {
    const withFiles = rounds.filter(r => r.opensource);
    if (rounds.length === 0) {
      this.setStatus('No disclosed rounds for this team.');
      return;
    }
    const table = el('table', 'pmd-ocl-table');
    const head = el('tr');
    for (const h of ['Tournament', 'Round', 'Side', 'Opponent', 'Judge', 'File']) head.appendChild(el('th', undefined, h));
    table.appendChild(el('thead')).appendChild(head);
    const tbody = el('tbody');
    for (const r of rounds) {
      const tr = el('tr');
      tr.append(el('td', undefined, r.tournament), el('td', undefined, r.round), el('td', undefined, sideLabel(r.side)),
        el('td', undefined, r.opponent), el('td', undefined, r.judge));
      const fileCell = el('td', 'pmd-ocl-file');
      if (r.opensource && r.filename) {
        if (r.openable) {
          const open = btn('Open', () => void this.openRound(r, open));
          open.title = r.filename;
          fileCell.appendChild(open);
        } else {
          const ext = /\.([^.]+)$/.exec(r.filename)?.[1] ?? 'this type';
          const note = el('span', 'pmd-ocl-muted', `.${ext} — not openable here`);
          note.title = r.filename;
          fileCell.appendChild(note);
        }
      } else {
        fileCell.appendChild(el('span', 'pmd-ocl-muted', '—'));
      }
      tr.appendChild(fileCell);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.roundsEl.replaceChildren(table);
    this.setStatus(`${rounds.length} round${rounds.length === 1 ? '' : 's'}, ${withFiles.length} with an open-source file.`);
  }

  private async openRound(round: RoundItem, button: HTMLButtonElement): Promise<void> {
    if (!round.opensource) return;
    button.disabled = true;
    this.setStatus(`Downloading ${round.filename ?? 'file'}…`);
    const result = await this.call<DownloadedFile>('download', round.opensource);
    if (this.settled) return;
    button.disabled = false;
    if (!result.ok) {
      this.fail(result);
      return;
    }
    try {
      await this.options.openFile({ name: result.value.filename, bytes: new Uint8Array(result.value.bytes) });
      if (!this.settled) this.setStatus(`Opened ${result.value.filename} as an unsaved document.`);
    } catch (err) {
      this.setStatus(`Could not open ${result.value.filename}: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }
}

let current: OpenCaselistPanel | null = null;

/** Open the OpenCaselist panel (desktop only). */
export function openOpenCaselist(options: OpenCaselistPanelOptions): void {
  if (current?.isOpen()) return;
  current = new OpenCaselistPanel(options);
}
