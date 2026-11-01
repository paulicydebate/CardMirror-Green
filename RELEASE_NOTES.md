CardMirror Green 1.16.23 — Flow co-editing data-loss repair

- Preserve newly inserted Flow rows and their contents when a partner concurrently sends an older sheet state; simultaneous additions are kept in a consistent order. Intentional deletions remain tracked, and concurrent edits to a deleted row are preserved.
- In expanded column view, typing or pressing Enter no longer clears a partner’s new, not-yet-displayed argument. Reopen the expanded column to refresh its list.
- Keep the cursor on the same row when a partner inserts a row above it.

All collaborators must update to 1.16.23 or later before using this repair; older versions do not understand the row metadata. The precise circumstances of the student report are still unconfirmed, and simultaneous edits to the same cell remain whole-cell conflicts. Keep backups of important work.

Co-edit document pop-out remains under separate development. Use Help > Check for Updates, then Restart to install.
