/** Flow documents use a spreadsheet surface rather than a selectable page atom. */
import { Plugin, PluginKey } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import { isHistoryTransaction } from 'prosemirror-history';
import type { Node as PMNode, Fragment } from 'prosemirror-model';
import { isSyncOrigin } from './sync-origin.js';

export function isFlowWorkspace(doc: PMNode): boolean {
  let flows = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === 'flow_workbook') { if (++flows > 1) return false; }
    else if (node.type.name !== 'paragraph' || node.content.size > 0) return false;
  }
  return flows === 1;
}
const counts = new WeakMap<PMNode, number>();
function flowCount(node: PMNode): number {
  const cached = counts.get(node);
  if (cached !== undefined) return cached;
  const count = node.type.name === 'flow_workbook' ? 1 : fragmentFlows(node.content);
  counts.set(node, count);
  return count;
}
function fragmentFlows(content: Fragment): number {
  let count = 0;
  content.forEach(node => { count += flowCount(node); });
  return count;
}
const countKey = new PluginKey<number>('flow-workspace');
export function flowWorkspacePlugin(): Plugin<number> {
  return new Plugin<number>({
    key: countKey,
    state: {
      init: (_config, state) => flowCount(state.doc),
      apply(tr, count) {
        if (!tr.docChanged) return count;
        // Normal document typing should not scan thousands of evidence cards.
        // A replacement without a Flow in its slice cannot introduce one.
        if (!count && tr.steps.every(step => step instanceof ReplaceStep && fragmentFlows(step.slice.content) === 0)) return 0;
        return flowCount(tr.doc);
      },
    },
    props: { attributes: state => ({class: isFlowWorkspace(state.doc) ? 'pmd-flow-workspace' : ''}) },
    filterTransaction(tr, state) {
      // Imports have already merged. History must still be able to undo an
      // intentional Flow insertion; opening/closing documents replaces views.
      if (!tr.docChanged || isSyncOrigin(tr) || isHistoryTransaction(tr)) return true;
      const oldCount = countKey.getState(state) ?? 0;
      return !oldCount || flowCount(tr.doc) >= oldCount;
    },
  });
}
