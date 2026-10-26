import type { EditorView } from 'prosemirror-view';
import type { PrepSessionState } from '../../apps/desktop/src/prep-session.js';
export interface PrepStatus { session: PrepSessionState | null; transitioning: boolean; error: string | null }
export const prepRuntime = { status: { session: null, transitioning: false, error: null } as PrepStatus,
  pending: new Set<string>(),
  focused: null as string | null, views: new Map<string, EditorView>(), changed: () => {},
  record: (_kind: string, _uid: string | null, _data: unknown): void => {} };
export function prepDoc(uid: string | null | undefined): boolean { return !!uid && (prepRuntime.pending.has(uid) || !!prepRuntime.status.session?.prepDocIds.includes(uid)); }
export function prepRound(): boolean { return prepRuntime.status.transitioning || prepRuntime.status.session?.mode === 'round' || !!prepRuntime.status.error; }
export function prepTransferBlocked(uid = prepRuntime.focused, reason = 'transfer'): boolean {
  if (!prepDoc(uid) && !prepRuntime.status.error) return false;
  prepRuntime.record('blocked', uid, { reason }); return true;
}
export function registerPrepView(uid: string, view: EditorView): () => void {
  prepRuntime.views.set(uid, view);
  view.dom.dataset['prepUid'] = uid;
  const focus = (): void => { prepRuntime.focused = uid; prepRuntime.changed(); };
  view.dom.addEventListener('focusin', focus);
  prepRuntime.changed();
  return () => {
    view.dom.removeEventListener('focusin', focus);
    if (prepRuntime.views.get(uid) === view) prepRuntime.views.delete(uid);
    if (prepRuntime.focused === uid) prepRuntime.focused = null;
    prepRuntime.changed();
  };
}
