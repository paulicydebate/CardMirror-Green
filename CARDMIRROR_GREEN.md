# CardMirror Green

Personal fork: https://github.com/paulicydebate/cardmirror
Active branch: `feature/full-card-api`. PR #1 remains draft; do not merge or modify main.

## Two computers

Install the Windows x64 preview on the desktop and the macOS ARM64 preview on an Apple Silicon Mac. Both artifacts come from the same desktop-previews workflow run and commit. Preview artifacts currently expire after seven days. Install the Green build alongside upstream CardMirror; Green uses a distinct installer ID, executable, settings folder and bridge identity. Preview updates are manual and never install upstream builds.

If an earlier preview replaced upstream CardMirror, installing Green does not restore upstream automatically. Reinstall upstream separately if desired. Green starts with its own empty profile; existing files on disk can be opened normally. Do not copy a running app profile between machines.

Source code is shared through GitHub. For a local development checkout on either machine:

```sh
git clone --branch feature/full-card-api https://github.com/paulicydebate/cardmirror.git
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

Next: compare extraction against representative debate documents, define a versioned batch-ingest contract with source provenance and deduplication, then build the OpenCaselist ingestion adapter. No OpenCaselist downloader or bulk-ingest implementation is shipped yet.
