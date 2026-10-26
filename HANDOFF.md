# CardMirror Green handoff

This document is the starting point for a new LLM or developer. The previous chat and the Windows desktop do not need to be available.

## Repository and non-negotiable scope

- Repository: https://github.com/paulicydebate/CardMirror-Green
- Active branch: `feature/full-card-api`
- Draft PR: https://github.com/paulicydebate/CardMirror-Green/pull/1
- Keep PR #1 draft. Do not merge it, modify main, force-push, or discard local work without a new explicit user instruction.
- The fork is CardMirror Green. Preserve its green folder icon, separate installer/app ID, executable, user-data directory and bridge identity.
- User's desktop is Windows x64. Their laptop is an M5 Apple Silicon MacBook Pro; use macOS ARM64 builds.
- User wants source, progress and handoff information in GitHub so work can continue with the desktop turned off.
- Do not commit private debate files, generated user-content batches, credentials or app profiles. Only code, synthetic fixtures, aggregate validation results and project documentation belong here.

Read in this order: [AGENTS.md](AGENTS.md), this handoff, [CARDMIRROR_GREEN.md](CARDMIRROR_GREEN.md), [ROADMAP.md](ROADMAP.md), and [CARD_INGEST_V1.md](CARD_INGEST_V1.md).

## Verified baseline

Latest verified implementation commit: `e2bb9967d8fa053b4ed026c541f77992d0b545ba`. A later documentation-only handoff commit may be the branch head; inspect the actual head rather than resetting to this implementation commit.

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

## Next task for the receiving LLM

The adapter is built (see the milestone above). Next:

1. Confirm GitHub CI is green for the adapter commit on both platforms.
2. Limited real run, with the user signing in themselves — easiest through the app panel (Home → Browse OpenCaselist) on a fresh preview build, or `npm run caselist -- login` in their own terminal; never handle the password. Open ~3 files from one team (panel) or `export --limit 3` (CLI). Record the real caselist names, file formats, any redirect behavior and failures in OPENCASELIST.md. Fix what the real service disagrees with.
3. Then widen to a whole school, and check repeatability and duplicate annotations on real data.
4. Next features, per the AI design decision in AGENTS.md (the OpenCaselist panel and copy-paste chat cutting are done): the user's Grok check of chat cutting, then the next pieces listed in CHAT_CUT.md, then block generation and scouting through the same pattern.

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
- Preview updates are manual and must never install upstream CardMirror over Green. App profiles/settings/local Quick Cards are per machine; automatic profile synchronization is not implemented.
- If an older preview replaced upstream CardMirror, installing Green does not restore upstream automatically. Green now installs alongside it.
- Local extraction/validation outputs from the previous machine are private workspace artifacts, not repository files.

## Prompt the user can give a new LLM

Continue CardMirror Green at paulicydebate/CardMirror-Green on branch feature/full-card-api. Read HANDOFF.md, AGENTS.md, CARDMIRROR_GREEN.md, ROADMAP.md and CARD_INGEST_V1.md. The v1 local exporter and the OpenCaselist adapter (mock-tested) are complete; the next task is a limited real OpenCaselist run, then the in-app panel, as described in HANDOFF.md. Keep PR #1 draft and leave main unchanged. Do not assume access to the previous chat or machine.
