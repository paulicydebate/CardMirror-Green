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

  constructor(node: PMNode, private readonly view: EditorView, private readonly getPos: () => number | undefined) {
    this.dom = el('div', 'pmd-flow-root');
    this.dom.contentEditable = 'false';
    this.lastData = String(node.attrs['data'] ?? '');
    this.book = this.parse(this.lastData);
    this.sheetId = this.book.sheets[0]!.id;
    this.render();
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
    this.dom.replaceChildren(this.renderTabs(), this.expandedCol === null ? this.renderGrid() : this.renderColumnDoc());
    requestAnimationFrame(() => {
      this.dom.querySelectorAll('textarea').forEach((t) => autoGrow(t));
      if (focus) this.focusCell(focus);
    });
  }

  private renderTabs(): HTMLElement {
    const bar = el('div', 'pmd-flow-tabs');
    bar.setAttribute('role', 'tablist');
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
    const ev = FLOW_FORMATS[this.book.event];
    const addAff = el('button', 'pmd-flow-add', `+ ${sideName(this.book.event, 'aff')}`);
    addAff.type = 'button';
    addAff.title = `New ${sideName(this.book.event, 'aff')} sheet`;
    addAff.addEventListener('click', () => this.add('aff'));
    const addNeg = el('button', 'pmd-flow-add', `+ ${sideName(this.book.event, 'neg')}`);
    addNeg.type = 'button';
    addNeg.title = `New ${sideName(this.book.event, 'neg')} sheet`;
    addNeg.addEventListener('click', () => this.add('neg'));
    const del = el('button', 'pmd-flow-add pmd-flow-del', 'Delete sheet');
    del.type = 'button';
    del.disabled = this.book.sheets.length < 2;
    del.addEventListener('click', () => void this.removeSheet());
    const label = el('span', 'pmd-flow-event', ev?.label ?? 'Custom');
    bar.append(addAff, addNeg, del, label);
    return bar;
  }

  private renderGrid(): HTMLElement {
    const sheet = this.sheet;
    const wrap = el('div', 'pmd-flow-gridwrap');
    const table = el('table', 'pmd-flow-grid');
    const head = el('tr');
    sheet.columns.forEach((name, col) => {
      const th = el('th', `pmd-flow-head pmd-flow-side-${columnSide(this.book.event, sheet, col)}`, name);
      th.title = 'Double-click to open this speech as a document';
      th.addEventListener('dblclick', () => this.expand(col));
      head.appendChild(th);
    });
    table.appendChild(el('thead')).appendChild(head);
    const body = el('tbody');
    sheet.rows.forEach((row, r) => {
      const tr = el('tr');
      sheet.columns.forEach((_, col) => {
        const td = el('td', `pmd-flow-td pmd-flow-side-${columnSide(this.book.event, sheet, col)}`);
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
    return area;
  }

  private renderColumnDoc(): HTMLElement {
    const col = this.expandedCol!;
    const sheet = this.sheet;
    const wrap = el('div', `pmd-flow-doc pmd-flow-side-${columnSide(this.book.event, sheet, col)}`);
    const bar = el('div', 'pmd-flow-docbar');
    bar.appendChild(el('strong', undefined, `${sheet.columns[col]} — ${sheet.name}`));
    const back = el('button', 'pmd-flow-add', 'Back to spreadsheet');
    back.type = 'button';
    back.title = 'Escape';
    back.addEventListener('click', () => this.collapse());
    bar.appendChild(back);
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
        if (e.key === 'Escape' || (modKey(e) && e.shiftKey && e.key.toLowerCase() === 'e')) {
          e.preventDefault();
          this.collapse();
        } else if (modKey(e) && e.key === 'Enter') {
          e.preventDefault();
          this.addSection(i + 1);
        }
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
