# CardMirror Green handoff

This document is the starting point for a new LLM or developer. The previous chat and the Windows desktop do not need to be available.

## Repository and non-negotiable scope

**Desktop permission (user, 2026-10-26): ask before every desktop app launch/control or visible UI test and wait for explicit approval. Code edits and headless command-line tests can continue. Use isolated profiles/synthetic documents for approved tests. Never delete personal files or clear the user's app profile.**

- Repository: https://github.com/paulicydebate/CardMirror-Green
- Active branch: `feature/full-card-api`
- Draft PR: https://github.com/paulicydebate/CardMirror-Green/pull/1
- Keep PR #1 draft. Do not merge it, modify main, force-push, or discard local work without a new explicit user instruction.
- The fork is CardMirror Green. Preserve its green folder icon, separate installer/app ID, executable, user-data directory and bridge identity.
- User's desktop is Windows x64. Their laptop is an M5 Apple Silicon MacBook Pro; use macOS ARM64 builds.
- User wants source, progress and handoff information in GitHub so work can continue with the desktop turned off.
- Do not commit private debate files, generated user-content batches, credentials or app profiles. Only code, synthetic fixtures, aggregate validation results and project documentation belong here.

Read in this order: [AGENTS.md](AGENTS.md), this handoff, [CARDMIRROR_GREEN.md](CARDMIRROR_GREEN.md), [ROADMAP.md](ROADMAP.md), and [CARD_INGEST_V1.md](CARD_INGEST_V1.md).

## Latest verified Prep / Round milestone

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
