# OpenCaselist adapter

Status: repository library, command line, and an in-app panel in the desktop app, all tested against mocked and local fake servers. **Not yet run against the real OpenCaselist with the user's account.**

## What was verified, and how (2026-10-25)

Sources: the live API description at `https://api.opencaselist.com/v1/docs` (OpenAPI 3.0.2, "Caselist API v1") and the opencaselist.com web client's own API calls. The OpenCaselist source repository is not public.

- Base URL `https://api.opencaselist.com/v1`. `GET /status` is public; data endpoints return 401 without a session.
- Sign-in: `POST /login` with `{username, password, remember}` (Tabroom credentials). The web client reads `token` from the JSON response; the spec's security scheme is a `caselist_token` cookie.
- Hierarchy: `caselists` -> `caselists/{caselist}/schools` -> `.../schools/{school}/teams` -> `.../teams/{team}/rounds[?side=]`.
- Rounds carry `round_id` and `opensource` (a file path). The web client downloads with `GET /download?path=<opensource>` and reads the raw body.
- The published spec omits several fields the web client uses (`round_id`, `opensource`, `display_name`, `level`), so the client checks responses at runtime and fails clearly rather than guessing.
- `robots.txt` disallows nothing. OpenCaselist itself offers weekly bulk downloads per caselist (`GET caselists/{caselist}/downloads`); the adapter does not use them yet.

**Not yet verified with a real account:** the exact caselist names for NFA-LD / NDT-CEDA / HS policy this season, the login response, whether downloads redirect to file storage, real file formats in the wild (.docx vs .doc/.pdf), rate limits, and token lifetime.

## In the app (desktop)

Home screen → **Browse OpenCaselist**, or the command bar → "Browse OpenCaselist" (also under the File ribbon group).

1. Sign in with your Tabroom email and password. The password field is cleared as soon as it is read; the password goes once to OpenCaselist and is never stored.
2. Pick a caselist (remembered next time), filter and pick a school, pick a team.
3. The team's disclosed rounds are listed (tournament, round, side, opponent, judge). **Open** downloads a `.docx`/`.cmir` file and opens it like File → Open (new window, slot picker, or in place) as an **unsaved** document, so Save asks where to put it. Other formats (e.g. PDF) are shown but not opened.
4. An expired session returns to the sign-in form automatically. **Sign out** deletes the saved session.

How it is built: the panel (`src/editor/opencaselist-ui.ts`) never sees the token. It calls `host:opencaselist` over IPC; the desktop main process (`apps/desktop/src/opencaselist-ipc.ts`) runs `src/opencaselist/app-service.ts` (esbuild-bundled to `dist/opencaselist-service.cjs`) with the same client, retries and spacing as the CLI. The token is saved in `<app user data>/opencaselist-session.bin`, encrypted with the OS keychain (Electron `safeStorage`); if the OS offers no encryption it is written owner-only in plain text, like the CLI. The app session and the CLI session are separate.

The panel opens one file at a time. Bulk export (`export` below) is still CLI-only.

## Command line


Sign-in happens in your own terminal. The password prompt is hidden, the password is sent only to OpenCaselist and never stored, and only the returned session token is saved in `~/.cardmirror-green/opencaselist-session.json` (outside the repository; override the folder with `CARDMIRROR_GREEN_HOME`). Never paste credentials into an AI chat.

```sh
npm run caselist -- login
npm run caselist -- status
npm run caselist -- caselists
npm run caselist -- schools <caselist>
npm run caselist -- teams <caselist> <school>
npm run caselist -- rounds <caselist> <school> <team> --side A
npm run caselist -- export --caselist <caselist> --school <school> --team <team> --limit 5 --out batch.json
npm run caselist -- logout
```

`export` requires a caselist and a school; `--team` and `--side` narrow it further. `--limit` caps the number of unique files (default 25, maximum 500). It writes two NEW files and refuses to overwrite either one, checking before any network request:

- `batch.json`: a standard version 1 batch ([CARD_INGEST_V1.md](CARD_INGEST_V1.md)) built only from successfully parsed files. Omitted if nothing imported.
- `batch.run.json` (or `--manifest`): the run manifest described below.

Exit code 0 = finished with no failures; 2 = finished but some teams or files failed (see the manifest); 1 = could not run (not signed in, bad options, output exists, expired session).

## Behavior

- Read-only toward OpenCaselist: only GET requests, plus login.
- At least 500 ms between requests. Network errors, 429 and 5xx retry up to 4 attempts with backoff (1 s, 2 s, 4 s; honors `Retry-After`, capped at 30 s). 401/403/404 do not retry. 60 s timeout per request, 100 MB per file.
- The token is sent only as a cookie, only to the server that issued it, never in URLs, output, batches or manifests. A download redirect is followed once, over HTTPS only, without the cookie.
- Each unique `opensource` path is downloaded once, even when several rounds point to it. Source ID: `opencaselist:<path>`. Source URI: the credential-free download URL. `sha256` hashes the original downloaded bytes.
- `.docx` and `.cmir` are parsed with the editor's own importers (`parseToDoc`). Other formats are recorded as `skipped`, not converted.
- A failed team listing or file is recorded and the run continues. An expired session (401) stops the run.
- Same remote state gives the same batch ID and record IDs. The same file disclosed by two teams produces exact-duplicate annotations; nothing is dropped.

## Run manifest (`cardmirror.opencaselist.run`, version 1)

Kept separate so that skips, failures and download state never enter the strict v1 batch.

- `scope`, `maxDocuments`, `apiBase`, `startedAt`, `finishedAt`, `batchId` (or null).
- `discoveryErrors[]`: `{school, team, message, httpStatus}` for team listings that failed.
- `documents[]`: one per attempted unique file: `path`, `sourceId`, `status` (`imported` | `skipped` | `failed`), `reason` (`unsupported-format` | `download-failed` | `not-a-docx` | `parse-failed` | null), `message`, `httpStatus`, `sha256`, `bytes`, and `rounds[]` (every disclosed round that points to this file: `roundId`, `school`, `team`, `tournament`, `side`, `round`, `opponent`, `judge`, `createdAt`).
- `summary`: `teams`, `rounds`, `roundsWithFiles`, `uniqueFiles`, `notAttempted` (cut by the limit), `imported`, `skipped`, `failed`, `records`.

The manifest contains opponent/judge names from public disclosures, and the batch contains the documents' content. Treat both as private working files; do not commit them.

## Code

| File | Responsibility |
|---|---|
| `src/opencaselist/client.ts` | API client: login, listings, download, retries, spacing, timeouts, response checks |
| `src/opencaselist/ingest.ts` | Scoped discovery, per-file download/parse, manifest, hand-off to `createIngestBatch` |
| `src/tools/opencaselist-cli.ts` | `npm run caselist` commands, hidden password prompt, session file |
| `src/opencaselist/app-service.ts` | Main-process service for the app panel: session store, list/download results as `{ok, value}` / `{ok, error, signedOut}` |
| `apps/desktop/src/opencaselist-ipc.ts` | `host:opencaselist` IPC handler, encrypted session file |
| `src/editor/opencaselist-ui.ts` | The panel: sign-in, caselist/school/team browser, rounds table, Open |
| `tests/opencaselist/app-service.test.ts`, `tests/editor/opencaselist-ui.test.ts` | Service (mock transport) and panel (jsdom, fake bridge) tests |
| `tests/opencaselist/*.test.ts` | Mocked-transport tests for client and adapter |
| `tests/tools/opencaselist-cli.test.ts` | End-to-end CLI run against a local fake server |
