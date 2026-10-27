CardMirror Green 1.16.6 — Flow collaboration and sheet renaming

- Fix text disappearing when collaborators type on different Flow tabs, such as Gov case and Off 1. Each changed cell now carries a persistent logical revision; merging no longer relies on a 40-keystroke / 15-second history window for newly edited cells.
- Preserve cleared cells, including empty Prep cells, against delayed stale snapshots. Preserve the other collaborator's cells during local undo/redo.
- Allow synchronization repairs to resend previously accepted cells without tripping Prep's large-insert guard. Readable logs distinguish these repairs from new typing; partner edits remain recorded.
- Double-click the sheet name in the top row to rename it, just like the left sidebar. Enter, Space and F2 also open renaming when the top-row name has keyboard focus.

Update BOTH collaborators to 1.16.6 before testing Flow collaboration. Older versions discard the new cell revisions and are not covered by this fix. Existing Flow files remain readable; native saves preserve the added metadata. Simultaneous edits to the same cell choose a deterministic whole-cell winner rather than merging individual characters. Concurrent sheet/row structure edits are not the focus of this repair.

Use Help > Check for Updates, download 1.16.6, then explicitly choose Restart to install. Mac builds remain ad-hoc signed, not Apple-notarized. No app was launched or installed on the user's computer during development; real two-machine verification remains a user check.
