# CardMirror Green project handoff

For a fresh chat or another LLM, start with HANDOFF.md, then CARDMIRROR_GREEN.md, ROADMAP.md and CARD_INGEST_V1.md. These files replace any assumption that the prior chat or desktop is available.

- Repository: paulicydebate/CardMirror-Green. Work only on feature/full-card-api.
- PR #1 was merged into main by another actor on 2026-10-30. Historical draft-only notes are superseded. Continue work on feature/full-card-api; do not modify main, reopen/recreate PR #1, or merge new work into main without a new explicit user request.
- User tests on Windows x64; their MacBook Pro is M5 Apple Silicon (macOS ARM64).
- Fork name: CardMirror Green. Preserve its green folder icon and isolated app ID, executable, user-data folder, update policy and bridge identity.
- Desktop preview workflow: .github/workflows/desktop-previews.yml. Verify both platforms' jobs and artifacts after packaging changes. Do not mistake an upstream CardMirror build for this fork.
- The extraction API is src/editor/structured-card-extract.ts, exposed through structuredCards() in src/editor/plugin-api.ts.
- Tests belong under tests/**/*.test.ts; Vitest does not discover tests next to src files.
- The API currently extracts direct citation/body/undertag paragraphs and text runs. Table contents and non-text inline nodes need an explicit representation before claiming lossless extraction of arbitrary documents.
- The local version 1 batch exporter is implemented; see CARD_INGEST_V1.md and src/editor/card-ingest-batch.ts.
- The OpenCaselist adapter (library + `npm run caselist` CLI) and the desktop in-app panel (Home → Browse OpenCaselist) are implemented; see OPENCASELIST.md. The user reported the panel working with their real account (2026-10-26); the CLI export is still mock-tested only. Never ask for, type or store the user's Tabroom password: the user signs in themselves in the app panel or their own terminal (hidden prompt).
- AI design decision (user, 2026-10-25): no paid AI API keys inside the app. CardMirror Green does the non-AI work (OpenCaselist, formatting, files) through documented commands and file formats; AI work (cutting, blocks, scouting analysis) is done by an outside agent such as Claude Code or Codex driving those tools. For chat-only AIs (the user also uses the Grok app on PC, Mac and phone), plan a copy-paste path: the app produces a prompt with source text and a strict answer format, then imports the reply and verifies every quoted line exists in the source.
- Copy-paste chat cutting is implemented: command "Cut Card with Chat AI (Copy/Paste)", reply format `cardmirror.cut.v1`; see CHAT_CUT.md. Every quote is verified against the card body before formatting is applied.
- Spreadsheet flowing is in progress: `flow_workbook` block + NodeView, "New Flow (Spreadsheet)"; see FLOW.md. flower (the user's favorite flow app) is GPL-3.0 and must NOT be copied into this PolyForm-licensed codebase; reimplement ideas only.
- Formats to support: NFA-LD, CEDA/NDT, and high-school NCDCA policy. Card output must match Verbatim styles (Pocket/Hat/Block/Tag, cite, underline, boxed emphasis, highlighting).
- Keep progress, validation results and next steps in CARDMIRROR_GREEN.md so a fresh chat on another computer can continue without access to the desktop.
- Store source in GitHub. Do not commit user debate files, credentials, node_modules or machine-specific app profiles.
- Desktop permission (user, 2026-10-26): ask for explicit permission BEFORE launching or controlling desktop apps or running visible Electron/UI tests. Code edits and command-line checks may continue. Use isolated test profiles and synthetic documents for any approved UI test. Never delete the user's files or make risky system changes. The previous handoff's Electron-testing instructions are not permission to launch apps.
