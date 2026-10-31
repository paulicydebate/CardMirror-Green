# CardMirror Green handoff

This document is the starting point for a new LLM or developer. The previous chat and the Windows desktop do not need to be available.

## Repository and non-negotiable scope

**Desktop permission (user, 2026-10-26): ask before every desktop app launch/control or visible UI test and wait for explicit approval. Code edits and headless command-line tests can continue. Use isolated profiles/synthetic documents for approved tests. Never delete personal files or clear the user's app profile.**

- Repository: https://github.com/paulicydebate/CardMirror-Green
- Active branch: `feature/full-card-api`
- Historical PR: https://github.com/paulicydebate/CardMirror-Green/pull/1 — merged into main by another actor on 2026-10-30. Older milestone notes describing it as draft are historical.
- Continue on feature/full-card-api. Do not modify main, reopen/recreate PR #1, merge new work into main, force-push, or discard local work without a new explicit user instruction.
- The fork is CardMirror Green. Preserve its green folder icon, separate installer/app ID, executable, user-data directory and bridge identity.
- User's desktop is Windows x64. Their laptop is an M5 Apple Silicon MacBook Pro; use macOS ARM64 builds.
- User wants source, progress and handoff information in GitHub so work can continue with the desktop turned off.
- Do not commit private debate files, generated user-content batches, credentials or app profiles. Only code, synthetic fixtures, aggregate validation results and project documentation belong here.

Read in this order: [AGENTS.md](AGENTS.md), this handoff, [CARDMIRROR_GREEN.md](CARDMIRROR_GREEN.md), [ROADMAP.md](ROADMAP.md), and [CARD_INGEST_V1.md](CARD_INGEST_V1.md).

## Latest verified Prep / Round milestone

Current release preparation: 1.16.18 includes the other LLM's Soft/Soft dark Flow styles and bundled Merriweather Sans fonts, already merged via PR #4 into feature/full-card-api at 9e45f2d8. PR #1 subsequently merged that branch into main at 764ab555; the two branches have identical app content at that milestone. This checkout was fast-forwarded without conflicts; no merge or main modification was needed. Release is being prepared from the feature branch. Check the final CARDMIRROR_GREEN.md entry for validation/publication status before claiming updater availability. Use Flow Appearance to select Soft or Soft dark after installation.

1.16.18 is now published from 8d89f5b1: both platform release builds, public updater feeds and web deployment are verified. Follow-up 2dd12ec0 only stabilizes the synthetic capacity-test connections; it changes no packaged app code or release tag. See the final CARDMIRROR_GREEN.md entry for preview/check follow-up status. User can install via Help > Check for Updates, save and restart, then Flow Appearance > Soft / Soft dark. Keep working on feature/full-card-api; no main changes were made during publication.

1.16.18 test follow-up is fully verified: both platform previews/artifacts and feature checks for 2dd12ec0 passed. User has now requested additional Flow Appearance fixes: shortcut clipping, background option fit, UI font consistency, more Soft-friendly colorways and selected-cell contrast. These are new work beyond the published 1.16.18; check the latest CARDMIRROR_GREEN.md entry before claiming availability.

Current work is 1.16.19: Flow Appearance layout/fonts, full highlight shortcut field, six muted Soft-friendly palettes, neutral cell selection and opaque contrasting native text selection. Color-picker HSL shades are converted to valid hex; brighter legacy Soft-light hues deepen enough for text contrast. A new headless appearance check covers all 17 built-in palettes, Windows/Mac key labels, narrow panes and small screens. Source and validation notes are at the end of CARDMIRROR_GREEN.md; publication is not yet verified. No visible desktop app may be launched without new explicit permission.

1.16.19 is now published from e8dd3d34. Both Windows/Mac releases and previews/artifacts, public updater feeds, feature checks and web deployment (including new appearance regressions) are verified green. Full local suite: 4,447 passed / 46 skipped; focused color/UI tests: 32 passed. Final workflow and artifact links are recorded at the end of CARDMIRROR_GREEN.md. Continue on feature/full-card-api; main was not changed. Desktop apps still require new explicit user approval before any visible launch/control.

Current clarification: 1.16.20 removes speech-colored backgrounds from Soft/Soft dark columns and related labels/tabs/focus surfaces, retaining neutral layers with colored text. Other presets and intentional highlights remain unchanged. Focused tests, typecheck and headless neutral-background/font/contrast checks passed. Publication status is recorded at the end of CARDMIRROR_GREEN.md; do not claim availability until verified.

Newest work: 1.16.17 changes manual LD/policy Import tags to one tab per recognized styled position heading (AD1, AD2, DA, Off1, CP/K/T/etc.), with a preview and whole-document checkbox opt-out. Unassigned tags retain a filename tab. All tabs import/undo together; source, old sheets and Prep/Isolation protections are preserved. Optional position boundaries are validated across desktop windows; old payloads fall back safely. Full local suite passed 4,444 / 46 skipped; typecheck, desktop main and web builds passed. Check the final CARDMIRROR_GREEN.md entry for publication status before claiming availability. Both platform release and preview builds for the earlier 1.16.16 are now verified green.

