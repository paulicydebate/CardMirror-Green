/** Per-document enforcement shared by single-window, pane and flow editors.
 * The controller supplies policy; until it does, this plugin is inert. This is
 * an in-app guard, not an OS clipboard lock or a tamper-proof environment.
 */
import { Plugin, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { isHistoryTransaction } from 'prosemirror-history';
import { isSyncOrigin } from './sync-origin.js';
import { parseFlow } from '../flow/flow-model.js';
import { registerPrepView, prepRuntime } from './prep-runtime.js';

export const PREP_EXPANSION_META = 'prepExpansion';
export const PREP_INSERT_LIMIT = 40;
export interface PrepGuardEvent {
  kind: 'blocked' | 'change' | 'macro' | 'autocorrect' | 'undo-redo' | 'remote-change';
  reason?: string;
  inserted?: string[];
  deleted?: number;
  flagged?: boolean;
}
export interface PrepGuardPolicy {
  isPrepDocument(uid: string): boolean;
  loggingFailed(): boolean;
  audit(uid: string, event: PrepGuardEvent): void;
  notify(message: string): void;
}
let currentPolicy: PrepGuardPolicy | null = null;
/** For the eventual renderer controller, not a user-facing mode switch. */
export function configurePrepGuards(policy: PrepGuardPolicy | null): void { currentPolicy = policy; }

interface TextChange { inserted: string; deleted: number }
function changedText(before: string, after: string): TextChange {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { inserted: after.slice(from, newEnd), deleted: oldEnd - from };
}

/** Flow text is in an atom attribute, invisible to textBetween/StepMap.
 * Compare by sheet/row identity so ordinary cell edits and formatting do not
 * count every other cell as inserted text. New rows/sheets still count.
 */
const flowFieldCache = new WeakMap<PMNode, Map<string, string>>();
function flowText(node: PMNode): Map<string, string> {
  const cached = flowFieldCache.get(node);
  if (cached) return cached;
  const fields = new Map<string, string>();
  const book = parseFlow(String(node.attrs['data']), 0);
  for (const sheet of book.sheets) {
    const key = JSON.stringify(sheet.id);
    fields.set(key + ':name', sheet.name);
    sheet.columns.forEach((name, col) => fields.set(key + ':column:' + col, name));
    for (const row of sheet.rows) {
      const rowKey = key + ':' + JSON.stringify(row.id);
      row.cells.forEach((cell, col) => fields.set(rowKey + ':' + col, cell.text));
      fields.set(rowKey + ':prep', row.prep?.text ?? '');
    }
  }
  flowFieldCache.set(node, fields);
  return fields;
}

function flowNodes(doc: PMNode): PMNode[] {
  const nodes: PMNode[] = [];
  doc.descendants(node => { if (node.type.name === 'flow_workbook') { nodes.push(node); return false; } return undefined; });
  return nodes;
}

/** Counts additions, not net document growth: a 500-character replacement
 * cannot escape the cap by deleting 500 characters in the same transaction.
 * Sum every step/cell so many small inserts cannot evade the per-tx cap.
 */
export function prepTransactionChanges(tr: Transaction): TextChange[] {
  const changes: TextChange[] = [];
  tr.steps.forEach((step, i) => {
    const before = tr.docs[i]!;
    const after = tr.docs[i + 1] ?? tr.doc;
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      changes.push(changedText(before.textBetween(oldStart, oldEnd, '\n'), after.textBetween(newStart, newEnd, '\n')));
    });
    // AttrStep has an empty map. Inspect flow attrs even when there is no
    // mapped range (setNodeMarkup and future programmatic flow insertions).
    const oldNodes = flowNodes(before), newNodes = flowNodes(after);
    for (let n = 0; n < Math.max(oldNodes.length, newNodes.length); n++) {
      const oldNode = oldNodes[n], newNode = newNodes[n];
      if (oldNode === newNode || (oldNode && newNode && oldNode.attrs['data'] === newNode.attrs['data'])) continue;
      const oldFlows = oldNode ? flowText(oldNode) : new Map<string, string>();
      const newFlows = newNode ? flowText(newNode) : new Map<string, string>();
      for (const key of new Set([...oldFlows.keys(), ...newFlows.keys()])) {
        changes.push(changedText(oldFlows.get(key) ?? '', newFlows.get(key) ?? ''));
      }
    }
  });
  return changes.filter(c => c.inserted || c.deleted);
}

