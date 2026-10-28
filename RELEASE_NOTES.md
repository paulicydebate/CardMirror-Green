CardMirror Green 1.16.8 — Flow workspace improvements

- Standalone Flows fill the editor window or pane instead of sitting on a white document page. Cell text zoom stays within the pane; normal documents retain their own layout.
- Drag sheet tabs in the left sidebar to reorder them. Alt+Up/Down on a focused tab also changes its position. Sheet order is saved and synchronized independently of concurrent cell typing.
- Speech headers now paint an opaque layer above scrolling cells in every Flow theme. They remain below the Appearance panel.
- New Flow sheets start with 50 rows. Older short sheets display at least 50 rows too.
- Flow Appearance now includes a highlight color picker and a configurable highlight shortcut. The default remains Cmd/Ctrl+Shift+H. Changes apply to Flows on this computer.
- The Flow itself is no longer a selectable page object, and normal page deletion/replacement cannot accidentally remove it. Closing a document and editing cells continue normally.
- Select a rectangle with Shift-click, extend a range with Shift+arrows at cell boundaries, or Cmd/Ctrl-click separate cells. Delete/Backspace clears a multi-cell selection. Select all cells and Clear cells are available in the Flow toolbar. Escape returns to a single cell.

Both collaborators should update to 1.16.8 for sheet-order synchronization. Prior 1.16.7 Prep/Round options and Check Prep Document are preserved. Existing same-cell conflict behavior remains a deterministic whole-cell winner; concurrent row/sheet creation or deletion is not a character-level collaboration feature.

Use Help > Check for Updates, download 1.16.8, then explicitly choose Restart to install. Mac builds remain ad-hoc signed, not Apple-notarized. No visible desktop app or personal profile was used for validation.
