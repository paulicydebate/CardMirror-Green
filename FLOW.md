# Spreadsheet flowing

Status (2026-10-26): in the app; the user tested it with a student, which led to the co-editing fix, highlighting, the Prep column and resizable panes below. Matched to the user's parli template (Parli_Flow_Template_Master.xlsm, not committed) and their Flower setup: separate LOR and PMR columns on every sheet, never a combined neg block.

Why: NPDA prep rules forbid copy-paste during prep, and debaters flow in spreadsheets. A flow inside CardMirror lets prep be typed straight onto the flow, next to the user's documents, including in the three-pane workspace.

## Use

- Home → **New flow**, or the command bar → **New Flow (Spreadsheet)**. Pick NPDA, NFA-LD or Policy. The flow opens like any document (new window, three-pane slot picker, or in place) and is saved as a `.cmir` file with Save As.
- **Layout:** sheet list on the left, sheet title and toolbar on top (Bold, Cross out, Extend, + Row, − Row, Open as doc, Appearance, Delete sheet), grid below.
- **Appearance:** pick a background (Light, Dark, Classic sheet, High contrast) and a colorway: Green & Pink (default, on Dark), Yellow & Purple, Teal & Orange, Blue & Red, Mint & Coral, Sky & Rose, Lime & Magenta, Gold & Indigo, Lavender & Peach, Aqua & Berry, or Ink (one color). Each colorway has darker shades for light backgrounds and lighter shades for dark ones. "Pick your own" sets any Gov/Opp colors; text size and font too. Classic sheet reproduces the parli template's pastel columns (PMC yellow, LOC green, MG orange, MO cyan, LOR yellow, PMR cyan) in Arial. Stored per computer (localStorage), applied live to all flows, never saved in the file.
- **Tabs:** one sheet per position. `+ Gov` / `+ Opp` (or Aff/Neg) add a sheet starting at that side's first speech; double-click a tab to rename it; Delete sheet asks first if the sheet has text (undo restores it).
- **Grid:** one column per speech, colored by the side giving it (the colorway's two colors), with pill-style speech headers. Cells wrap and grow; the speech headers stay visible while scrolling.
- **Highlighting:** select text in a cell and press Ctrl/Cmd+Shift+H (or the Highlight button); with nothing selected it toggles the whole cell. Highlighting already-highlighted text removes it. Highlights follow the text as you type (typing inside a highlight extends it; typing just before it pushes it along) and export to Word as green highlight. Not yet shown in document view.
- **Prep column (thumpers / prepped answers):** Ctrl/Cmd+Shift+P (or the Prep button) opens a Prep column right after the speech you're in, pushing the next speech over rather than covering it; the same key closes it. Each row has one Prep cell, saved with the flow and lined up with that row's arguments; it stays saved while hidden. Tab moves through it in order. Word export adds a Prep column when any prep text exists.
- **Keys in a cell:** Enter = cell below (adds rows at the bottom), Shift+Enter = new line in the cell, Tab / Shift+Tab = next / previous speech, Up/Down at the edge of the text = row above/below, Ctrl/Cmd+Enter = insert row below, Ctrl/Cmd+Shift+Backspace = delete row, Ctrl/Cmd+B = bold, Ctrl/Cmd+Shift+X = cross out, Ctrl/Cmd+Shift+L = extend.
- **Column as a document:** double-click a speech header, "Open as doc", or Ctrl/Cmd+Shift+E in a cell. The column becomes a full-width document. **Enter starts the next argument (its own cell); Shift+Enter is a line break inside the argument;** Backspace at the start of an argument joins it to the one above; Up/Down at the edges move between arguments; pasted multi-line text becomes one argument per line; "Split lines into arguments" breaks up old multi-line cells. Escape or "Back to sheet" returns to the grid. New arguments land in the next empty cell below the previous one, inserting a row only when that cell is taken, so the other speeches stay aligned.
- **Size:** the flow fills the visible height of its window or three-pane slot and scrolls inside itself.
- Undo/redo, save, autosave and reopen work like any document change.
- **Word export:** each sheet becomes a heading plus a table (bold and crossed-out kept).

## Co-editing

A flow syncs as one value (the block's `data` attr), so concurrent edits used to overwrite each other and every partner keystroke re-rendered the grid under the typist. Now (`src/flow/flow-merge.ts`):
- Partner changes patch only the cells that changed; the cell being typed in keeps its element, focus and caret.
- Each local edit records the cell's previous value; an incoming cell equal to one of my recent previous values is a stale copy (a raced write), so my value is kept and re-sent. Both sides converge.
- My own undo/redo is recognized (it restores a state I already had) and never merged.
- Every row is saved with its id, and rows padded in on load get ids derived from the sheet, so both computers agree on row identity (the root cause of lost edits).
- Covered by `tests/collab/flow-coedit.test.ts` with the real Loro binding: concurrent typing in different cells, a partner editing while you type, and repeated races.

## Formats

| Preset | Aff/Gov sheet columns | Neg/Opp sheet columns |
|---|---|---|
| NPDA | PMC, LOC, MG, MO, LOR, PMR | LOC, MG, MO, LOR, PMR |
| NFA-LD | 1AC, 1NC, 1AR, NR, 2AR | 1NC, 1AR, NR, 2AR |
| Policy | 1AC, 1NC, 2AC, 2NC/1NR, 1AR, 2NR, 2AR | 1NC, 2AC, 2NC/1NR, 1AR, 2NR, 2AR |

To confirm with the user: the NPDA starting tabs, and whether LOR/PMR need their own columns on every sheet.

## Relationship to flower

The user's favorite flow app, flower (github.com/MrinalA2009/debate-flowerX), is GPL-3.0. CardMirror is PolyForm Noncommercial, which cannot be combined with GPL code, so **no flower code is used or copied**. This is an independent implementation of the same ideas (sheets per position, speech columns, side colors, crossed-out/extended marks, keyboard-first). Do not paste flower source into this repository.

## Code

| File | Responsibility |
|---|---|
| `src/flow/flow-model.ts` | Workbook model, presets, immutable edits, `cardmirror.flow` v1 save/load, column ↔ sections |
| `src/flow/flow-to-pm.ts` | Flow → heading + table blocks (Word export) |
| `src/schema/nodes.ts` (`flow_workbook`) | Leaf block holding the serialized flow in its `data` attr |
| `src/editor/flow-theme.ts` | Appearance presets, overrides, storage and live updates |
| `src/flow/flow-merge.ts` | Co-editing merge: edit history, stale-copy detection |
| `src/editor/flow-nodeview.ts` | Tabs, grid, keyboard, column document view; commits each edit as one transaction |
| `tests/flow/*`, `tests/editor/flow-nodeview.test.ts` | Model, export and in-editor tests |

## Not done yet

- Send to flow from a document (cards/tags into the active cell), for Mac and Windows.
- Rich text (underline/highlight) in cells and in the column document view; cells are plain text with bold/crossed/extended.
- Excel (.xlsx) export for Google Sheets users; speech timers; arrows between arguments.
- Highlights in document view.