const blockedInputTypes = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank', 'deleteByCut', 'insertFromCompositionPaste']);

/** Build for the owning document's stable session uid, never the focused uid.
 * This makes send-to-speech / background-pane inserts use the destination's
 * policy. DOM capture catches flow textareas and column-as-document editors.
 */
export function prepDocumentGuard(uid: string | null | undefined, policy: () => PrepGuardPolicy | null = () => currentPolicy): Plugin {
  const protectedPolicy = (): PrepGuardPolicy | null => {
    const p = policy();
    return uid && p?.isPrepDocument(uid) ? p : null;
  };
  const refuse = (p: PrepGuardPolicy, reason: string): void => {
    p.audit(uid!, { kind: 'blocked', reason });
    p.notify('Prep document: ' + reason);
  };
  return new Plugin({
    filterTransaction(tr) {
      const p = protectedPolicy();
      if (!p || !tr.docChanged) return true;
      // Already-merged CRDT state must not be rejected or peers diverge. The
      // collaboration protocol must gate prep membership; large remote edits
      // are admitted and flagged in the accepted-transaction audit below.
      if (isSyncOrigin(tr)) return true;
      if (p.loggingFailed()) { refuse(p, 'Editing paused because the typing log is unavailable.'); return false; }
      if (['paste', 'drop', 'cut'].includes(String(tr.getMeta('uiEvent')))) {
        refuse(p, 'Clipboard and drag transfers are blocked.'); return false;
      }
      const expansion = tr.getMeta(PREP_EXPANSION_META);
      if (expansion === 'macro' || expansion === 'autocorrect' || isHistoryTransaction(tr)) return true;
      let added: number;
      try { added = prepTransactionChanges(tr).reduce((n, c) => n + c.inserted.length, 0); }
      catch {
        refuse(p, 'An unreadable flow change was blocked.');
        return false;
      }
      if (added <= PREP_INSERT_LIMIT) return true;
      refuse(p, 'Large inserts are blocked. Type the text into this document.');
      return false;
    },
    state: {
      init: () => null,
      apply(tr, value) {
        const p = protectedPolicy();
        if (!p || !tr.docChanged) return value;
        let changes: TextChange[];
        try { changes = prepTransactionChanges(tr); }
        catch {
          // Remote content is already committed to the CRDT. Keep the local
          // view in sync and flag it rather than throwing during state.apply.
          p.audit(uid!, { kind: 'remote-change', reason: 'Unreadable flow content received.', flagged: true });
          return value;
        }
        const inserted = changes.map(c => c.inserted).filter(Boolean);
        const deleted = changes.reduce((n, c) => n + c.deleted, 0);
        if (!inserted.length && !deleted) return value;
        const expansion = tr.getMeta(PREP_EXPANSION_META);
        const kind = isSyncOrigin(tr) ? 'remote-change' : isHistoryTransaction(tr) ? 'undo-redo' :
          expansion === 'macro' || expansion === 'autocorrect' ? expansion : 'change';
        p.audit(uid!, { kind, inserted, deleted, flagged: inserted.join('').length > PREP_INSERT_LIMIT });
        return value;
      },
    },
    view(view) {
      const unregister = uid ? registerPrepView(uid, view) : () => {};
      // Window capture precedes target/NodeView handlers and ProseMirror's
      // handlers. Each instance only handles its own root, so another pane's
      // strategy doc and unrelated UI fields stay unrestricted.
      const win = view.dom.ownerDocument.defaultView;
      const capture = (event: Event): void => {
        const p = protectedPolicy();
        if (!p || !event.composedPath().includes(view.dom)) return;
        if (event.type === 'beforeinput') {
          const input = event as InputEvent;
          if (!blockedInputTypes.has(input.inputType) && !p.loggingFailed()) {
            prepRuntime.record('input', uid!, { phase: 'beforeinput', inputType: input.inputType, text: input.data,
              composing: input.isComposing, clientTime: new Date().toISOString() });
            return;
          }
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'dragover') return; // avoid flooding the log on every pointer move
        refuse(p, event.type === 'beforeinput' ? 'This input method is blocked.' : `${event.type} is blocked.`);
      };
      const types = ['copy', 'cut', 'paste', 'dragstart', 'dragover', 'drop', 'beforeinput'];
      for (const type of types) win?.addEventListener(type, capture, true);
      return { destroy() { unregister(); for (const type of types) win?.removeEventListener(type, capture, true); } };
    },
  });
}
