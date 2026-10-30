# CardMirror Green roadmap

Start a new LLM or developer with [HANDOFF.md](HANDOFF.md). Scope: work confirmed in this project chat. Repository: paulicydebate/CardMirror-Green, branch feature/full-card-api. PR #1 stays draft and main stays unchanged.

## Completed

| Feature | Result |
|---|---|
| Distinct fork identity | CardMirror Green name, green folder icon, separate executable, installer ID, profile and bridge registration |
| Cross-platform previews | Windows x64 and macOS ARM64 installers from GitHub Actions, with architecture/resource verification and 90-day artifact retention |
| Windows smoke test | User confirmed opening files, editing, saving, reopening and formatting checks |
| Full-card extraction | Read-only plugin API includes tags, citation/body paragraphs, undertags, IDs, offsets and inline marks; derived references are not independently counted |
| Representative format validation | A user DOCX and native CMIR passed source-text/mark checks; detailed extracts remain local |
| In-app OpenCaselist panel | Sign in with Tabroom, browse caselist → school → team, open a disclosed .docx/.cmir as an unsaved document; token kept in the main process, OS-encrypted (mock-tested only) |
| OpenCaselist real check | User reported the in-app panel working with their real account (2026-10-26) |
| Chat cutting (copy-paste) | Copy a prompt for Grok/any chat AI, paste the reply; every quote verified against the card before underline/emphasis/green highlight are applied in one undoable step |
| Spreadsheet flow (v1) | New Flow command/Home tile; sheets per position, speech columns for NPDA/NFA-LD/policy, wrapping cells, keyboard navigation, column-as-document toggle, Word export as tables |
| LD/policy tag import | Import tags from an open document into a new filename-named tab and chosen speech; one-time editable copy, cross-window desktop reads, undo and Prep transfer gates |
| Cloud handoff | GitHub holds source, AGENTS.md, current status, contract documentation and this roadmap so another computer can continue with the desktop off |
| Prep / Round Modes | Desktop controller, per-document restrictions, coordinated Round closing, native file/clipboard gates, prep-aware encrypted collaboration, durable typing logs, restart recovery, viewer/export and seal code; see CARDMIRROR_GREEN.md for validation limits |

## Completed in the batch-export milestone

**Version 1 bulk-ingest contract and local exporter**

- Distinguish evidence, analytics, tag-only entries and incomplete records.
- Keep incomplete records with explicit warnings.
- Preserve rich ordered nodes and whole parsed source snapshots.
- Include original-byte hashes, logical source identifiers, heading IDs and document offsets.
- Produce repeatable record IDs and exact-content fingerprints.
- Mark exact duplicates while keeping all records and their provenance.
- Publish a JSON Schema, contract guide and a local DOCX/CMIR export command.
- Verified: 27 focused local tests, typecheck, JSON Schema validation, repeat exports of both representative documents, and green Windows/macOS CI for implementation commit e2bb996. The sample batch retains all 174 records and marks 7 exact duplicates.

## Next

1. **Prep / Round validation.** Implementation is connected. The explicitly approved two-instance Windows check with a synthetic local relay passed. macOS user smoke testing and optional cross-machine/real-relay checks remain; get a new explicit approval before any further desktop test. See [LOCKDOWN.md](LOCKDOWN.md) and [CARDMIRROR_GREEN.md](CARDMIRROR_GREEN.md).

1. **Chat cutting (on hold by user choice, 2026-10-26).** See CHAT_CUT.md for the state at pause.
1. **Chat cutting: user check.** Try "Cut Card with Chat AI" with Grok on a few real cards ([CHAT_CUT.md](CHAT_CUT.md)); tune the prompt from what Grok gets wrong.
1. **Chat cutting, next pieces.** Cut a raw article into a new card; AI-suggested omissions; a CLI so Claude Code/Codex can apply `cardmirror.cut.v1` replies to files; several cards per prompt.
1. **Spreadsheet flowing** ([FLOW.md](FLOW.md)): first version done; next match the user's Google Sheets template, send-to-flow, rich text in cells, .xlsx export.
1. **Block generation and scouting** through the same copy-paste pattern.
2. **Batch validation and scale.** Verify larger selections; inspect malformed/incomplete documents, repeated disclosures and revisions. Establish acceptable time/memory behavior and resumable processing for lengthy runs.
3. **Broader document coverage.** Exercise tables, images, footnotes, links and derived-reference cases with real examples. Consumers must use rawNode when the paragraph view is incomplete.
4. **Mac smoke test.** Install the ARM64 Green build on the user's M5 MacBook Pro and repeat opening/editing/save/reopen/export checks.
5. **Cross-device use.** Install matching builds on both computers and verify shared debate documents through the user's synced folder. Source code/context are in GitHub; settings and local libraries remain per machine.

## Open distribution issue

Chrome flagged the Windows preview as a dangerous download. The user subsequently reported Green working. Build/test success does not resolve the security verdict. Investigate the exact detected artifact/verdict and decide an appropriate scan, false-positive review and signing/distribution approach before treating this as resolved.

## Possible later work that is not committed scope

- Automatic settings, Quick Cards and local-library synchronization.
- A searchable evidence library or search UI over ingested batches.
- Fuzzy/semantic duplicate matching and citation enrichment.
- A remote HTTP ingestion service or hosted database.
- Automatic Green preview updates and a signed release channel.

These need explicit product decisions; the current implementation does not promise them. OpenCaselist browsing and single-file open are in the desktop app; bulk export is command-line only.
