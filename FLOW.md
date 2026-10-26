# Spreadsheet flowing

Status (2026-10-26): first version in the app, tested with automated tests and screenshots. **Not yet tried by the user.** Waiting on the user's Google Sheets flow template to match its layout.

Why: NPDA prep rules forbid copy-paste during prep, and debaters flow in spreadsheets. A flow inside CardMirror lets prep be typed straight onto the flow, next to the user's documents, including in the three-pane workspace.

## Use

- Home → **New flow**, or the command bar → **New Flow (Spreadsheet)**. Pick NPDA, NFA-LD or Policy. The flow opens like any document (new window, three-pane slot picker, or in place) and is saved as a `.cmir` file with Save As.
- **Tabs:** one sheet per position. `+ Gov` / `+ Opp` (or Aff/Neg) add a sheet starting at that side's first speech; double-click a tab to rename it; Delete sheet asks first if the sheet has text (undo restores it).
- **Grid:** one column per speech, colored by the side giving it (blue = aff/gov, red = neg/opp). Cells wrap and grow; the speech headers stay visible while scrolling.
- **Keys in a cell:** Enter = cell below (adds rows at the bottom), Shift+Enter = new line in the cell, Tab / Shift+Tab = next / previous speech, Up/Down at the edge of the text = row above/below, Ctrl/Cmd+Enter = insert row below, Ctrl/Cmd+Shift+Backspace = delete row, Ctrl/Cmd+B = bold, Ctrl/Cmd+Shift+X = cross out, Ctrl/Cmd+Shift+L = extend.
- **Column as a document:** double-click a speech header (or Ctrl/Cmd+Shift+E in a cell). The column becomes a full-width document, one section per argument. "+ Add argument" (or Ctrl/Cmd+Enter) adds a section; Escape or "Back to spreadsheet" returns to the grid. Edits land in the matching cells; new sections become cells below the section before them, inserting a row only when that cell is taken, so the other speeches stay aligned.
- Undo/redo, save, autosave and reopen work like any document change.
- **Word export:** each sheet becomes a heading plus a table (bold and crossed-out kept).

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
| `src/editor/flow-nodeview.ts` | Tabs, grid, keyboard, column document view; commits each edit as one transaction |
| `tests/flow/*`, `tests/editor/flow-nodeview.test.ts` | Model, export and in-editor tests |

## Not done yet

- Matching the user's Google Sheets template (needs the example).
- Send to flow from a document (cards/tags into the active cell), for Mac and Windows.
- Rich text (underline/highlight) in cells and in the column document view; cells are plain text with bold/crossed/extended.
- Excel (.xlsx) export for Google Sheets users; speech timers; arrows between arguments.
- Live collaboration on a flow has not been tested.
