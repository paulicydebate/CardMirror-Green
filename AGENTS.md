# CardMirror Green project handoff

For a fresh chat or another LLM, start with HANDOFF.md, then CARDMIRROR_GREEN.md, ROADMAP.md and CARD_INGEST_V1.md. These files replace any assumption that the prior chat or desktop is available.

- Repository: paulicydebate/cardmirror. Work only on feature/full-card-api.
- Keep PR #1 draft. Do not merge it or modify main without a new explicit user request.
- User tests on Windows x64; their MacBook Pro is M5 Apple Silicon (macOS ARM64).
- Fork name: CardMirror Green. Preserve its green folder icon and isolated app ID, executable, user-data folder, update policy and bridge identity.
- Desktop preview workflow: .github/workflows/desktop-previews.yml. Verify both platforms' jobs and artifacts after packaging changes. Do not mistake an upstream CardMirror build for this fork.
- The extraction API is src/editor/structured-card-extract.ts, exposed through structuredCards() in src/editor/plugin-api.ts.
- Tests belong under tests/**/*.test.ts; Vitest does not discover tests next to src files.
- The API currently extracts direct citation/body/undertag paragraphs and text runs. Table contents and non-text inline nodes need an explicit representation before claiming lossless extraction of arbitrary documents.
- The local version 1 batch exporter is implemented; see CARD_INGEST_V1.md and src/editor/card-ingest-batch.ts. OpenCaselist retrieval/ingest is not implemented. Next is the adapter, preserving source provenance and the evidence/analytic/tag_only/incomplete distinctions.
- Keep progress, validation results and next steps in CARDMIRROR_GREEN.md so a fresh chat on another computer can continue without access to the desktop.
- Store source in GitHub. Do not commit user debate files, credentials, node_modules or machine-specific app profiles.