Published 1.16.17 from 2d075f2b: both platform release and preview jobs/artifacts, three-platform CI, feature/PR checks, web deployment and public updater feeds verified. Full details at the end of CARDMIRROR_GREEN.md. Open Import tags, leave One tab per position heading checked, preview the names, then Create sheets. This is user-triggered, not automatic. Main unchanged and PR #1 remains draft.

Current work: 1.16.16 adds Import tags to LD/policy Flow. User chose a one-time editable copy and filename-derived tab names. Desktop reads open documents across windows; browser uses the same workspace. Dialog selects source, side and speech; Create sheet appends tag-only rows without replacing existing content, with Undo and Prep/Isolation gates. Source/model/UI/broker files and validation are described at the end of CARDMIRROR_GREEN.md. Publication is not yet verified; check the final status there before claiming updater availability.

1.16.16 is now published from f170ecec: both Windows/Mac release builds, public updater feeds, three-platform CI and web deployment verified. Full local suite: 4,438 passed / 46 skipped. See the final CARDMIRROR_GREEN.md entry for workflow/artifact links and the independent Windows preview rerun status. Use Help > Check for Updates, save and restart to install. Previous 1.16.15 drag-selection release also published successfully.

Newest source: Flow mouse range selection at 87408630, tagged v1.16.15. Click-hold-drag across cells, release and Backspace/Delete clears the range; edge scrolling and single-action Undo are covered. Full local suite passed 4,424 / 46 skipped, typecheck/build and headless Chromium/WebKit mouse checks passed. GitHub release/previews/web/CI are still queued as of the final check; 1.16.15 availability is NOT verified. Continue with the links and publication checklist at the end of CARDMIRROR_GREEN.md. Last verified published version remains 1.16.14 below.

Current work (1.16.14): the approved docked Collaboration panel replaces the small Co-edit picker across desktop/tablet. Open via the matching Collaboration pill, Home, or tablet Menu. People/default partner, Shared docs/rejoin, Invitations/accept/watch, truthful presence/queued changes and local recovery status use existing collaboration owners. Host Prep/Round rule is visible and locked for live sessions. Original manual/group/card-transfer paths remain. Session storage retries after failed writes and verifies recovery before disconnect. See the latest entry in CARDMIRROR_GREEN.md for validation/publication status; the older milestones below are historical. Other agent's merged Flow import/XLSX and extraction work at 34a60e14 was preserved. Actual iPad and installed-app acceptance remain user checks; no visible UI permission is implied.

