/**
 * Flow workbook NodeView — the spreadsheet flow (CardMirror Green).
 *
 * Renders a `flow_workbook` node as sheet tabs over a grid: one column per
 * speech, one row per line of argument, cells that wrap and grow instead of
 * overflowing. Double-clicking a column header (or Mod-Shift-E in a cell)
 * expands that column into a document view — every argument as a full-width
 * section — and the same gesture / Escape / "Back to spreadsheet" returns
 * to the grid.
 *
 * Every edit is committed straight back to the node's `data` attr as one
 * ProseMirror transaction, so undo, save, autosave and three-pane slots
 * treat the flow like any other content. The view re-renders only when the
 * attr changes from outside (undo, redo, reload), not on its own commits.
 *
 * Keys in a cell: Enter = next row (Shift+Enter = new line in the cell),
 * Tab / Shift+Tab = next / previous speech, Up/Down at the edge of the text
 * = row above / below, Mod-Enter = insert row below, Mod-Shift-Backspace =
 * delete row, Mod-B = bold, Mod-Shift-X = cross out, Mod-Shift-L = extend.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import {
  addSheet,
  placeColumnSections,
  cellAt,
  columnSide,
  columnToSections,
  deleteRows,
  deleteSheet,
  FLOW_FORMATS,
  insertRows,
  newWorkbook,
  newFlowId,
  moveSheet,
  nextOffName,
  parseFlow,
  renameSheet,
  serializeFlow,
  setCell,
  setPrep,
  shiftRanges,
  sideName,
  toggleRange,
  type ColumnSection,
  type FlowCell,
  type FlowSheet,
  type FlowWorkbook,
} from '../flow/flow-model.js';
import { flowKeyForEvent, validFlowShortcut, displayFlowShortcut } from './flow-shortcuts.js';
import { confirmDialog, promptForText } from './text-prompt.js';
import { flowUpdateSource, markPrepFlowReconciliation, PREP_FLOW_RECONCILE_ORIGIN } from './prep-document-guard.js';
import { EditHistory, maxFlowClock, mergeIncoming, recordLocalEdit, stampFlowEdit } from '../flow/flow-merge.js';
import {
  applyFlowTheme,
  colorwayColors,
  DEFAULT_FLOW_THEME,
  FLOW_BASES,
  FLOW_COLORWAYS,
  loadFlowTheme,
  onFlowThemeChange,
  saveFlowTheme,
  speechFillSlot,
  themeSideColors,
  type FlowBaseId,
  type FlowFont,
  type FlowTextSize,
  type FlowTheme,
} from './flow-theme.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function autoGrow(area: HTMLTextAreaElement): void {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
}

/** A grid cell: a speech column index, or 'prep' for the row's Prep cell. */
type ColKey = number | 'prep';
interface FocusSpot { row: number; col: ColKey; caret: number | 'end' }

const colAttr = (col: ColKey): string => String(col);
const parseCol = (v: string | undefined): ColKey => (v === 'prep' ? 'prep' : Number(v));

/** Cheap fingerprint of a serialized flow, to recognize my own earlier states. */
function fingerprint(data: string): string {
  let h = 0;
  for (let i = 0; i < data.length; i++) h = (Math.imul(h, 31) + data.charCodeAt(i)) | 0;
  return `${data.length}:${h}`;
}

/** Paint highlight ranges into a cell's backdrop (a mirror of the textarea's text). */
function paintHighlights(backdrop: HTMLElement, text: string, ranges: Array<[number, number]> | undefined): void {
  backdrop.replaceChildren();
  let at = 0;
  for (const [a, b] of ranges ?? []) {
    if (a > at) backdrop.append(text.slice(at, a));
    const mark = document.createElement('mark');
    mark.className = 'pmd-flow-mark';
    mark.textContent = text.slice(a, b);
    backdrop.append(mark);
    at = b;
  }
  // A trailing newline needs a character after it to take up its line.
  backdrop.append(text.slice(at) + (text.endsWith('\n') ? '\u200b' : ''));
}

export class FlowWorkbookView implements NodeView {
  readonly dom: HTMLDivElement;
  private book: FlowWorkbook;
  private lastData: string;
  private sheetId: string;
  /** Column shown as a document, or null for the grid. */
  private expandedCol: number | null = null;
  /** Sections of the expanded column, kept locally so empty new sections survive edits. */
  private sections: ColumnSection[] = [];
  /** Last cell that had focus, for the toolbar. */
  private lastCell: FocusSpot | null = null;
  /** Its last text selection, for the toolbar's Highlight button. */
  private lastSel: { start: number; end: number } = { start: 0, end: 0 };
  /** The Prep (thumpers) column is shown right after this speech column; null = hidden. */
  private prepAfter: number | null = null;
  /** My recent previous cell values, to spot a partner's stale copy of them. */
  private readonly history = new EditHistory();
  private readonly actor = newFlowId();
  private clock = 0;
  /** Fingerprints of states I have held, so my own undo/redo is never "merged". */
  private readonly pastStates: string[] = [];
  private selectedCells = new Set<string>();
  private rangeSelection = false;
  private selectionAnchor: { rowId: string; col: ColKey } | null = null;
  private draggedSheet: string | null = null;
  private appearanceOpen = false;
  private theme: FlowTheme = loadFlowTheme();
  private readonly unsubscribeTheme: () => void;
  private resizeObserver: ResizeObserver | null = null;
  private fitFrame = 0;

  constructor(node: PMNode, private readonly view: EditorView, private readonly getPos: () => number | undefined) {
    this.dom = el('div', 'pmd-flow-root');
    this.dom.contentEditable = 'false';
    this.lastData = String(node.attrs['data'] ?? '');
    this.book = this.parse(this.lastData);
    this.clock = maxFlowClock(this.book);
    this.sheetId = this.book.sheets[0]!.id;
    applyFlowTheme(this.dom, this.theme);
    this.unsubscribeTheme = onFlowThemeChange((theme) => {
      this.theme = theme;
      applyFlowTheme(this.dom, theme);
      if (this.appearanceOpen) this.render(this.lastCell ?? undefined);
    });
    this.render();
    this.watchHeight();
  }

