# Lockdown Mode and typing log: viability and plan

Status (2026-10-26): assessed, not built. Requested by the user's colleagues for NPDA rounds, where copy-paste is banned during prep.

## Requests

1. **Lockdown Mode.** One command when a round starts. Every CardMirror window gets a colored border (red or yellow). While it is on, copy and paste are disabled and every co-editing session is disconnected.
2. **A typing log.** A history detailed enough to check that text was typed, not pasted.

## Verdict

Both are viable in the desktop app. Lockdown is medium-sized and the log is medium-sized; build lockdown first, because the log uses its hooks.

Limit to state plainly to users: this proves what happened **inside CardMirror**. It cannot stop someone reading another app or a second device and retyping the text. The log also cannot be made fully tamper-proof on the debater's own computer. The "seal code" below makes later edits detectable, which is the realistic goal.

## Why it is viable

- The main process can hold one lockdown state for all windows. The app already broadcasts across windows, and new windows ask main for the state at boot.
- Each window can block clipboard events in one place:
  - Capture-phase listeners on `window` for `copy`, `cut`, `paste`, `drop` and `dragstart`.
  - `beforeinput` with `inputType` `insertFromPaste`, `insertFromDrop`, `deleteByCut`, `insertFromYank` or `insertFromPasteAsQuotation`.
  - Running before element handlers, this covers ProseMirror, flow cells and the flow document view (which handles paste itself), and search fields.
  - Menu roles (Edit → Paste) fire DOM paste events, so they are blocked too.
- The main-process clipboard handlers can refuse while locked: `host:clipboard-read-text`, `host:clipboard-read-html`, `host:clipboard-write-html` and `host:voice-clipboard` in `apps/desktop/src/main.ts`. Also patch `navigator.clipboard.*` in the renderer.
- `beforeinput` reports every typed insertion (`insertText` plus its data, IME composition, autocorrect replacement, undo and redo) for both the editor and the textareas. That gives a keystroke-level log without touching each feature.

## The hard part: paste is not the only way content gets in

CardMirror has many features that move existing text into a document. These are effectively paste and must be blocked or logged, or lockdown is easy to get around:

| Feature | Where |
|---|---|
| Send to speech doc | `speech-doc-send.ts` |
| Card search and quick cards | `quick-card-*`, `file-search*` |
| External insert (Fast Debate Paste) | `apps/desktop/src/fast-paste-bridge.ts`, `src/editor/external-insert*.ts` |
| Verbatim Flow send/pull | `apps/desktop/src/flow-bridge.ts` |
| Drag between panes and docs | `drag-controller.ts`, `drag-editor-surface.ts`, `dropzone-*` |
| Transclusion | `transclusion*`, `self-transclusion*` |
| Keyboard macros and autocorrect expansions | `keyboard-macros.ts`, `custom-autocorrect-plugin.ts` |
| Other inserts | OpenCaselist, chat cut, extract card, absorb, image insert, voice |

Recommended catch-all: a ProseMirror `filterTransaction` plugin added to every editor. While locked, it rejects any document change that adds more than about 40 characters of text in one transaction, unless it is undo/redo or carries an explicit allow meta. Typing never adds that much at once. It shows a toast and logs the blocked attempt. Then also refuse the main-process routes (fast-paste `/insert`, flow-bridge pull/send) so outside apps get a clear "lockdown" error.

Undo and redo can restore text deleted before lockdown started. Log large undo/redo restores as flagged rather than blocking them.

Flows: a flow's text lives in an atom's `data` attr, so the transaction filter does not see it. Flow cells are textareas, which the `beforeinput` and clipboard listeners already cover. There is no programmatic flow insert yet. If "send to flow" is built, it must check lockdown.

## Co-editing

When lockdown starts, every window leaves its co-edit sessions (`src/editor/collab/collab-session.ts` and `collab-ui.ts`). While locked, starting or joining is refused (`collab-gate.ts`). Check whether phone pairing (`apps/desktop/src/pairing-*`, `src/editor/pairing`) and the relay (`relay-stream.ts`) need the same treatment.

## Typing log design

- **Format:** main writes an append-only JSON Lines file per session at `{userData}/lockdown/<start>.jsonl`. Renderers send batched events every 500 ms over IPC.
- **Fields per line:** `seq`, ISO time, window, document name, kind, data, `prev` hash, `hash`. Each hash is SHA-256 of `prev` plus the entry, which forms a hash chain.
- **Events recorded:**
  - Lockdown start and end.
  - Co-edit sessions ended.
  - Every typed insertion with its characters, and deletions (counts).
  - Undo/redo.
  - Blocked copy/paste/drop/insert attempts.
  - Large transactions.
  - Documents opened, closed and saved.
  - CardMirror losing and regaining focus, which shows time spent in other apps (main: `browser-window-blur` / `browser-window-focus`).
  - App quit and restart.
- **Seal code:** when lockdown ends, show a short code from the final hash (for example `7F3A-91C2`) for the judge or opponent to note. Any later edit to the log changes the chain, so the code no longer matches.
- **Restarts:** the state is saved in `{userData}/lockdown/state.json`. Quitting or crashing does not end lockdown; on restart the app resumes it and logs the restart.
- **Viewer:** a "Lockdown Logs" command lists sessions. For each it shows:
  - Duration, characters typed, typing speed over time, blocked attempts, flagged large insertions and time outside CardMirror.
  - Whether the chain verifies, and the seal code.
  - A filterable event list and Export.
  - Later: a replay that rebuilds the typing.
- **Privacy:** the log contains what was typed. It stays on the computer unless the debater exports it.

## Interface

- **Commands:** "Start Lockdown" and "End Lockdown", plus a ribbon button.
- **Ending:** End needs a confirmation, and the end is recorded.
- **Indicator:** a fixed, click-through red border on every window, plus a small banner showing elapsed time and an End button.
- **Web and mobile:** the browser builds show "desktop app only".

## Open questions for the user

1. Should opening other files be allowed during lockdown? The default proposal is to allow it but log it.
2. Can the debater end lockdown themselves? The proposal is yes, with confirmation and logging.
3. Border color: red or yellow?
4. Should keyboard macros and autocorrect expansions be blocked, or only logged?

## Suggested build order

1. Main-process state, broadcast, border and banner, commands.
2. Capture listeners plus main clipboard refusals.
3. Co-edit disconnect and block.
4. Transaction filter plus external routes.
5. Log writer with hash chain, then focus events, then the viewer and seal code.

Test with Playwright `_electron`: try paste, drag, send-to-speech and external insert while locked across two windows and three-pane mode, then check the log chain.
