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
  applyColumnSections,
  cellAt,
  columnSide,
  columnToSections,
  deleteRows,
  deleteSheet,
  FLOW_FORMATS,
  insertRows,
  newWorkbook,
  nextOffName,
  parseFlow,
  renameSheet,
  serializeFlow,
  setCell,
  sideName,
  type ColumnSection,
  type FlowCell,
  type FlowSheet,
  type FlowWorkbook,
} from '../flow/flow-model.js';
import { confirmDialog, promptForText } from './text-prompt.js';
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

interface FocusSpot { row: number; col: number; caret: number | 'end' }

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
    const sc = this.scroller();
    const visible = sc ? sc.clientHeight : window.innerHeight;
    const style = getComputedStyle(this.dom);
    const margins = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    const height = Math.max(360, Math.floor(visible - margins - 8));
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
    // Changed from outside (undo/redo/reload): re-read, keep the sheet and focus if possible.
    const focus = this.currentFocus();
    this.lastData = data;
    this.book = this.parse(data);
    if (!this.book.sheets.some((s) => s.id === this.sheetId)) this.sheetId = this.book.sheets[0]!.id;
    if (this.expandedCol !== null) this.sections = columnToSections(this.sheet, this.expandedCol);
    this.render(focus ?? undefined);
    return true;
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

  private commit(book: FlowWorkbook): void {
    this.book = book;
    const data = serializeFlow(book);
    if (data === this.lastData) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    this.lastData = data;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'flow_workbook') return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, data }));
  }

  // ─── Rendering ────────────────────────────────────────────────────

  private render(focus?: FocusSpot): void {
    const main = el('div', 'pmd-flow-main');
    main.append(this.renderTopbar(), this.expandedCol === null ? this.renderGrid() : this.renderColumnDoc());
    this.dom.replaceChildren(this.renderSidebar(), main);
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
      tab.title = 'Double-click to rename';
      tab.addEventListener('click', () => {
        if (this.sheetId === s.id) return;
        this.sheetId = s.id;
        this.expandedCol = null;
        this.render({ row: 0, col: 0, caret: 'end' });
      });
      tab.addEventListener('dblclick', () => void this.rename(s));
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
    bar.appendChild(el('div', `pmd-flow-title pmd-flow-side-${sheet.side}`, sheet.name));
    const tools = el('div', 'pmd-flow-tools');
    const onCell = (fn: (spot: FocusSpot) => void) => () => { if (this.lastCell) fn(this.lastCell); };
    const flag = (f: 'bold' | 'crossed' | 'extended') => onCell(({ row, col }) => {
      const cell = cellAt(this.sheet, row, col);
      this.commit(setCell(this.book, this.sheetId, row, col, { [f]: !cell[f] }));
      this.render({ row, col, caret: 'end' });
    });
    const inGrid = this.expandedCol === null;
    tools.append(
      this.tool('B', `Bold (${isMac ? 'Cmd' : 'Ctrl'}+B)`, flag('bold'), !inGrid),
      this.tool('S\u0336', `Cross out (${isMac ? 'Cmd' : 'Ctrl'}+Shift+X)`, flag('crossed'), !inGrid),
      this.tool('\u21A6', `Extend (${isMac ? 'Cmd' : 'Ctrl'}+Shift+L)`, flag('extended'), !inGrid),
      this.tool('+ Row', `Insert row below (${isMac ? 'Cmd' : 'Ctrl'}+Enter)`, onCell(({ row, col }) => {
        this.commit(insertRows(this.book, this.sheetId, row + 1));
        this.render({ row: row + 1, col, caret: 'end' });
      }), !inGrid),
      this.tool('\u2212 Row', `Delete row (${isMac ? 'Cmd' : 'Ctrl'}+Shift+Backspace)`, onCell(({ row, col }) => {
        this.commit(deleteRows(this.book, this.sheetId, row));
        this.render({ row: Math.max(0, Math.min(row, this.sheet.rows.length - 1)), col, caret: 'end' });
      }), !inGrid),
      this.tool(inGrid ? 'Open as doc' : 'Back to sheet', inGrid ? 'Open the current speech as a document (double-click a header)' : 'Back to the spreadsheet (Escape)', () => {
        if (inGrid) this.expand(this.lastCell?.col ?? 0);
        else this.collapse();
      }),
      this.tool('Appearance', 'Colors, text size and font', () => {
        this.appearanceOpen = !this.appearanceOpen;
        this.render();
      }),
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
    const head = el('tr');
    sheet.columns.forEach((name, col) => {
      const th = el('th', `pmd-flow-head pmd-flow-side-${columnSide(this.book.event, sheet, col)} pmd-flow-fill-${speechFillSlot(name, col)}${col % 2 ? ' pmd-flow-odd' : ''}`);
      th.appendChild(el('span', 'pmd-flow-chip', name));
      th.title = 'Double-click to open this speech as a document';
      th.addEventListener('dblclick', () => this.expand(col));
      head.appendChild(th);
    });
    table.appendChild(el('thead')).appendChild(head);
    const body = el('tbody');
    sheet.rows.forEach((row, r) => {
      const tr = el('tr');
      sheet.columns.forEach((_, col) => {
        const td = el('td', `pmd-flow-td pmd-flow-side-${columnSide(this.book.event, sheet, col)} pmd-flow-fill-${speechFillSlot(sheet.columns[col]!, col)}${col % 2 ? ' pmd-flow-odd' : ''}`);
        td.appendChild(this.renderCell(cellAt(sheet, r, col), r, col));
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  private renderCell(cell: FlowCell, row: number, col: number): HTMLTextAreaElement {
    const area = el('textarea', 'pmd-flow-cell');
    area.rows = 1;
    area.spellcheck = true;
    area.value = cell.text;
    area.dataset['row'] = String(row);
    area.dataset['col'] = String(col);
    area.setAttribute('aria-label', `${this.sheet.columns[col]} row ${row + 1}`);
    area.classList.toggle('pmd-flow-bold', !!cell.bold);
    area.classList.toggle('pmd-flow-crossed', !!cell.crossed);
    area.classList.toggle('pmd-flow-extended', !!cell.extended);
    area.addEventListener('input', () => {
      autoGrow(area);
      this.commit(setCell(this.book, this.sheetId, row, col, { text: area.value }));
    });
    area.addEventListener('keydown', (e) => this.onCellKey(e, area, row, col));
    area.addEventListener('focus', () => { this.lastCell = { row, col, caret: 'end' }; });
    return area;
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

  /** Write the sections back and learn the row ids of newly created ones. */
  private commitSections(): void {
    const col = this.expandedCol;
    if (col === null) return;
    const live = this.sections.filter((s) => s.rowId !== null || s.text.trim() !== '');
    const next = applyColumnSections(this.sheet, col, live);
    // New non-empty sections landed in rows; match them up in order.
    const filled = columnToSections(next, col);
    let k = 0;
    this.sections = this.sections.map((s) => {
      if (!s.text.trim()) return s;
      const hit = filled[k++];
      return hit ? { ...s, rowId: hit.rowId } : s;
    });
    this.commit({ ...this.book, sheets: this.book.sheets.map((s) => (s.id === next.id ? next : s)) });
  }

  // ─── Cell keys ────────────────────────────────────────────────────

  private onCellKey(e: KeyboardEvent, area: HTMLTextAreaElement, row: number, col: number): void {
    const cols = this.sheet.columns.length;
    const mod = modKey(e);
    const key = e.key;
    const toggle = (flag: 'bold' | 'crossed' | 'extended'): void => {
      e.preventDefault();
      const cell = cellAt(this.sheet, row, col);
      this.commit(setCell(this.book, this.sheetId, row, col, { [flag]: !cell[flag] }));
      area.classList.toggle(`pmd-flow-${flag}`, !cell[flag]);
    };
    if (mod && !e.shiftKey && key.toLowerCase() === 'b') return toggle('bold');
    if (mod && e.shiftKey && key.toLowerCase() === 'x') return toggle('crossed');
    if (mod && e.shiftKey && key.toLowerCase() === 'l') return toggle('extended');
    if (mod && e.shiftKey && key.toLowerCase() === 'e') {
      e.preventDefault();
      this.expand(col);
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
      const next = col + (e.shiftKey ? -1 : 1);
      if (next >= 0 && next < cols) this.move(row, next);
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
  private move(row: number, col: number): void {
    if (row >= this.sheet.rows.length) {
      this.commit(insertRows(this.book, this.sheetId, this.sheet.rows.length, row - this.sheet.rows.length + 1));
      this.render({ row, col, caret: 'end' });
      return;
    }
    this.focusCell({ row, col, caret: 'end' });
  }

  private focusCell(spot: FocusSpot): void {
    const area = this.dom.querySelector<HTMLTextAreaElement>(`.pmd-flow-cell[data-row="${spot.row}"][data-col="${spot.col}"]`);
    if (!area) return;
    area.focus();
    const at = spot.caret === 'end' ? area.value.length : Math.min(spot.caret, area.value.length);
    area.setSelectionRange(at, at);
  }

  private currentFocus(): FocusSpot | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) || !this.dom.contains(active) || !active.dataset['row']) return null;
    return { row: Number(active.dataset['row']), col: Number(active.dataset['col']), caret: active.selectionStart };
  }

  // ─── Sheets ───────────────────────────────────────────────────────

  private add(side: 'aff' | 'neg'): void {
    const name = side === 'neg' ? nextOffName(this.book) : `${sideName(this.book.event, 'aff')} ${this.book.sheets.filter((s) => s.side === 'aff').length + 1}`;
    const { book, sheetId } = addSheet(this.book, name, side, this.sheetId);
    this.sheetId = sheetId;
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
    const hasText = sheet.rows.some((r) => r.cells.some((c) => c.text.trim()));
    if (hasText && !(await confirmDialog(`Delete the sheet “${sheet.name}”? Undo (Ctrl+Z / Cmd+Z) brings it back.`))) return;
    const index = this.book.sheets.findIndex((s) => s.id === sheet.id);
    const next = deleteSheet(this.book, sheet.id);
    this.sheetId = next.sheets[Math.max(0, index - 1)]!.id;
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