Published from 2abb77da: [release 1.16.14](https://github.com/paulicydebate/CardMirror-Green/releases/tag/v1.16.14). Windows x64/Mac ARM64 release and preview builds, three-platform CI and web deployment passed. Both public updater feeds report 1.16.14. Full local suite: 4,421 passed / 46 skipped. All browser checks used headless synthetic profiles/local relay. Final verification links/artifacts are recorded at the end of CARDMIRROR_GREEN.md.

Implementation commit: `820ecab345ca698b23d7a205ba8c0e6d4fb82604`. [Desktop builds](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40418447105), [three-platform CI](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40418453370), [feature checks](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40418447195) and [PR checks](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40418453304) succeeded. Windows full suite: 4,337 passed / 47 skipped. Mac full suite: 4,346 passed / 38 skipped. Packaged resources and x64/ARM64 architectures passed verification.

Install manually from the 90-day artifacts: [Windows x64](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40418447105/artifacts/12696761562), [macOS ARM64](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40418447105/artifacts/12697381664). The explicitly approved two-instance Windows/local-relay test passed; see CARDMIRROR_GREEN.md. Both isolated apps and the temporary server were closed; nothing was installed into the user's normal environment. A later docs-only head may record this evidence; the installer implementation is the commit stated here. Any new desktop test still requires a new explicit approval.

## Historical batch-export baseline

Verified batch-export implementation commit: `e2bb9967d8fa053b4ed026c541f77992d0b545ba`. This is historical; use the current head and the newer Prep / Round milestone above, never reset to this older commit.

All checks for that implementation commit succeeded:
- [Desktop previews](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40237622996)
- [Three-platform CI](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40237626185)
- [Feature-branch checks](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40237622994)
- [PR checks](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40237626166)

The desktop preview jobs ran the configured full suites: Windows 4,201 passed / 47 skipped, macOS 4,210 passed / 38 skipped. Platform/CI-dependent skips are expected; original user documents are not CI fixtures. Typecheck, renderer/main/service builds and packaged resource/architecture checks passed. The Mac app signature check passed; the build is ad-hoc signed, not notarized. These are build/functional checks, not malware clearance.

Verified preview artifacts (90-day retention; they are NOT permanent release assets):
- [Windows x64](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40237622996/artifacts/12615633099)
- [macOS ARM64](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40237622996/artifacts/12615133555)

The user already smoke-tested an earlier Green Windows build: green branding, opening DOCX/CMIR, editing, saving, reopening, formatting, DOCX export and card copying worked. The M5 Mac still needs a user smoke test. The new batch exporter is a repository CLI/library; it has not been added as an app menu or remote HTTP endpoint.

## Completed in this milestone

1. Version 1 local batch export for both DOCX and CMIR.
2. Structural classification into `evidence`, `analytic`, `tag_only` and `incomplete`.
3. Warnings rather than silent deletion of incomplete records.
4. Original-byte hashes, logical source identifiers, parsed heading IDs and snapshot offsets.
5. Stable record IDs across regenerated imported heading UUIDs.
6. Exact-content fingerprints and duplicate annotations while retaining every record.
7. Full parsed document snapshots and authoritative ordered rich record nodes.
8. JSON Schema, contract documentation, CLI command and focused tests.
9. Published roadmap and portable project instructions.

No remote ingest service, hosted database or search library is implemented yet.

## OpenCaselist adapter milestone (Claude, 2026-10-25)

Implemented on top of version 1 without changing it; full details in [OPENCASELIST.md](OPENCASELIST.md).

- API facts verified from the live OpenAPI description (`https://api.opencaselist.com/v1/docs`) and the opencaselist.com web client. Nothing was invented; unverified points are listed in OPENCASELIST.md.
- `src/opencaselist/client.ts`: read-only client with cookie session, 500 ms spacing, bounded retries for network/429/5xx, timeouts, size limit, runtime response checks, credential-free redirect handling.
- `src/opencaselist/ingest.ts`: scoped discovery (caselist + school, optional team/side), one download per unique open-source path, original-byte hashes, `parseToDoc`, `createIngestBatch`; skips/failures in a separate `cardmirror.opencaselist.run` v1 manifest.
- `src/tools/opencaselist-cli.ts`: `npm run caselist -- login|status|logout|caselists|schools|teams|rounds|export`. Hidden password prompt; only the token is saved, outside the repo.
- Verified locally: typecheck clean; 14 new tests pass (client, adapter, CLI end-to-end against a local fake server); the 27 focused batch/extraction tests still pass; internal links pass.
- Full local suite on Node 24: 4,153 passed, 65 failed, 47 skipped. All 65 failures are in `tests/collab/*` and fail identically with these changes stashed (`AbortSignal` instance mismatch on Node 24). CI uses Node 22, where they passed. GitHub CI for this milestone has not been checked yet.
- **Not verified:** any request to the real OpenCaselist with an account.

## In-app OpenCaselist panel (Claude, 2026-10-25)

- Home screen tile and command "Browse OpenCaselist" (File group). Sign-in form, caselist/school/team browser, rounds table, Open → `routeOpenedFile` with `handle: null` (unsaved doc).
- Network and token live in main: `apps/desktop/src/opencaselist-ipc.ts` + `src/opencaselist/app-service.ts` (bundled by `apps/desktop/scripts/build-file-index-service.cjs` into `dist/opencaselist-service.cjs`). Token file `<userData>/opencaselist-session.bin`, Electron `safeStorage`-encrypted when available.
- Verified locally (Node 22): typecheck clean; desktop `build:main` + `build:service` succeed and the bundle loads; 9 service tests + 4 panel tests pass; all 3,112 editor tests pass; full suite 4,201 passed / 38 skipped / 1 failed — the failure is `tests/desktop/mac-swap-update.test.ts`, which expects `chmod 555` to block writes and cannot when the sandbox runs as root (unrelated). Screenshots of the panel with fake data looked correct.
- **Not verified:** the panel inside a packaged app, and any real OpenCaselist request.

## Chat cutting milestone (Claude, 2026-10-26)

- User report: the in-app OpenCaselist panel worked with their real account on the f3e1ccc preview build.
- New: copy-paste card cutting for chat AIs — `src/cutting/chat-cut.ts` (prompt, parser, verified matcher), `src/editor/chat-cut-apply.ts`, `src/editor/chat-cut-ui.ts`, command `chatCutCard` in the AI group. Format and rules: [CHAT_CUT.md](CHAT_CUT.md).
- Verified locally: typecheck; 19 new tests (matcher, editor glue on real ProseMirror docs, dialog in jsdom); screenshot of the dialog with a sample reply, which also showed the non-adjacent-words mistake now covered by an explicit prompt rule.
- **Not verified:** a real Grok conversation.

## Spreadsheet flow milestone (Claude, 2026-10-26)

- New block `flow_workbook` (schema) rendered by `src/editor/flow-nodeview.ts`; model in `src/flow/`. Commands: `newFlow` (File group, Home tile). Details: [FLOW.md](FLOW.md).
- Verified locally: typecheck; 15 new tests (model, column↔document round trip, NodeView typing/keys/undo/sheets/document view, Word export round trip); full suite 4,269 passed with only the sandbox-only mac-swap failure; screenshots of grid and document view.
- **Not verified:** use in the packaged app, three-pane mode by hand, live collaboration on a flow.
- Licensing: flower is GPL-3.0; nothing from it is used.

## Architecture map

| File | Responsibility |
|---|---|
| `src/editor/structured-card-extract.ts` | Existing read-only paragraph/mark extraction for cards and analytics |
| `src/editor/plugin-api.ts` | Exposes `structuredCards()` on the active document |
| `src/editor/card-ingest-batch.ts` | `createIngestBatch(inputs)`, classification, canonical JSON, SHA-256, provenance, stable IDs and duplicate annotations |
| `src/tools/cardmirror-ingest-cli.ts` | Local read-only multi-file export command |
| `src/tools/cardmirror-read-lib.ts` | `parseToDoc`, reusing the editor's actual DOCX/native parsers |
| `schemas/card-ingest-batch-v1.schema.json` | Published version 1 JSON shape |
| `CARD_INGEST_V1.md` | Normative semantics, identity rules and consumer limitations |
| `tests/editor/card-ingest-batch.test.ts` | Classification, rich content, stable identities, duplicates, provenance and schema checks |
| `tests/tools/cardmirror-ingest-cli.test.ts` | End-to-end CLI input preservation, new-output-only writes and failure behavior |
| `.github/workflows/desktop-previews.yml` | Windows x64 / Mac ARM64 preview builds with publish disabled |
| `src/opencaselist/client.ts`, `src/opencaselist/ingest.ts` | OpenCaselist API client and batch adapter (see OPENCASELIST.md) |
| `src/tools/opencaselist-cli.ts` | `npm run caselist` sign-in, listing and export commands |
| `apps/desktop/src/app-identity.ts` | Fork-specific name, app/profile/bridge identity and manual-preview-update policy |

## Setup and commands

Use Node 22 (matching CI). In a new checkout:

```sh
git clone --branch feature/full-card-api https://github.com/paulicydebate/CardMirror-Green.git
cd cardmirror
npm ci
npm --prefix apps/desktop ci
npm run typecheck
npx vitest run tests/editor/card-ingest-batch.test.ts tests/tools/cardmirror-ingest-cli.test.ts tests/editor/structured-card-extract.test.ts tests/editor/plugin-api.test.ts
npm run check:links
```

The focused command has 27 tests. Desktop dependencies are needed for the existing desktop tests/types and the schema test's already-pinned Ajv dependency.

On an existing checkout, inspect `git status --short` first. Fetch/pull the feature branch only when local changes are safely accounted for. Do not synchronize node_modules across Windows and macOS.

Local export:

```sh
npm run ingest:export -- --out batch.json "input.docx" "another.cmir"
```

Use a fresh output name: an existing output is deliberately not overwritten. All files are parsed before output is written; one failed input prevents a partial batch file. Nothing is uploaded. The CLI does not add absolute input paths to provenance, although rich document snapshots can contain paths already embedded in the source. Treat exports as private document content.

## Contract rules to preserve

- Envelope: `schema = cardmirror.ingest.batch`, `schemaVersion = 1`, `fingerprintAlgorithm = sha256-canonical-json-v1`.
- Evidence means a card with substantive citation AND direct body-paragraph text. This is a structural label, not a judgment of source credibility.
- Analytics remain analytics even without a citation or body. Tag-only records are retained.
- Rich-only/table-only cards are incomplete and flagged for rich-content handling, rather than silently counted as plain evidence or tag-only notes.
- `content` is the grouped paragraph view. `rawNode` is authoritative for original parsed order, tables and non-text inline content.
- Whole parsed source snapshots retain outline/outside-card text and references. Derived self-reference/transclusion views do not produce independently attributed evidence records.
- The snapshot is the editor's parsed representation, not every original Word ZIP/XML part.
- `source.sha256` is the hash of original input bytes. Caller-supplied logical source IDs must be unique in a batch; the local CLI uses original-byte hash plus NFC-normalized basename. A future remote adapter should use stable disclosure/document IDs.
- `from/to` are ProseMirror positions in the supplied snapshot, not DOCX byte offsets.
- Canonical JSON uses sorted ECMAScript object keys and preserves arrays. Content hashes ignore only heading-node `attrs.id`; marks, paragraph boundaries, order and other attributes remain significant.
- Exact duplicates have `duplicateOf` pointing to the first identical fingerprint. Never silently drop them. Fuzzy matching is not implemented.
- Schema validation checks shape. Untrusted incoming batches also require semantic checks for references/counts/hashes.
- Do not silently add fields or change hashing/classification semantics under version 1. Design an explicit version change if a breaking contract change is required.

## Representative private-document validation

Two real user files were checked locally. They and their generated extracts are NOT in GitHub and will not exist in a fresh checkout. Ask the user to reattach them or grant access to their private storage if another real-file check is needed. Use synthetic fixtures in committed tests.

Aggregate results:
- DOCX: 481 source paragraphs preserved exactly and in order; 16,058 directly highlighted characters preserved. 32 evidence-bearing card containers plus 35 tag-only entries.
- CMIR: 36 evidence cards plus 71 analytics; native IDs/text/marks matched for 107 containers and 871 runs.
- Combined batch: 174 retained records = 68 evidence + 71 analytics + 35 tag-only + 0 incomplete.
- 7 exact duplicate annotations: 6 tag-only entries and 1 evidence record. All 174 records remain in the output (167 unique fingerprints).
- Both exported batches passed JSON Schema validation. Re-importing the same files produced the same batch/record IDs. Source file hashes were unchanged.
- These real files do not exercise tables, images, footnotes or reference subtrees; synthetic tests cover relevant raw-content retention cases. Do not generalize the real-file check into a universal lossless-format claim.

## Next task for the receiving LLM (updated 2026-10-26)

Done and in the user's hands:
- OpenCaselist panel, confirmed with the user's real account.
- Spreadsheet flow: co-editing fix, highlights, Prep column, document view keeping blank arguments.
- Three-pane resizing and pop-out to a new window.
- Green default accent.
- Chat cutting is built but **on hold** at the user's request.

**Prep / Round implementation is now connected and usable in the desktop source build.** Read CARDMIRROR_GREEN.md, "Usable Prep / Round Modes", for behavior and validation. The explicitly approved final two-instance Windows check passed on code commit `820ecab345ca698b23d7a205ba8c0e6d4fb82604`, using a synthetic local relay; both apps and the dev server were closed. This supersedes the inactive milestone notes below. Remaining validation is macOS user smoke testing and optional cross-machine/real-relay use. Any new desktop test needs a new approval. Do not restart implementation from scratch. LOCKDOWN.md holds the design; summary:

Historical first milestone (superseded by the usable implementation above): Codex added `apps/desktop/src/prep-session.ts` and `tests/desktop/prep-session.test.ts` with transitions, eligibility, a durable chain, recovery and verification. At that milestone the module was intentionally disconnected from IPC and UI. It is now connected; do not treat this historical note as the current status.

Historical second milestone (also superseded): the shared plugin stack gained `prepDocumentGuard(targetUid)`, capture/transaction/flow guards, expansion metadata and accepted-change callbacks, plus rejected-flow rollback (27 new guard tests; 77 related tests). The controller, uid ordering, native gates, collaboration rules and typing/focus/lifecycle logging described as future work there are now connected. See the current status guide for remaining validation.
- **Prep Mode (yellow):**
  - Only new documents become prep docs, and they can't be unmarked.
  - In prep docs: no copy, cut, paste or drag in **or out**, and no large inserts from any feature. Macros and autocorrect are logged.
  - Typing in prep docs is logged.
  - Other docs (the coaches' strategy doc) are unrestricted.
  - Co-editing a prep doc requires every member to be in Prep Mode.
- **Round Mode (red):**
  - Ends all co-editing.
  - Force-closes every non-prep doc and blocks opening files.
  - New blank windows and documents are allowed.
- **Log:**
  - A hash-chained JSON Lines file in userData, with timestamps for Prep start, Round start and end.
  - A seal code shown when the session ends.
  - A viewer and export.

Follow the "Suggested build order" in LOCKDOWN.md. Test in the desktop app with Playwright `_electron` under xvfb (see the notes in CARDMIRROR_GREEN.md):
- Run the vite dev server on port 5173.
- Pick the window whose URL starts with http://localhost:5173, not the devtools window.
- Request permission before launching the app. Set `CARDMIRROR_DEV_PROFILE` to a new scratch directory for an isolated development profile. Never clear or modify the user's normal app profile. Packaged apps ignore this override.

Do not put a process pattern in the same shell line as `pkill -f`.

Feature pushes produce Windows and Mac preview artifacts. Version tags run release.yml, verify Windows x64 and Mac ARM64 installers and update metadata, then publish both in one Green release. Windows v1.16.1 and Mac ARM64 v1.16.4 enable in-app updates; older previews need one manual install.

Later or optional:
- Chat cutting follow-ups (CHAT_CUT.md).
- Card search database.
- Flow follow-ups (FLOW.md "Not done yet").
- Real OpenCaselist widening (OPENCASELIST.md).

The original adapter plan, kept for reference:
1. Define a small selectable scope and implement document discovery with an injectable transport for tests.
2. Retrieve original bytes without exposing credentials; record a stable disclosure/document ID and original URL.
3. Parse supported DOCX/CMIR documents through `parseToDoc`, preserving original-byte hashes.
4. Feed successful documents into `createIngestBatch`.
5. Implement bounded requests, rate-limit-aware retries, progress and explicit per-document errors.
6. Use a separate run manifest or an explicit new schema version for resumability/partial failures; do not sneak error rows or download state into the strict v1 batch schema.
7. Test with mocked transport and synthetic documents before a limited real-data run.
8. Verify provenance, retained record counts, exact duplicates and repeatability. Expand scope only after the limited run succeeds.
9. Update this handoff, the status guide and roadmap with the next verified baseline and remaining work.

Do not build a search UI, hosted database, fuzzy matching or automatic profile sync as part of the adapter without explicit user agreement. These are possible later work, not committed scope.

## Unresolved operational issues

- Chrome reported the Windows preview as a dangerous download. The user later reported Green installed and working. That does NOT resolve the browser verdict. No malware-clearance result or false-positive determination has been established. Do not advise disabling protections or present passing tests/hash verification as proof of safety. Investigate the exact detected artifact and an appropriate scan/signing/distribution approach if this issue is resumed.
- Windows v1.16.1 and Mac ARM64 v1.16.4 enable updates from Green releases only; older previews need one manual install. Never install upstream CardMirror over Green. App profiles/settings/local Quick Cards are per machine; automatic profile synchronization is not implemented.
- If an older preview replaced upstream CardMirror, installing Green does not restore upstream automatically. Green now installs alongside it.
- Local extraction/validation outputs from the previous machine are private workspace artifacts, not repository files.

## Prompt the user can give a new LLM

Continue CardMirror Green at paulicydebate/CardMirror-Green on branch feature/full-card-api. Read AGENTS.md, HANDOFF.md, LOCKDOWN.md and CARDMIRROR_GREEN.md's "Usable Prep / Round Modes" section. The desktop implementation is connected; continue its remaining validation and fixes. Ask for my explicit approval before launching or controlling desktop apps or running visible UI tests. Use separate test profiles and synthetic files; never delete my files. Code and headless checks can continue. Keep PR #1 draft and main unchanged. Never ask for or handle my Tabroom password. Do not copy code from flower (GPL). Give me installer artifact links after verified builds; do not install anything automatically.

Mac updater change (1.16.4): Apple Silicon Mac builds now use the custom Green-only bundle swap path. Require a manual initial install of 1.16.4; later versions can update in app. No Apple notarization or paid membership is configured. Helper preserves quarantine and backups, validates digest/identity/version/architecture/signature, and never targets the Green profile or user documents. Windows+Mac release assets are published together after both build jobs pass. Real-app Mac upgrade is not yet tested; obtain user approval before any desktop test.

## Mac user confirmation and document icons (2026-10-27)

User confirmed v1.16.4 opens and functions on their Mac, and Help > Check for Updates correctly reports v1.16.4 as latest. They requested matching white document icons with a green mark for the next updater-test release, v1.16.5. See CARDMIRROR_GREEN.md. Actual upgrade installation/relaunch remains a user test; do not claim it passed until the user confirms.

Validation for implementation `60af3657f9e26fb47dd5697144c30a7aea58bc5f`: [desktop preview run 40536596563](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40536596563) passed Windows x64 (4,343 tests passed / 46 skipped) and macOS ARM64 (4,351 passed / 38 skipped), the 8 synthetic Mac updater tests, typecheck, all builds, exact document icon packaging checks, architecture/signature verification and updater metadata hashes. [CardMirror checks 40536596564](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40536596564) passed. Manual preview artifacts: [Mac ARM64](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40536596563/artifacts/12748018777), [Windows x64](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40536596563/artifacts/12748693411).

v1.16.5 tag points at the implementation commit. [Release run 40536804880](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40536804880) passed Windows but its first Mac job could not acquire a GitHub hosted runner (capacity constraint); the failed job was retried. At this handoff, attempt 2 is queued for a Mac runner. Publication is not yet confirmed: check this run and the release/feed before telling the user to update. Do not move the tag or replace published assets. No desktop app was launched; real Finder icon display and in-app upgrade remain user checks.

### Flow collaboration repair and top-row rename (1.16.6, 2026-10-27)

User report: while two collaborators type on Gov case and Off 1 in the same Flow, the host does not receive the partner's text, so it is also missing from the host's Prep log. A real-Loro-binding headless regression reproduced lost text after concurrent bursts exceeding the old 40-value history. A first baseline-retention patch was rejected by a repeated-burst regression; the shipped approach uses per-cell logical clock/actor revisions instead. The old heuristic remains only for legacy unversioned cells. New revision metadata is additive to Flow v1 and persists in native saves, including empty Prep-cell tombstones. Both collaborators must update; older builds strip this metadata. Same-cell concurrency is deterministic whole-cell selection, not a text CRDT; structural row/sheet concurrency remains outside this repair.

The NodeView merges all sheets independently, resends preserved cells using an internal transaction-identity marker, and does not apply the normal local large-insert limit to these already accepted repairs. Clipboard/drop guards and logging-failure checks still apply. Repairs have a separate commit origin excluded from collaboration undo, and readable logs label them Flow synchronized without counting duplicate typing. The existing transaction-tagging seam now receives the owning EditorState so Loro undo/redo can be distinguished from remote imports; undo reissues local cell changes with newer revisions while retaining partner cells.

The top-row current-sheet name now opens the same rename dialog on double-click, matching the sidebar. Keyboard Enter/Space/F2 are supported. Focused tests cover confirmation and cancellation. No desktop/UI app was launched.

Local Node 22 verification: 86 focused tests passed (Flow co-editing with real Loro binding and Prep guards, repeated bursts, delayed updates, partner audit, clearing, undo/redo, register convergence, revision round-trip, Prep enforcement/report/session/desktop tests, and Flow UI tests). Full suite: 4,369 passed / 38 skipped; typecheck, renderer build, desktop main and service builds passed. Hosted release builds and real two-machine testing remain to be verified.

Previous 1.16.5 release did publish successfully: https://github.com/paulicydebate/CardMirror-Green/releases/tag/v1.16.5 ; release run 40536804880 attempt 3 passed. Earlier pending-run notes above are historical.

1.16.6 published successfully from implementation commit `19cd227116bc01f8b23607c3443e2d715ec78bf0`: https://github.com/paulicydebate/CardMirror-Green/releases/tag/v1.16.6 . [Release run 40604924791](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40604924791) passed Mac ARM64 (4,366 tests / 38 skipped, plus 8 synthetic updater tests) and Windows x64 (4,358 / 46 skipped), packaging, native architecture/resources, document icons, code signature integrity and both updater feeds/hashes. Public latest-mac.yml and latest.yml both serve 1.16.6. [Preview run 40604923388](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40604923388) passed both platforms; artifacts: [Mac](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40604923388/artifacts/12780841666), [Windows](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40604923388/artifacts/12780807017). Both CardMirror checks passed (40604923389 / 40604928715).

[Three-platform CI 40604928632](https://github.com/paulicydebate/CardMirror-Green/actions/runs/40604928632) passed Mac and Windows; Linux attempt 1 hit the previously documented intermittent spectator Watch-dialog failure (`no prompt button labeled "Watch"`, collab-ui-flows.test.ts:912). Its failed job was retried; attempt 2 was still running at this note. Do not describe all CI as green until checking the retry. The published Mac/Windows release runs passed the full configured suites independently. Real two-machine Gov case / Off 1 behavior and the user's update installation are still pending user confirmation. Both collaborators must install 1.16.6 or later. No personal desktop app was launched or controlled.

Final CI result: run 40604928632 attempt 2 completed successfully on Linux, Mac and Windows. The unchanged Linux retry passed; all configured release, preview and CI checks are now green for implementation 19cd2271. Real two-machine confirmation remains the next user check.

### Flow workspace update (1.16.8, 2026-10-28)

Pulled and preserved the other session's published 1.16.7 Prep/Round Isolation / Co-Flowing and Check Prep Document work before editing. User requires continuing 1.16.x numbering.

Implemented the seven requested Flow changes: full-window/pane standalone workspace without the ordinary paper/navigation area; sheet drag ordering plus Alt+arrow keyboard ordering; opaque speech headers above cells but below Appearance; 50 starting/display-minimum rows; personal highlight color and captured shortcut under Flow Appearance (default Mod-Shift-h); nonselectable Flow atom plus a local deletion/replacement guard; stable-row-ID multi-cell selection with Shift-click, boundary Shift-arrows, modifier-click, select-all and clear actions. Clear changes cell contents instead of removing rows or the workbook. Normal Shift-arrow selection inside text is retained. Internal same-view sheet drags are admitted by Prep guards while outside text/file drops remain blocked. Normal evidence documents use a fast no-Flow path and do not gain a full-document scan per keystroke.

Sheet ordering carries its own logical revision, retained in native Flow serialization and merged independently of cell edits; partner order is retained during local cell undo. Both collaborators should update to 1.16.8. Simultaneous structural creation/deletion is still outside the guarantees of the cell/order merge.

Local Node 22 validation: typecheck and full suite passed, 4,393 tests / 38 skipped. Renderer, desktop main/service builds passed during implementation; hosted final release builds pending. Focused tests cover standalone detection and delete protection (including a Flow inserted later), native sheet drag/keyboard ordering, Prep internal drag vs external drop, rectangular and separate-cell clearing, boundary Shift-arrow selection, normal in-cell text selection, custom highlight preferences and a concurrent typing/reorder over the real Loro binding.

Isolated headless Chromium checks with synthetic data passed all four themes at 1400x900, 900x650 and 600x450; Flow and editor bounds matched with no outer paper. Native mouse/keyboard checks passed range selection/clear, sheet dragging, configured F9 highlighting and sticky-header hit testing. A stacking conflict found by that test (headers covering Appearance Close) was fixed. Split-pane checks at text zoom 100%, 125%, 150% matched the Flow pane's bounds, scaled cell fonts correctly and left the neighboring normal document padding intact. The headless browser used a temporary isolated profile, never the user's browser profile; no visible Electron or desktop app was launched. A synthetic preview image is in this chat's outputs. Real packaged app confirmation remains a user check.


1.16.8 published from implementation commit `a22084d86bdb9d8e22a499b961bc0cdbbc7ea3e2`: https://github.com/paulicydebate/CardMirror-Green/releases/tag/v1.16.8 . Release run 40777888340 passed Mac ARM64 (4,390 tests / 38 skipped, plus synthetic updater checks) and Windows x64 (4,382 / 46 skipped), package/resource/signature checks and updater metadata verification, then published both platforms together. Public latest-mac.yml and latest.yml both serve 1.16.8. Preview run 40777887089, three-platform CI 40777892175, and CardMirror checks 40777887036 / 40777892232 all passed on the first attempt. Real packaged-app and two-machine confirmation remain user checks; both collaborators should update. No visible desktop app was launched or controlled.


### Flow row creation performance (1.16.9)

User reported a severe delay pressing Enter at the end of a Flow. The old path rebuilt the entire grid and measured every textarea before restoring focus. The new path commits the row, appends only newly created cells to the existing grid, and focuses the next cell immediately; a rejected transaction or a full sheet cannot append phantom rows. Existing Flows benefit without increasing the default row count. Prep cells and stable row IDs remain supported. In an isolated headless Chromium check with synthetic data, ten repeated appends retained the existing cell nodes and focused each new cell synchronously; the old build replaced nodes and deferred focus. Focused tests cover repeated appends, typing, native save/reopen of a new Prep cell, and existing collaboration behavior. No personal desktop app or profile was launched. Hosted release and real packaged-app confirmation pending.

1.16.9 published from commit `733e9c7bbcdd3707d43dc25a17951826e201cba1`: https://github.com/paulicydebate/CardMirror-Green/releases/tag/v1.16.9 . Release run 40790823874, Mac/Windows preview run 40790822381, three-platform CI 40790830815, and CardMirror checks 40790822348 / 40790830833 passed. Public latest-mac.yml and latest.yml report 1.16.9. Full local suite passed 4,394 tests / 38 skipped; isolated headless check appended 100 rows with immediate focus and retained existing cells. Real packaged-app performance confirmation remains a user check.

## Next milestone: editable iPad web/PWA (2026-10-28)

User authorized the iPad browser/PWA work. Start with IPAD.md and the latest CARDMIRROR_GREEN.md entry. Tablet editing, Flow file handling and invitation-based co-editing are implemented; phones stay view-first and Prep/Round remains desktop-only. Green has its own Pages workflow and manifest/icon. The repository Pages source is GitHub Actions with feature/full-card-api allowed; main and PR #1 remain unchanged/draft. Hosted deployment and offline checks must be verified before claiming the web address is live. Windows WebKit service-worker navigation stalled, so the offline check runs on hosted Linux WebKit; local WebKit editing, file round-trip and two-browser encrypted co-edit tests passed. Real iPad/Safari/Files and real-relay checks still require user confirmation. No desktop app launch/control is authorized. Do not publish a new desktop tag just to deploy the web preview; existing desktop invitation links can be pasted into the Green tablet Join menu.

Latest iPad validation correction: offline testing uses Chromium, since Playwright WebKit CacheStorage/reload stalls occurred on Windows and hosted Linux. Real service-worker offline Flow editing/reload/recovery now pass locally. WebKit verifies tablet editing, file round-trip and bidirectional encrypted co-editing separately. Tablet startup recovery is enabled with a touch-sized panel above Home. Pages publication is still pending the corrected workflow; verify it before describing the site as live. Desktop preview builds for bef2bde8 passed on Windows x64 and Mac ARM64. Actual iPad Safari/Files/keyboard/offline and real-relay checks remain pending.

LIVE PREVIEW: https://paulicydebate.github.io/CardMirror-Green/ . Implementation 2c428fe3 deployed successfully via https://github.com/paulicydebate/CardMirror-Green/actions/runs/40819220282; both hosted browser checks passed, including offline draft recovery. Public page/manifest verified. Full local suite: 4,393 passed / 46 skipped. Actual iPad acceptance testing is the next step; see IPAD.md. No desktop release tag was published. Main untouched; PR #1 remains draft.

## Current milestone: iPad Prep / Round (2026-10-29)

User authorized browser tablet Prep/Round and approved a pre-Round checklist and readable source-separated timeline. See IPAD.md and the latest CARDMIRROR_GREEN.md entry. Browser tablets now have persistent IndexedDB sessions, single-workspace Web Lock, restart restrictions, failure pause, native-file seals and readable downloads; phones remain view-first. Round checklist names protected/closing docs and explains actual host-chosen Isolation/Co-Flowing rules. No other-app/device monitoring or tamper-proof claim. Clearing website data can remove records; suspension may lose the last uncommitted input batch. Judge must record the seal independently. Full local suite: 4,397 passed / 46 skipped; typecheck and synthetic WebKit live UI / Chromium restart/offline checks passed. Hosted deployment and actual iPad acceptance remain pending. No desktop app launch/control is authorized. Keep feature/full-card-api, main unchanged, PR #1 draft; no desktop release tag is needed for web deployment.

Collaboration follow-up (2026-10-29): user requested Co-edit with X on the active document using saved partner codes. New named-partner picker/button uses existing room-invite/mailbox transport; it starts/reuses the current document session without redundant manual Start/code-copy. Recipient still chooses Join in Receive. Original send/card/group/view/link/code paths remain available. No real partner messaging occurred. See latest CARDMIRROR_GREEN.md for validation and deployment status.

LATEST LIVE IMPLEMENTATION: 5d7b3b6e at https://paulicydebate.github.io/CardMirror-Green/ . Both tablet Prep/Round and Co-edit with saved partner are deployed. Web run 40957619239 passed all checks/deploy; public served assets verified. Full local suite: 4,400 passed / 46 skipped. Desktop rebuild/CI were still running when recorded; no new desktop release tag/install was performed. For the user: close/reopen the iPad app, open a document, Menu > Co-edit with… > partner; recipient chooses Join. Menu also contains Start Prep, Round checklist and Typing logs. Actual-device/real-relay confirmation remains pending. Do not launch/control desktop apps without new permission.

## Desktop update shipped (2026-10-29)

User explicitly authorized applying the simplifications to Mac and PC. CardMirror Green 1.16.10 is now published for Windows x64 and Mac ARM64: https://github.com/paulicydebate/CardMirror-Green/releases/tag/v1.16.10 . Release run 40960957538 passed both platform builds/tests and updater/resource checks, then published them together. Public latest.yml and latest-mac.yml verified 1.16.10. Includes bottom-pane Prep/Round control, Round checklist, readable typing logs, named-partner Co-edit with and the sealed Save As fix. Update via Help > Check for Updates; save work before Restart to install. No local desktop app was launched/installed; actual user confirmation remains. Main untouched and PR #1 remains draft. Earlier notes saying no desktop release are historical.

## Latest desktop release: 1.16.13 (2026-10-29)

User reported Co-edit with had the wrong font and white fill. It now shares pmd-pill-bar / pmd-pill-label styling with Send/Receive, including custom UI font and theme colors/hover. Verified computed styles in an isolated headless browser. Release https://github.com/paulicydebate/CardMirror-Green/releases/tag/v1.16.13 is published; run 40964045862 passed both platforms and updater checks; public Mac/Windows feeds verified 1.16.13. Three-platform CI 40964049564 and web deployment 40964039123 passed. Earlier 1.16.11/12 tags failed validation and were never published; do not rewrite them. Update through Help > Check for Updates. No local desktop app was launched/controlled/installed. Main unchanged; PR #1 remains draft.