  destroy(): void {
    this.unsubscribeTheme();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.scheduleFit);
    cancelAnimationFrame(this.fitFrame);
  }

  // ─── Fill the window / pane height ────────────────────────────────

  /** Nearest scrolling ancestor: the editor's scroller in a window or a three-pane slot. */
  private scroller(): HTMLElement | null {
    for (let n = this.dom.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.clientHeight > 0) return n;
    }
    return null;
  }

  private scheduleFit = (): void => {
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => this.fitHeight());
  };

  /** Size the flow to the visible height of its window or pane, so the grid
   *  reaches the bottom and scrolls inside itself like a spreadsheet. */
  private fitHeight(): void {
    if (!this.dom.isConnected) return;
    if (this.view.dom.classList.contains('pmd-flow-workspace')) { this.dom.style.height = '100%'; return; }
    const sc = this.scroller();
    const visible = sc ? sc.clientHeight : window.innerHeight;
    const style = getComputedStyle(this.dom);
    const margins = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    // Space above the flow inside the scroller (the editor's top padding),
    // so the flow's bottom lines up with the bottom of the window or pane.
    const above = sc ? this.dom.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - parseFloat(style.marginTop) : 0;
    const height = Math.max(360, Math.floor(visible - Math.max(0, above) - margins - 4));
    if (this.dom.style.height !== `${height}px`) this.dom.style.height = `${height}px`;
  }

  private watchHeight(): void {
    window.addEventListener('resize', this.scheduleFit);
    this.scheduleFit();
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(this.scheduleFit);
    // The scroller only exists once the view is mounted in the page.
    requestAnimationFrame(() => {
      const sc = this.scroller();
      if (sc) this.resizeObserver?.observe(sc);
      this.scheduleFit();
    });
  }

  private parse(data: string): FlowWorkbook {
    if (!data) return newWorkbook('npda');
    try {
      return parseFlow(data);
    } catch {
      return newWorkbook('npda');
    }
  }

  private get sheet(): FlowSheet {
    return this.book.sheets.find((s) => s.id === this.sheetId) ?? this.book.sheets[0]!;
  }

  // ─── ProseMirror NodeView contract ────────────────────────────────

  update(node: PMNode): boolean {
    if (node.type.name !== 'flow_workbook') return false;
    const data = String(node.attrs['data'] ?? '');
    if (data === this.lastData) return true;
    const incoming = this.parse(data);
    const now = Date.now();
    // Local undo/redo reissues my changed cells with newer revisions, keeping
    // partner-owned cells. A remote snapshot is always merged, even if its
    // bytes happen to match one of my previous states.
    this.clock = Math.max(this.clock, maxFlowClock(incoming));
    const source = flowUpdateSource(this.view.state.doc);
    const own = source === 'history' || (source !== 'remote' && this.pastStates.includes(fingerprint(data)));
    const merged = mergeIncoming(incoming, this.book, this.history, now);
    const { book, keptMine } = own
      ? { book: stampFlowEdit(this.book, incoming, this.actor, ++this.clock, true), keptMine: true }
      : merged;
    const before = this.book;
    this.book = book;
    this.lastData = data;
    this.remember(data);
    if (!this.book.sheets.some((s) => s.id === this.sheetId)) { this.sheetId = this.book.sheets[0]!.id; this.resetCellSelection(); }
    this.refreshFrom(before);
    // Re-send my kept cells so the partner gets them too (after this update finishes).
    if (keptMine) setTimeout(() => this.commit(this.book, true), 0);
    return true;
  }

  private remember(data: string): void {
    this.pastStates.push(fingerprint(data));
    if (this.pastStates.length > 400) this.pastStates.splice(0, this.pastStates.length - 400);
  }

  /** Bring the screen up to date with `this.book` without disturbing whoever
   *  is typing: same layout → patch cells in place; otherwise re-render and
   *  restore focus and caret. */
  private refreshFrom(before: FlowWorkbook): void {
    const focus = this.currentFocus();
    if (this.expandedCol !== null) {
      this.refreshColumnDoc();
      return;
    }
    if (!this.sameLayout(before, this.book)) {
      this.render(focus ?? undefined);
      return;
    }
    for (const area of Array.from(this.dom.querySelectorAll<HTMLTextAreaElement>('textarea.pmd-flow-cell'))) {
      const row = Number(area.dataset['row']);
      const col = parseCol(area.dataset['col']);
      const cell = this.cellOf(row, col);
      if (area.value !== cell.text) {
        if (document.activeElement === area) {
          // A partner changed the cell I am in: keep my caret where it was relative to the text.
          const [start, end] = shiftRanges([[area.selectionStart, Math.max(area.selectionEnd, area.selectionStart + 1)]], area.value, cell.text)[0] ?? [cell.text.length, cell.text.length];
          area.value = cell.text;
          const caretEnd = area.selectionEnd === area.selectionStart ? start : end;
          area.setSelectionRange(start, Math.min(caretEnd, cell.text.length));
        } else {
          area.value = cell.text;
        }
        autoGrow(area);
      }
      this.styleCell(area, cell);
    }
  }

  /** Same sheets (ids, names, sides), and the shown sheet has the same columns and rows. */
  private sameLayout(a: FlowWorkbook, b: FlowWorkbook): boolean {
    if (a.sheets.length !== b.sheets.length) return false;
    for (let i = 0; i < a.sheets.length; i++) {
      const x = a.sheets[i]!;
      const y = b.sheets[i]!;
      if (x.id !== y.id || x.name !== y.name || x.side !== y.side) return false;
    }
    const x = a.sheets.find((s) => s.id === this.sheetId);
    const y = b.sheets.find((s) => s.id === this.sheetId);
    if (!x || !y || x.columns.join('\u0000') !== y.columns.join('\u0000') || x.rows.length !== y.rows.length) return false;
    return x.rows.every((r, i) => r.id === y.rows[i]!.id);
  }

  /** The grid owns its own keyboard and mouse handling. */
  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('pmd-flow-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('pmd-flow-selected');
  }

  // ─── Commit ───────────────────────────────────────────────────────

  private commit(book: FlowWorkbook, reconciliation = false): void {
    if (!reconciliation) book = stampFlowEdit(this.book, book, this.actor, ++this.clock);
    const data = serializeFlow(book);
    if (data === this.lastData) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'flow_workbook') return;
    const before = this.book;
    const previousData = this.lastData;
    // Optimistic state keeps a successful local dispatch from being mistaken
    // for a partner edit by update(). A filterTransaction can refuse it (Prep
    // protection, read mode, etc.), in which case restore the authoritative
    // document immediately. Otherwise rejected text survives in the textarea
    // and is silently bundled into the next legitimate keystroke.
    this.book = book;
    this.lastData = data;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, data });
    if (reconciliation) markPrepFlowReconciliation(tr).setMeta('addToHistory', false).setMeta('cmCommitOrigin', PREP_FLOW_RECONCILE_ORIGIN);
    this.view.dispatch(tr);
    const accepted = this.view.state.doc.nodeAt(pos);
    if (accepted?.type.name !== 'flow_workbook') return;
    const acceptedData = String(accepted.attrs['data'] ?? '');
    if (acceptedData !== data) {
      this.lastData = acceptedData;
      this.book = this.parse(acceptedData);
      if (!this.book.sheets.some(s => s.id === this.sheetId)) this.sheetId = this.book.sheets[0]!.id;
      if (this.expandedCol !== null) this.sections = columnToSections(this.sheet, this.expandedCol);
      this.render(this.currentFocus() ?? undefined);
      return;
    }
    recordLocalEdit(this.history, before, book, Date.now());
    this.remember(previousData);
    this.remember(data);
  }

  private cellOf(row: number, col: ColKey): FlowCell {
    if (col === 'prep') return this.sheet.rows[row]?.prep ?? { text: '' };
    return cellAt(this.sheet, row, col);
  }

  private withCell(row: number, col: ColKey, patch: Partial<FlowCell>): FlowWorkbook {
    return col === 'prep' ? setPrep(this.book, this.sheetId, row, patch) : setCell(this.book, this.sheetId, row, col, patch);
  }

  // ─── Rendering ────────────────────────────────────────────────────

  private render(focus?: FocusSpot): void {
    const main = el('div', 'pmd-flow-main');
    main.append(this.renderTopbar(), this.expandedCol === null ? this.renderGrid() : this.renderColumnDoc());
    this.dom.replaceChildren(this.renderSidebar(), main);
    this.paintSelection();
    if (this.appearanceOpen) this.dom.appendChild(this.renderAppearance());
    requestAnimationFrame(() => {
      this.dom.querySelectorAll('textarea').forEach((t) => autoGrow(t));
      if (focus) this.focusCell(focus);
    });
  }

  private renderSidebar(): HTMLElement {
    const bar = el('div', 'pmd-flow-tabs');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-orientation', 'vertical');
    for (const s of this.book.sheets) {
      const tab = el('button', 'pmd-flow-tab' + (s.id === this.sheetId ? ' pmd-flow-tab-active' : '') + ` pmd-flow-side-${s.side}`, s.name);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(s.id === this.sheetId));
      tab.title = 'Drag to reorder. Double-click to rename. Alt+Up/Down also reorders.';
      tab.addEventListener('click', () => {
        if (this.sheetId === s.id) return;
        this.sheetId = s.id;
        this.resetCellSelection();
        this.expandedCol = null;
        this.render({ row: 0, col: 0, caret: 'end' });
      });
      tab.addEventListener('dblclick', () => void this.rename(s));
      tab.dataset['flowSheetId'] = s.id;
      tab.draggable = true;
      tab.addEventListener('dragstart', event => {
        this.draggedSheet = s.id;
        if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-cardmirror-flow-sheet', s.id); }
      });
      tab.addEventListener('dragend', () => { this.draggedSheet = null; });
      tab.addEventListener('dragover', event => { if (this.draggedSheet) { event.preventDefault(); tab.classList.add('pmd-flow-drop-target'); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; } });
      tab.addEventListener('dragleave', () => tab.classList.remove('pmd-flow-drop-target'));
      tab.addEventListener('drop', event => {
        tab.classList.remove('pmd-flow-drop-target');
        if (!this.draggedSheet) return;
        event.preventDefault(); event.stopPropagation();
        const from = this.book.sheets.findIndex(sheet => sheet.id === this.draggedSheet);
        const to = this.book.sheets.findIndex(sheet => sheet.id === s.id);
        if (from >= 0 && to >= 0) { this.commit(moveSheet(this.book, this.draggedSheet, to)); this.render(); }
        this.draggedSheet = null;
      });
      tab.addEventListener('keydown', event => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const index = this.book.sheets.findIndex(sheet => sheet.id === s.id);
        this.commit(moveSheet(this.book, s.id, index + (event.key === 'ArrowUp' ? -1 : 1)));
        this.render();
        this.dom.querySelector<HTMLButtonElement>(`[data-flow-sheet-id="${s.id}"]`)?.focus();
      });
      bar.appendChild(tab);
    }
    const adds = el('div', 'pmd-flow-adds');
    for (const side of ['aff', 'neg'] as const) {
      const add = el('button', `pmd-flow-add pmd-flow-side-${side}`, `+ ${sideName(this.book.event, side)}`);
      add.type = 'button';
      add.title = `New ${sideName(this.book.event, side)} sheet`;
      add.addEventListener('click', () => this.add(side));
      adds.appendChild(add);
    }
    bar.appendChild(adds);
    bar.appendChild(el('div', 'pmd-flow-event', FLOW_FORMATS[this.book.event]?.label ?? 'Custom'));
    return bar;
  }

  /** A toolbar button that acts on the last-focused cell without stealing focus. */
  private tool(label: string, title: string, run: () => void, disabled = false): HTMLButtonElement {
    const b = el('button', 'pmd-flow-tool', label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = disabled;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', run);
    return b;
  }

  private renderTopbar(): HTMLElement {
    const sheet = this.sheet;
    const bar = el('div', 'pmd-flow-topbar');
    const title = el('div', `pmd-flow-title pmd-flow-side-${sheet.side}`, sheet.name);
    title.title = 'Double-click to rename';
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    title.setAttribute('aria-label', `Rename sheet ${sheet.name}`);
    title.addEventListener('dblclick', () => void this.rename(sheet));
    title.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'F2') { event.preventDefault(); void this.rename(sheet); }
    });
    bar.appendChild(title);
    const tools = el('div', 'pmd-flow-tools');
    const onCell = (fn: (spot: FocusSpot) => void) => () => { if (this.lastCell) fn(this.lastCell); };
    const flag = (f: 'bold' | 'crossed' | 'extended') => onCell(({ row, col }) => {
      const cell = this.cellOf(row, col);
      this.commit(this.withCell(row, col, { [f]: !cell[f] }));
      this.render({ row, col, caret: 'end' });
    });
    const inGrid = this.expandedCol === null;
    tools.append(
      this.tool('B', `Bold (${isMac ? 'Cmd' : 'Ctrl'}+B)`, flag('bold'), !inGrid),
      this.tool('S\u0336', `Cross out (${isMac ? 'Cmd' : 'Ctrl'}+Shift+X)`, flag('crossed'), !inGrid),
      this.tool('\u21A6', `Extend (${isMac ? 'Cmd' : 'Ctrl'}+Shift+L)`, flag('extended'), !inGrid),
      this.tool('Highlight', `Highlight selected text or cells (${displayFlowShortcut(this.theme.highlightKey, isMac)})`, onCell(({ row, col }) => {
        this.toggleHighlight(row, col, this.lastSel.start, this.lastSel.end);
      }), !inGrid),
      this.tool(this.prepAfter === null ? 'Prep' : 'Close prep', `Thumpers / prepped answers next to the current speech (${isMac ? 'Cmd' : 'Ctrl'}+Shift+P)`, () => {
        const c = this.lastCell?.col;
        this.togglePrep(this.prepAfter !== null ? this.prepAfter : typeof c === 'number' ? c : 0);
      }, !inGrid),
      this.tool('+ Row', `Insert row below (${isMac ? 'Cmd' : 'Ctrl'}+Enter)`, onCell(({ row, col }) => {
        this.commit(insertRows(this.book, this.sheetId, row + 1));
        this.render({ row: row + 1, col, caret: 'end' });
      }), !inGrid),
      this.tool('\u2212 Row', `Delete row (${isMac ? 'Cmd' : 'Ctrl'}+Shift+Backspace)`, onCell(({ row, col }) => {
        this.commit(deleteRows(this.book, this.sheetId, row));
        this.render({ row: Math.max(0, Math.min(row, this.sheet.rows.length - 1)), col, caret: 'end' });
      }), !inGrid),
      this.tool(inGrid ? 'Open as doc' : 'Back to sheet', inGrid ? 'Open the current speech as a document (double-click a header)' : 'Back to the spreadsheet (Escape)', () => {
        if (inGrid) this.expand(typeof this.lastCell?.col === 'number' ? this.lastCell.col : 0);
        else this.collapse();
      }),
      this.tool('Appearance', 'Colors, text size and font', () => {
        this.appearanceOpen = !this.appearanceOpen;
        this.render();
      }),
      this.tool('Select all cells', 'Select every cell in this sheet', () => {
        this.selectedCells.clear(); this.rangeSelection = true;
        for (let row = 0; row < this.sheet.rows.length; row++) for (const col of this.visibleColumns()) this.selectedCells.add(this.cellKey(row, col));
        this.paintSelection();
        this.focusCell({row: 0, col: 0, caret: 'end'});
      }, !inGrid),
      this.tool('Clear cells', 'Clear selected cell contents (Delete or Backspace for a selection)', () => this.clearSelectedCells(), !inGrid),
      this.tool('Delete sheet', 'Delete this sheet', () => void this.removeSheet(), this.book.sheets.length < 2),
    );
    bar.appendChild(tools);
    return bar;
  }

  private renderAppearance(): HTMLElement {
    const panel = el('div', 'pmd-flow-appearance');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Flow appearance');
    const head = el('div', 'pmd-flow-app-head');
    head.appendChild(el('strong', undefined, 'Appearance'));
    head.appendChild(this.tool('\u00D7', 'Close', () => { this.appearanceOpen = false; this.render(); }));
    panel.appendChild(head);
    const section = (title: string): HTMLElement => {
      const h = el('div', 'pmd-flow-app-label', title);
      panel.appendChild(h);
      return h;
    };

    section('Background');
    const bases = el('div', 'pmd-flow-segment');
    for (const [id, spec] of Object.entries(FLOW_BASES) as Array<[FlowBaseId, (typeof FLOW_BASES)[FlowBaseId]]>) {
      const b = el('button', 'pmd-flow-seg' + (this.theme.base === id ? ' pmd-flow-seg-on' : ''), spec.label);
      b.type = 'button';
      b.dataset['base'] = id;
      b.setAttribute('aria-pressed', String(this.theme.base === id));
      b.addEventListener('click', () => {
        // Classic sheet reads best in one ink color; leaving it brings the color back.
        const colorway = id === 'classic' ? 'ink' : this.theme.colorway === 'ink' ? 'green-pink' : this.theme.colorway;
        saveFlowTheme({ ...this.theme, base: id, colorway });
      });
      bases.appendChild(b);
    }
    panel.appendChild(bases);

    section('Colorway');
    const ways = el('div', 'pmd-flow-colorways');
    for (const [id, cw] of Object.entries(FLOW_COLORWAYS)) {
      const on = this.theme.colorway === id && !this.theme.affText && !this.theme.negText;
      const b = el('button', 'pmd-flow-colorway' + (on ? ' pmd-flow-colorway-on' : ''));
      b.type = 'button';
      b.dataset['colorway'] = id;
      b.title = cw.label;
      b.setAttribute('aria-pressed', String(on));
      const shades = colorwayColors(id, this.theme.base);
      const dots = el('span', 'pmd-flow-dots');
      const d1 = el('i');
      d1.style.background = shades.aff;
      const d2 = el('i');
      d2.style.background = shades.neg;
      dots.append(d1, d2);
      b.append(dots, el('span', undefined, cw.label));
      b.addEventListener('click', () => saveFlowTheme({ ...this.theme, colorway: id, affText: null, negText: null }));
      ways.appendChild(b);
    }
    panel.appendChild(ways);

    section('Pick your own');
    const colors = themeSideColors(this.theme);
    const custom = el('div', 'pmd-flow-custom');
    for (const side of ['aff', 'neg'] as const) {
      const label = el('label', 'pmd-flow-colorpick');
      const input = el('input');
      input.type = 'color';
      input.value = colors[side];
      input.addEventListener('input', () => saveFlowTheme({ ...this.theme, [side === 'aff' ? 'affText' : 'negText']: input.value }));
      label.append(input, el('span', undefined, sideName(this.book.event, side)));
      custom.appendChild(label);
    }
    panel.appendChild(custom);

    section('Highlight');
    const highlight = el('label', 'pmd-flow-colorpick');
    const color = el('input'); color.type = 'color'; color.value = this.theme.highlightColor ?? '#22e650';
    color.setAttribute('aria-label', 'Highlight color');
    color.addEventListener('change', () => saveFlowTheme({ ...this.theme, highlightColor: color.value }));
    highlight.append(color, el('span', undefined, 'Highlight color'));
    panel.append(highlight);
    const shortcutLabel = el('label', 'pmd-flow-colorpick');
    const shortcut = el('input'); shortcut.type = 'text'; shortcut.readOnly = true;
    shortcut.value = displayFlowShortcut(this.theme.highlightKey, isMac);
    shortcut.setAttribute('aria-label', 'Highlight shortcut');
    shortcut.title = 'Focus here and press a function key or a modified key. Escape cancels.';
    shortcut.addEventListener('keydown', event => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { shortcut.blur(); return; }
      const key = flowKeyForEvent(event);
      if (!key || !validFlowShortcut(key)) { shortcut.value = 'Use an F-key or modifier chord'; return; }
      saveFlowTheme({ ...this.theme, highlightKey: key });
    });
    shortcutLabel.append(el('span', undefined, 'Highlight shortcut'), shortcut); panel.append(shortcutLabel);

    section('Text');
    const sizes = el('div', 'pmd-flow-segment');
    for (const [v, l] of [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] as const) {
      const b = el('button', 'pmd-flow-seg' + (this.theme.size === v ? ' pmd-flow-seg-on' : ''), l);
      b.type = 'button';
      b.addEventListener('click', () => saveFlowTheme({ ...this.theme, size: v as FlowTextSize }));
      sizes.appendChild(b);
    }
    panel.appendChild(sizes);
    const font = el('select', 'pmd-flow-select');
    font.setAttribute('aria-label', 'Font');
    for (const [v, l] of [['', 'Font: theme default'], ['ui', 'Font: app font'], ['arial', 'Font: Arial'], ['serif', 'Font: serif']] as const) {
      const o = el('option', undefined, l);
      o.value = v;
      o.selected = (this.theme.font ?? '') === v;
      font.appendChild(o);
    }
    font.addEventListener('change', () => saveFlowTheme({ ...this.theme, font: (font.value || null) as FlowFont | null }));
    panel.appendChild(font);

    const foot = el('div', 'pmd-flow-app-foot');
    const reset = el('button', 'pmd-flow-tool', 'Reset');
    reset.type = 'button';
    reset.addEventListener('click', () => saveFlowTheme({ ...DEFAULT_FLOW_THEME }));
    foot.append(el('span', 'pmd-flow-app-note', 'For every flow on this computer; not saved in the file.'), reset);
    panel.appendChild(foot);
    return panel;
  }

  private renderGrid(): HTMLElement {
    const sheet = this.sheet;
    const wrap = el('div', 'pmd-flow-gridwrap');
    const table = el('table', 'pmd-flow-grid');
    table.setAttribute('role', 'grid'); table.setAttribute('aria-multiselectable', 'true');
    const prepAfter = this.prepAfter !== null && this.prepAfter < sheet.columns.length ? this.prepAfter : null;
    if (prepAfter === null) this.prepAfter = null;
    const head = el('tr');
    sheet.columns.forEach((name, col) => {
      const th = el('th', `pmd-flow-head pmd-flow-side-${columnSide(this.book.event, sheet, col)} pmd-flow-fill-${speechFillSlot(name, col)}${col % 2 ? ' pmd-flow-odd' : ''}`);
      th.appendChild(el('span', 'pmd-flow-chip', name));
      th.title = 'Double-click to open this speech as a document';
      th.addEventListener('dblclick', () => this.expand(col));
      head.appendChild(th);
      if (col === prepAfter) {
        const pth = el('th', 'pmd-flow-head pmd-flow-prep-head');
        const chip = el('span', 'pmd-flow-chip', 'Prep');
        pth.appendChild(chip);
        pth.title = `Thumpers and prepped answers, lined up with each row. ${isMac ? 'Cmd' : 'Ctrl'}+Shift+P closes it.`;
        head.appendChild(pth);
      }
    });
    table.appendChild(el('thead')).appendChild(head);
    const body = el('tbody');
    sheet.rows.forEach((_row, r) => body.appendChild(this.renderRow(r, prepAfter)));
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  private renderRow(r: number, prepAfter: number | null): HTMLTableRowElement {
    const sheet = this.sheet;
    const row = sheet.rows[r]!;
    const tr = el('tr');
    sheet.columns.forEach((_, col) => {
      const td = el('td', `pmd-flow-td pmd-flow-side-${columnSide(this.book.event, sheet, col)} pmd-flow-fill-${speechFillSlot(sheet.columns[col]!, col)}${col % 2 ? ' pmd-flow-odd' : ''}`);
      td.setAttribute('role', 'gridcell');
      td.setAttribute('aria-selected', 'false');
      td.appendChild(this.renderCell(cellAt(sheet, r, col), r, col));
      tr.appendChild(td);
      if (col === prepAfter) {
        const ptd = el('td', 'pmd-flow-td pmd-flow-prep');
        ptd.setAttribute('role', 'gridcell');
        ptd.setAttribute('aria-selected', 'false');
        ptd.appendChild(this.renderCell(row.prep ?? { text: '' }, r, 'prep'));
        tr.appendChild(ptd);
      }
    });
    return tr;
  }

  /** A cell: a textarea over a backdrop that paints its highlighted ranges. */
  private renderCell(cell: FlowCell, row: number, col: ColKey): HTMLElement {
    const box = el('div', 'pmd-flow-cellwrap');
    const backdrop = el('div', 'pmd-flow-cell pmd-flow-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const area = el('textarea', 'pmd-flow-cell');
    area.rows = 1;
    area.spellcheck = true;
    area.value = cell.text;
    area.dataset['row'] = String(row);
    area.dataset['col'] = colAttr(col);
    area.setAttribute('aria-label', `${col === 'prep' ? 'Prep' : this.sheet.columns[col]} row ${row + 1}`);
    box.append(backdrop, area);
    this.styleCell(area, cell);
    area.addEventListener('input', () => {
      this.selectSingleCell(row, col);
      autoGrow(area);
      const old = this.cellOf(row, col);
      const next = this.withCell(row, col, { text: area.value, hl: shiftRanges(old.hl, old.text, area.value) });
      this.commit(next);
      this.styleCell(area, this.cellOf(row, col));
    });
    area.addEventListener('keydown', (e) => this.onCellKey(e, area, row, col));
    area.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      if (event.shiftKey) {
        event.preventDefault(); this.extendCellSelection(row, col); area.focus();
      } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        this.rangeSelection = true;
        const key = this.cellKey(row, col);
        if (this.selectedCells.has(key)) this.selectedCells.delete(key); else this.selectedCells.add(key);
        this.selectionAnchor ??= {rowId: this.sheet.rows[row]!.id, col};
        this.paintSelection(); area.focus();
      } else this.selectSingleCell(row, col);
    });
    area.addEventListener('focus', () => {
      this.lastCell = { row, col, caret: 'end' };
      this.lastSel = {start: area.selectionStart, end: area.selectionEnd};
      if (!this.rangeSelection) this.selectSingleCell(row, col);
    });
    const trackSel = (): void => {
      if (document.activeElement === area) this.lastSel = { start: area.selectionStart, end: area.selectionEnd };
    };
    area.addEventListener('select', trackSel);
    area.addEventListener('keyup', trackSel);
    area.addEventListener('mouseup', trackSel);
    return box;
  }

  /** Classes and highlight backdrop for a cell textarea. */
  private styleCell(area: HTMLTextAreaElement, cell: FlowCell): void {
    for (const f of ['bold', 'crossed', 'extended'] as const) area.classList.toggle(`pmd-flow-${f}`, !!cell[f]);
    const backdrop = area.previousElementSibling as HTMLElement | null;
    if (!backdrop?.classList.contains('pmd-flow-backdrop')) return;
    backdrop.classList.toggle('pmd-flow-bold', !!cell.bold);
    paintHighlights(backdrop, area.value, cell.hl);
  }

  /** Highlight the selected text of a cell (or the whole cell when nothing is
   *  selected); highlighting already-highlighted text removes it. */
  private toggleHighlight(row: number, col: ColKey, start: number, end: number): void {
    if (this.selectedCells.size > 1) {
      const targets = this.selectionTargets();
      const allOn = targets.every(spot => !!this.cellOf(spot.row, spot.col).hl?.length);
      let book = this.book;
      for (const spot of targets) {
        const cell = this.cellOf(spot.row, spot.col);
        const patch = {hl: allOn || !cell.text.length ? [] : [[0, cell.text.length]] as Array<[number, number]>};
        book = spot.col === 'prep' ? setPrep(book, this.sheetId, spot.row, patch) : setCell(book, this.sheetId, spot.row, spot.col, patch);
      }
      const focus = this.currentFocus() ?? this.lastCell;
      this.commit(book); this.render(focus ?? undefined); return;
    }
    const cell = this.cellOf(row, col);
    const len = cell.text.length;
    let hl: Array<[number, number]>;
    if (end > start) hl = toggleRange(cell.hl, start, end, len);
    else hl = cell.hl?.length ? [] : len ? [[0, len]] : [];
    this.commit(this.withCell(row, col, { hl }));
    const area = this.dom.querySelector<HTMLTextAreaElement>(`textarea.pmd-flow-cell[data-row="${row}"][data-col="${colAttr(col)}"]`);
    if (area) this.styleCell(area, this.cellOf(row, col));
  }

  /** Show the Prep column right after `col`, or hide it if it is already there. */
  private togglePrep(col: number): void {
    const focus = this.currentFocus();
    this.prepAfter = this.prepAfter === col ? null : col;
    const spot = this.prepAfter === null
      ? (focus && focus.col === 'prep' ? { row: focus.row, col, caret: 'end' as const } : focus)
      : { row: focus?.row ?? 0, col: 'prep' as const, caret: 'end' as const };
    this.render(spot ?? undefined);
  }

  private renderColumnDoc(): HTMLElement {
    const col = this.expandedCol!;
    const sheet = this.sheet;
    const wrap = el('div', `pmd-flow-doc pmd-flow-side-${columnSide(this.book.event, sheet, col)}`);
    const bar = el('div', 'pmd-flow-docbar');
    bar.appendChild(el('strong', undefined, `${sheet.columns[col]} — ${sheet.name}`));
    bar.appendChild(el('span', 'pmd-flow-hint', 'Enter = next argument · Shift+Enter = new line · Escape = back to the spreadsheet'));
    if (this.sections.some((sec) => /\n/.test(sec.text.trim()))) {
      const split = el('button', 'pmd-flow-tool pmd-flow-split', 'Split lines into arguments');
      split.type = 'button';
      split.title = 'Make every line its own argument (cell)';
      split.addEventListener('click', () => this.splitAllLines());
      bar.appendChild(split);
    }
    wrap.appendChild(bar);
    if (this.sections.length === 0) this.sections = [{ rowId: null, text: '' }];
    this.sections.forEach((section, i) => {
      const area = el('textarea', 'pmd-flow-docsec');
      area.value = section.text;
      area.rows = 2;
      area.spellcheck = true;
      area.dataset['section'] = String(i);
      const source = section.rowId ? sheet.rows.find((r) => r.id === section.rowId)?.cells[col] : undefined;
      area.classList.toggle('pmd-flow-bold', !!source?.bold);
      area.classList.toggle('pmd-flow-crossed', !!source?.crossed);
      area.setAttribute('aria-label', `${sheet.columns[col]} argument ${i + 1}`);
      area.addEventListener('input', () => {
        autoGrow(area);
        this.sections[i] = { ...this.sections[i]!, text: area.value };
        this.commitSections();
      });
      area.addEventListener('keydown', (e) => {
        const atStart = area.selectionStart === 0 && area.selectionEnd === 0;
        const atEnd = area.selectionStart === area.value.length && area.selectionEnd === area.value.length;
        if (e.key === 'Escape' || (modKey(e) && e.shiftKey && e.key.toLowerCase() === 'e')) {
          e.preventDefault();
          this.collapse();
        } else if (modKey(e) && e.key === 'Enter') {
          e.preventDefault();
          this.addSection(i + 1);
        } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !modKey(e)) {
          // Enter = next argument (its own cell); Shift+Enter = new line in this argument.
          e.preventDefault();
          this.splitSection(i, area.selectionStart, area.selectionEnd);
        } else if (e.key === 'Backspace' && atStart && i > 0) {
          e.preventDefault();
          this.mergeWithPrevious(i);
        } else if (e.key === 'ArrowUp' && atStart && i > 0) {
          e.preventDefault();
          this.focusSection(i - 1, 'end');
        } else if (e.key === 'ArrowDown' && atEnd && i < this.sections.length - 1) {
          e.preventDefault();
          this.focusSection(i + 1, 0);
        }
      });
      area.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (!/\r?\n/.test(text)) return;
        // Pasted lines become separate arguments, like typing them with Enter.
        e.preventDefault();
        this.insertLines(i, area.selectionStart, area.selectionEnd, text);
      });
      wrap.appendChild(area);
      const add = el('button', 'pmd-flow-addsec', '+ Add argument');
      add.type = 'button';
      add.title = 'Mod-Enter';
      add.addEventListener('click', () => this.addSection(i + 1));
      wrap.appendChild(add);
    });
    return wrap;
  }

  /** A partner edit while a column is open as a document: update the other
   *  arguments in place and leave the one being typed in alone. */
  private refreshColumnDoc(): void {
    const col = this.expandedCol!;
    const rows = new Map(this.sheet.rows.map((r) => [r.id, r]));
    const active = document.activeElement;
    const typing = active instanceof HTMLTextAreaElement && active.classList.contains('pmd-flow-docsec') && this.dom.contains(active);
    if (!typing || this.sections.some((sec) => sec.rowId && !rows.has(sec.rowId))) {
      this.sections = columnToSections(this.sheet, col);
      this.render();
      return;
    }
    this.sections.forEach((sec, i) => {
      if (!sec.rowId) return;
      const text = rows.get(sec.rowId)!.cells[col]?.text ?? '';
      const area = this.dom.querySelector<HTMLTextAreaElement>(`.pmd-flow-docsec[data-section="${i}"]`);
      if (!area || area === active || area.value === text) return;
      this.sections[i] = { ...sec, text };
      area.value = text;
      autoGrow(area);
    });
  }

  // ─── Column document view ─────────────────────────────────────────

  private expand(col: number): void {
    this.expandedCol = col;
    this.sections = columnToSections(this.sheet, col);
    this.render();
    requestAnimationFrame(() => this.dom.querySelector<HTMLTextAreaElement>('.pmd-flow-docsec')?.focus());
  }

  private collapse(): void {
    const col = this.expandedCol ?? 0;
    this.expandedCol = null;
    this.sections = [];
    this.render({ row: 0, col, caret: 'end' });
  }

  private addSection(at: number): void {
    this.sections.splice(at, 0, { rowId: null, text: '' });
    this.render();
    requestAnimationFrame(() => this.dom.querySelector<HTMLTextAreaElement>(`.pmd-flow-docsec[data-section="${at}"]`)?.focus());
  }

  private focusSection(i: number, caret: number | 'end'): void {
    requestAnimationFrame(() => {
      const area = this.dom.querySelector<HTMLTextAreaElement>(`.pmd-flow-docsec[data-section="${i}"]`);
      if (!area) return;
      area.focus();
      const at = caret === 'end' ? area.value.length : Math.min(caret, area.value.length);
      area.setSelectionRange(at, at);
    });
  }

  /** Enter in document view: text after the caret becomes the next argument. */
  private splitSection(i: number, start: number, end: number): void {
    const text = this.sections[i]!.text;
    this.sections[i] = { ...this.sections[i]!, text: text.slice(0, start) };
    this.sections.splice(i + 1, 0, { rowId: null, text: text.slice(end) });
    this.commitSections();
    this.render();
    this.focusSection(i + 1, 0);
  }

  /** Backspace at the start of an argument joins it onto the one above. */
  private mergeWithPrevious(i: number): void {
    const prev = this.sections[i - 1]!;
    const join = prev.text.length;
    this.sections[i - 1] = { ...prev, text: prev.text + this.sections[i]!.text };
    this.sections.splice(i, 1);
    this.commitSections();
    this.render();
    this.focusSection(i - 1, join);
  }

  /** Paste of several lines: each line becomes its own argument. */
  private insertLines(i: number, start: number, end: number, pasted: string): void {
    const text = this.sections[i]!.text;
    const lines = pasted.replace(/\r\n?/g, '\n').split('\n');
    const first = text.slice(0, start) + lines[0];
    const last = lines[lines.length - 1]! + text.slice(end);
    const middle = lines.slice(1, -1);
    this.sections[i] = { ...this.sections[i]!, text: lines.length === 1 ? first + text.slice(end) : first };
    const added = lines.length === 1 ? [] : [...middle, last].map((t) => ({ rowId: null, text: t }));
    this.sections.splice(i + 1, 0, ...added);
    this.commitSections();
    this.render();
    this.focusSection(i + added.length, lines.length === 1 ? first.length : lines[lines.length - 1]!.length);
  }

  /** Turn every line of every argument into its own argument. */
  private splitAllLines(): void {
    const next: ColumnSection[] = [];
    for (const sec of this.sections) {
      const lines = sec.text.split('\n').filter((l, k, all) => l.trim() !== '' || all.length === 1);
      lines.forEach((line, k) => next.push({ rowId: k === 0 ? sec.rowId : null, text: line }));
    }
    this.sections = next;
    this.commitSections();
    this.render();
  }

  /** Write the sections back and learn the row ids of newly created ones.
   *  Blank arguments keep their row, so a gap left here stays in the sheet. */
  private commitSections(): void {
    const col = this.expandedCol;
    if (col === null) return;
    const { sheet: next, rowIds } = placeColumnSections(this.sheet, col, this.sections);
    this.sections = this.sections.map((s, i) => ({ ...s, rowId: rowIds[i] ?? s.rowId }));
    this.commit({ ...this.book, sheets: this.book.sheets.map((s) => (s.id === next.id ? next : s)) });
  }

  // Selection is local UI state keyed by stable row id, never cell text offsets.
  private visibleColumns(): ColKey[] {
    const cols: ColKey[] = [];
    for (let col = 0; col < this.sheet.columns.length; col++) { cols.push(col); if (col === this.prepAfter) cols.push('prep'); }
    return cols;
  }
  private cellKey(row: number, col: ColKey): string { return `${this.sheet.rows[row]!.id}\u0000${col}`; }
  private resetCellSelection(): void { this.selectedCells.clear(); this.rangeSelection = false; this.selectionAnchor = null; this.lastCell = null; this.lastSel = {start: 0, end: 0}; }
  private selectSingleCell(row: number, col: ColKey): void {
    const key = this.cellKey(row, col);
    if (!this.rangeSelection && this.selectedCells.size === 1 && this.selectedCells.has(key)) return;
    this.rangeSelection = false;
    this.selectedCells = new Set([key]);
    this.selectionAnchor = {rowId: this.sheet.rows[row]!.id, col}; this.paintSelection();
  }
  private extendCellSelection(row: number, col: ColKey): void {
    this.rangeSelection = true;
    this.selectionAnchor ??= {rowId: this.sheet.rows[row]!.id, col};
    const anchor = Math.max(0, this.sheet.rows.findIndex(r => r.id === this.selectionAnchor!.rowId));
    const cols = this.visibleColumns(), a = Math.max(0, cols.indexOf(this.selectionAnchor.col)), b = cols.indexOf(col);
    this.selectedCells.clear();
    for (let r = Math.min(row, anchor); r <= Math.max(row, anchor); r++) for (let c = Math.min(a, b); c <= Math.max(a, b); c++) this.selectedCells.add(this.cellKey(r, cols[c]!));
    this.paintSelection();
  }
  private selectionTargets(): Array<{row: number; col: ColKey}> {
    const targets: Array<{row: number; col: ColKey}> = [];
    this.sheet.rows.forEach((_row, row) => { for (const col of this.visibleColumns()) if (this.selectedCells.has(this.cellKey(row, col))) targets.push({row, col}); });
    return targets;
  }
  private paintSelection(): void {
    const hadSelection = this.selectedCells.size > 0;
    this.selectedCells = new Set(this.selectionTargets().map(spot => this.cellKey(spot.row, spot.col)));
    if (hadSelection && !this.selectedCells.size) this.resetCellSelection();
    for (const area of Array.from(this.dom.querySelectorAll<HTMLTextAreaElement>('textarea.pmd-flow-cell'))) {
      const row = Number(area.dataset['row']), col = parseCol(area.dataset['col']);
      const selected = !!this.sheet.rows[row] && this.selectedCells.has(this.cellKey(row, col));
      const td = area.closest('td'); td?.classList.toggle('pmd-flow-cell-selected', selected);
      if (td && td.getAttribute('role') !== 'gridcell') td.setAttribute('role', 'gridcell');
      if (td && td.getAttribute('aria-selected') !== String(selected)) td.setAttribute('aria-selected', String(selected));
    }
  }
  private clearSelectedCells(): void {
    const targets = this.selectionTargets();
    if (!targets.length && !this.selectedCells.size && this.lastCell && this.lastCell.row < this.sheet.rows.length) targets.push(this.lastCell);
    if (!targets.length) return;
    let book = this.book;
    for (const {row, col} of targets) {
      const patch = {text: '', hl: []};
      book = col === 'prep' ? setPrep(book, this.sheetId, row, patch) : setCell(book, this.sheetId, row, col, patch);
    }
    this.commit(book); this.render();
    this.focusCell({...targets[0]!, caret: 'end'});
  }

  // ─── Cell keys ────────────────────────────────────────────────────

  private onCellKey(e: KeyboardEvent, area: HTMLTextAreaElement, row: number, col: ColKey): void {
    const cols = this.sheet.columns.length;
    const mod = modKey(e);
    const key = e.key;
    const k = key.toLowerCase();
    if (this.selectedCells.size > 1 && (key === 'Delete' || key === 'Backspace') && !mod && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); this.clearSelectedCells(); return;
    }
    if (e.shiftKey && !mod && !e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key) &&
        (this.rangeSelection || area.selectionStart === area.selectionEnd && (['ArrowUp', 'ArrowLeft'].includes(key) ? area.selectionStart === 0 : area.selectionEnd === area.value.length))) {
      const columns = this.visibleColumns();
      const nextRow = Math.max(0, Math.min(this.sheet.rows.length - 1, row + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0)));
      const nextCol = columns[Math.max(0, Math.min(columns.length - 1, columns.indexOf(col) + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0)))]!;
      e.preventDefault();
      this.selectionAnchor ??= {rowId: this.sheet.rows[row]!.id, col};
      this.extendCellSelection(nextRow, nextCol);
      this.focusCell({row: nextRow, col: nextCol, caret: 'end'}); return;
    }
    if (key === 'Escape' && this.selectedCells.size > 1) { e.preventDefault(); this.selectSingleCell(row, col); return; }
    if (flowKeyForEvent(e) === this.theme.highlightKey) {
      e.preventDefault(); e.stopPropagation(); this.toggleHighlight(row, col, area.selectionStart, area.selectionEnd); return;
    }
    const toggle = (flag: 'bold' | 'crossed' | 'extended'): void => {
      e.preventDefault();
      const cell = this.cellOf(row, col);
      this.commit(this.withCell(row, col, { [flag]: !cell[flag] }));
      this.styleCell(area, this.cellOf(row, col));
    };
    if (mod && !e.shiftKey && k === 'b') return toggle('bold');
    if (mod && e.shiftKey && k === 'x') return toggle('crossed');
    if (mod && e.shiftKey && k === 'l') return toggle('extended');
    if (mod && e.shiftKey && k === 'p') {
      e.preventDefault();
      this.togglePrep(col === 'prep' ? this.prepAfter ?? 0 : col);
      return;
    }
    if (mod && e.shiftKey && k === 'e') {
      e.preventDefault();
      if (typeof col === 'number') this.expand(col);
      return;
    }
    if (mod && key === 'Enter') {
      e.preventDefault();
      this.commit(insertRows(this.book, this.sheetId, row + 1));
      this.render({ row: row + 1, col, caret: 'end' });
      return;
    }
    if (mod && e.shiftKey && key === 'Backspace') {
      e.preventDefault();
      this.commit(deleteRows(this.book, this.sheetId, row));
      this.render({ row: Math.max(0, Math.min(row, this.sheet.rows.length - 1)), col, caret: 'end' });
      return;
    }
    if (key === 'Enter' && !e.shiftKey && !mod && !e.altKey) {
      e.preventDefault();
      this.move(row + 1, col);
      return;
    }
    if (key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      // Visual order: speech columns, with Prep right after `prepAfter` when shown.
      const order: ColKey[] = [];
      for (let c = 0; c < cols; c++) {
        order.push(c);
        if (c === this.prepAfter) order.push('prep');
      }
      const next = order[order.indexOf(col) + (e.shiftKey ? -1 : 1)];
      if (next !== undefined) this.move(row, next);
      return;
    }
    if (key === 'ArrowUp' && !e.shiftKey && !mod && area.selectionStart === 0 && area.selectionEnd === 0) {
      if (row > 0) {
        e.preventDefault();
        this.move(row - 1, col);
      }
      return;
    }
    if (key === 'ArrowDown' && !e.shiftKey && !mod && area.selectionStart === area.value.length) {
      e.preventDefault();
      this.move(row + 1, col);
    }
  }

  /** Focus a cell, adding rows when moving past the bottom. */
  private move(row: number, col: ColKey): void {
    this.resetCellSelection();
    if (row >= this.sheet.rows.length) {
      const oldLength = this.sheet.rows.length;
      const body = this.dom.querySelector<HTMLTableSectionElement>('.pmd-flow-grid tbody');
      this.commit(insertRows(this.book, this.sheetId, oldLength, row - oldLength + 1));
      // A rejected transaction can re-render or leave the old model unchanged.
      if (!body?.isConnected || this.sheet.rows.length <= oldLength) return;
      if (body.rows.length !== oldLength) { this.render({ row, col, caret: 'end' }); return; }
      const prepAfter = this.prepAfter !== null && this.prepAfter < this.sheet.columns.length ? this.prepAfter : null;
      const added = document.createDocumentFragment();
      for (let r = oldLength; r < this.sheet.rows.length; r++) added.appendChild(this.renderRow(r, prepAfter));
      body.appendChild(added);
      this.focusCell({ row, col, caret: 'end' });
      return;
    }
    this.focusCell({ row, col, caret: 'end' });
  }

  private focusCell(spot: FocusSpot): void {
    const area = this.dom.querySelector<HTMLTextAreaElement>(`textarea.pmd-flow-cell[data-row="${spot.row}"][data-col="${colAttr(spot.col)}"]`);
    if (!area) return;
    area.focus();
    const at = spot.caret === 'end' ? area.value.length : Math.min(spot.caret, area.value.length);
    area.setSelectionRange(at, at);
  }

  private currentFocus(): FocusSpot | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) || !this.dom.contains(active) || !active.dataset['row']) return null;
    return { row: Number(active.dataset['row']), col: parseCol(active.dataset['col']), caret: active.selectionStart };
  }

  // ─── Sheets ───────────────────────────────────────────────────────

  private add(side: 'aff' | 'neg'): void {
    const name = side === 'neg' ? nextOffName(this.book) : `${sideName(this.book.event, 'aff')} ${this.book.sheets.filter((s) => s.side === 'aff').length + 1}`;
    const { book, sheetId } = addSheet(this.book, name, side, this.sheetId);
    this.sheetId = sheetId;
    this.resetCellSelection();
    this.expandedCol = null;
    this.commit(book);
    this.render({ row: 0, col: 0, caret: 'end' });
  }

  private async rename(sheet: FlowSheet): Promise<void> {
    const name = await promptForText({ message: 'Rename sheet', initial: sheet.name });
    if (name === null) return;
    this.commit(renameSheet(this.book, sheet.id, name));
    this.render();
  }

  private async removeSheet(): Promise<void> {
    if (this.book.sheets.length < 2) return;
    const sheet = this.sheet;
    const hasText = sheet.rows.some((r) => r.cells.some((c) => c.text.trim()) || !!r.prep?.text.trim());
    if (hasText && !(await confirmDialog(`Delete the sheet “${sheet.name}”? Undo (Ctrl+Z / Cmd+Z) brings it back.`))) return;
    const index = this.book.sheets.findIndex((s) => s.id === sheet.id);
    const next = deleteSheet(this.book, sheet.id);
    this.sheetId = next.sheets[Math.max(0, index - 1)]!.id;
    this.resetCellSelection();
    this.expandedCol = null;
    this.commit(next);
    this.render();
  }
}

/** NodeView factory map — merged into the editor's `nodeViews`. */
export const flowNodeViews = {
  flow_workbook: (node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView =>
    new FlowWorkbookView(node, view, getPos),
};
