/**
 * The CardMirror mark in the status bar's bottom-right corner: a drag
 * handle for the focused document's file. Drag it into Slack, Mail,
 * Teams, Finder or Explorer and the OS receives the saved file — the
 * cross-platform counterpart of the macOS title-bar proxy icon (which
 * Windows and Linux lack). A click reveals the file in the file manager.
 *
 * Desktop only: the web build has no file paths, so the mark stays
 * hidden there (and on a packaged shell too old to start a native drag).
 * Dimmed while the focused doc has no file on disk — untitled, a
 * recovered draft, the home screen — because what travels is the file
 * as saved.
 *
 * The drag itself is Electron's `webContents.startDrag`, which must be
 * triggered from the renderer's own `dragstart` (see `host:drag-file-out`
 * in main.ts); the mark image doubles as the drag icon (Windows insists
 * on one).
 */

/** The folder mark from logo.png, wordmark cropped off, background
 *  transparent, 48px — the status-bar glyph and the drag icon. Recipe
 *  (Pillow): bounding box by color SATURATION so the black wordmark
 *  never counts, flood-fill the white corners to transparent, drop any
 *  leftover grey, square canvas, LANCZOS to 48px. */
export const FILE_MARK_DATA_URL =
  'data:image/png;base64,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';

export interface FileDragHost {
  /** False on a packaged shell whose preload predates the drag surface. */
  canDragFileOut(): boolean;
  dragFileOut(path: string, iconDataUrl: string): void;
  showItemInFolder?(path: string): Promise<void>;
}

export interface FileDragMarkState {
  hidden: boolean;
  /** Shown but dimmed and inert: no file on disk to hand out. */
  inert: boolean;
  title: string;
}

export const DRAG_TITLE = 'Drag to share this file · Click to show it in its folder';
export const INERT_TITLE = 'Save the document to share its file from here';

/** Pure: what the mark should show for a host + the focused doc's handle
 *  (the absolute path on desktop; null when there is no file). */
export function fileDragMarkState(host: FileDragHost | null, handle: unknown): FileDragMarkState {
  if (!host || !host.canDragFileOut()) return { hidden: true, inert: true, title: '' };
  const path = typeof handle === 'string' && handle.length > 0 ? handle : null;
  return path
    ? { hidden: false, inert: false, title: DRAG_TITLE }
    : { hidden: false, inert: true, title: INERT_TITLE };
}

/** Wire the mark element. Returns the sync function the window-title
 *  path calls with the focused doc's handle on every identity change. */
export function installFileDragMark(
  el: HTMLElement,
  getHost: () => FileDragHost | null,
): (handle: unknown) => void {
  let currentPath: string | null = null;
  el.style.backgroundImage = `url("${FILE_MARK_DATA_URL}")`;
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    // Electron: cancel the DOM drag and start the native one from here.
    e.preventDefault();
    const host = getHost();
    if (!host || !currentPath) return;
    host.dragFileOut(currentPath, FILE_MARK_DATA_URL);
  });
  el.addEventListener('click', () => {
    const host = getHost();
    if (!host || !currentPath) return;
    void host.showItemInFolder?.(currentPath);
  });
  return (handle: unknown): void => {
    const state = fileDragMarkState(getHost(), handle);
    currentPath = state.hidden || state.inert ? null : (handle as string);
    el.hidden = state.hidden;
    if (state.inert) el.dataset['inert'] = 'true';
    else delete el.dataset['inert'];
    el.title = state.title;
    el.setAttribute('aria-label', state.title || 'CardMirror');
    el.setAttribute('aria-disabled', state.inert ? 'true' : 'false');
  };
}
