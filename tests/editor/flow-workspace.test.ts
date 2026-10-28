// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AllSelection, EditorState, NodeSelection } from 'prosemirror-state';
import { schema } from '../../src/schema/index.js';
import { newWorkbook, serializeFlow } from '../../src/flow/flow-model.js';
import { flowWorkspacePlugin, isFlowWorkspace } from '../../src/editor/flow-workspace.js';
import { markSyncOrigin } from '../../src/editor/sync-origin.js';
const flow = () => schema.nodes.flow_workbook!.create({data: serializeFlow(newWorkbook())});
const blank = () => schema.nodes.paragraph!.create();
describe('standalone Flow workspace', () => {
  it('fills the surface only for a Flow with otherwise blank cursor paragraphs', () => {
    expect(isFlowWorkspace(schema.nodes.doc!.create(null, [flow(), blank()]))).toBe(true);
    expect(isFlowWorkspace(schema.nodes.doc!.create(null, [flow(), schema.nodes.paragraph!.create(null, schema.text('Notes'))]))).toBe(false);
    expect(isFlowWorkspace(schema.nodes.doc!.create(null, [blank()]))).toBe(false);
    expect(NodeSelection.isSelectable(flow())).toBe(false);
  });
  it('rejects select-all Delete and replacement that would remove the workbook', () => {
    const doc = schema.nodes.doc!.create(null, [flow(), blank()]);
    const state = EditorState.create({doc, plugins: [flowWorkspacePlugin()]});
    const tr = state.tr.setSelection(new AllSelection(doc)).deleteSelection();
    expect(state.applyTransaction(tr).transactions).toHaveLength(0);
    expect(state.applyTransaction(state.tr.replaceWith(0, doc.content.size, blank())).transactions).toHaveLength(0);
  });
  it('protects a Flow introduced into a previously ordinary document', () => {
    let state = EditorState.create({doc:schema.nodes.doc!.create(null,[blank()]),plugins:[flowWorkspacePlugin()]});
    state = state.apply(state.tr.replaceWith(0,state.doc.content.size,[flow(),blank()]));
    expect(state.applyTransaction(state.tr.replaceWith(0,state.doc.content.size,blank())).transactions).toHaveLength(0);
  });
  it('admits already merged remote removals and ordinary cell updates', () => {
    const doc = schema.nodes.doc!.create(null, [flow(), blank()]);
    const state = EditorState.create({doc, plugins: [flowWorkspacePlugin()]});
    expect(state.applyTransaction(markSyncOrigin(state.tr.replaceWith(0, doc.content.size, blank()))).transactions).toHaveLength(1);
    expect(state.applyTransaction(state.tr.setNodeMarkup(0, undefined, {data: serializeFlow(newWorkbook('policy'))})).transactions).toHaveLength(1);
  });
});
