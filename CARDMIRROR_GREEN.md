# CardMirror Green

Personal fork: https://github.com/paulicydebate/CardMirror-Green
Active branch: `feature/full-card-api`. PR #1 remains draft; do not merge or modify main.

## Two computers

Install the Windows x64 preview on the desktop and the macOS ARM64 preview on an Apple Silicon Mac. Both artifacts come from the same desktop-previews workflow run and commit. Preview artifacts currently expire after 90 days. Install the Green build alongside upstream CardMirror; Green uses a distinct installer ID, executable, settings folder and bridge identity. Preview updates are manual and never install upstream builds.

If an earlier preview replaced upstream CardMirror, installing Green does not restore upstream automatically. Reinstall upstream separately if desired. Green starts with its own empty profile; existing files on disk can be opened normally. Do not copy a running app profile between machines.

Source code is shared through GitHub. For a local development checkout on either machine:

```sh
git clone --branch feature/full-card-api https://github.com/paulicydebate/CardMirror-Green.git
cd cardmirror
npm ci
npm --prefix apps/desktop ci
```

Before switching machines, commit and push changes on the feature branch. On the other machine use `git pull --ff-only` in a clean checkout. Install dependencies separately on each operating system; do not sync node_modules or installer output through cloud storage.

Documents can live in a shared Dropbox/OneDrive folder installed on both computers. Save and close a document, wait for sync, then open it on the other computer. For simultaneous editing use CardMirror's collaboration feature rather than editing two cloud-file copies at once. Settings, Quick Cards and local recovery/history stores are per machine; this change does not add automatic profile synchronization.

To continue the same assistant chat and desktop workspace from another device, use the app's Settings > Connections remote-control setup where available, under the same account/workspace. The desktop must stay awake, online and running the app. This is remote access to the desktop, not a copy of its files. See https://learn.chatgpt.com/docs/remote-connections .

## Current API milestone

`CardMirrorPluginApi.structuredCards()` reads the active document's full cards and analytics without changing the document or assigning a document ID. It preserves citation/body paragraphs, inline text runs and marks, stable card IDs when available, and document offsets. Derived self-reference and transclusion subtrees are skipped.

The extraction tests now live in `tests/editor/structured-card-extract.test.ts`, where the configured Vitest runner discovers them. Coverage includes multiple citations/paragraphs, missing IDs, offsets, derived-copy exclusion, mark attributes, native save/reopen, and plugin API integration.

Representative document validation and the version 1 local batch-export contract are implemented. See CARD_INGEST_V1.md for the format and ROADMAP.md for completed and planned work. Next is the OpenCaselist ingestion adapter; no remote downloader or ingestion service is shipped yet.

The collaboration backoff-cap regression uses fake timers and a pinned high jitter draw, so its 50 ms cap is checked without relying on runner scheduling latency.

## Representative document validation (2026-10-25)

Two local user-supplied documents were checked. No user documents, extracted text, or source filenames are committed to this repository.

- DOCX: 481 source paragraphs matched imported paragraph text exactly and in order; all 16,058 directly highlighted characters matched. Extraction returned 32 containers with citations and bodies, plus 35 tag-only containers. There were 374 body paragraphs.
- Native CMIR: 36 evidence cards plus 71 analytics, with 36 citation paragraphs, 146 body paragraphs and 6 undertags. Raw stored IDs, text and inline marks matched the API for all 107 containers and 871 text runs after normalizing absent mark attrs to empty objects.
- Extraction paragraph/run text and offset checks passed. Both original file hashes and in-memory documents were unchanged by extraction.
- These samples do not exercise tables, images, footnotes, inline breaks or derived references; no visual page-layout comparison was performed.
- Required next contract decision: distinguish evidence, analytics and tag-only entries; keep incomplete records with explicit warnings rather than silently discarding them. Then add a versioned batch schema, provenance and deduplication before implementing OpenCaselist ingest.

## Batch export milestone

`npm run ingest:export -- --out batch.json input.docx another.cmir` exports schema version 1 without uploading documents or overwriting existing output. It distinguishes evidence, analytics, tag-only and incomplete records, preserves rich snapshots, and adds provenance, deterministic IDs and exact-duplicate annotations without dropping records. JSON Schema is in schemas/card-ingest-batch-v1.schema.json.

Local focused validation: 27 tests passed, including classification, stable IDs across regenerated headings, changed-source revisions, rich nodes/tables, duplicate retention, schema validation, and CLI overwrite/error handling. Typecheck and internal link checks passed. The two representative files exported 174 records: 68 evidence, 71 analytics, 35 tag-only, no incomplete records, and 7 exact duplicate annotations (all records retained). Repeat imports produced the same batch/record IDs; both original file hashes were unchanged. Extracted user content stays local.

## OpenCaselist adapter (2026-10-25)

`npm run caselist -- login` then `npm run caselist -- export --caselist <c> --school <s> --team <t> --limit 5 --out batch.json` downloads a team's open-source disclosures and produces a version 1 batch plus a run manifest. You sign in yourself in your own terminal; only a session token is saved, outside the repository. Mock-tested only so far; see [OPENCASELIST.md](OPENCASELIST.md).

## In-app OpenCaselist panel (2026-10-25)

Desktop app: Home → **Browse OpenCaselist** (or the command bar). Sign in with Tabroom, pick caselist → school → team, and **Open** a disclosed .docx/.cmir as an unsaved document. The session token stays in the app's main process, encrypted with the OS keychain. Mock-tested only; the first real sign-in is the next check. See [OPENCASELIST.md](OPENCASELIST.md).

## Cut a card with a chat AI (2026-10-26)

Command bar → **Cut Card with Chat AI (Copy/Paste)** with the cursor in a card. Copy the prompt into Grok, paste its reply back; quotes that are not in the card are rejected and listed, the rest is applied as one undoable step with green highlighting. No API key. See [CHAT_CUT.md](CHAT_CUT.md).

The OpenCaselist panel worked with the user's real account (user report, 2026-10-26).

## Spreadsheet flow (2026-10-26)

Home → **New flow** (or command bar → New Flow). Sheets per position, one column per speech (NPDA first, also NFA-LD and policy), cells that wrap, keyboard-first. Double-click a speech header to open that column as a document; Escape returns to the grid. Works in any window or three-pane slot and saves as .cmir. See [FLOW.md](FLOW.md).

## Continue with another LLM

Start with [HANDOFF.md](HANDOFF.md). It records the verified implementation commit, CI evidence, setup commands, architecture, contract invariants, private-data limitations, and the next OpenCaselist-adapter task. [ROADMAP.md](ROADMAP.md) separates completed work, planned work and optional future ideas. The next LLM does not need the previous chat or access to the original desktop.
