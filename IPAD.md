# CardMirror Green on iPad

Status: first editable tablet web/PWA preview deployed and automated checks passed. Actual iPad acceptance testing remains pending. This is a browser app, not an App Store app or an iPad build of Electron.

Green address: https://paulicydebate.github.io/CardMirror-Green/ . Deployment succeeded for 2c428fe3; upstream cardmirror.app is a separate deployment.

## First use

Open the Green address in Safari. Use Share > Add to Home Screen if desired. Load the app online once before relying on the cached offline shell. Documents stay in this browser's local recovery store unless you export a copy or explicitly start/join collaboration. Clearing website data removes that local recovery store; keep exported copies in Files.

The tablet layout supports Edit, Read and Move modes. Home and the menu offer New Flow. The Save button opens the existing export dialog; As-Is saves a full .cmir copy. On Safari this starts a download rather than overwriting the source file in Files. Reopen your exported copy to verify it. The browser cannot confirm whether you kept or cancelled a download in the system UI. DOCX export remains available through the same dialog.

## Co-editing

For the first cross-device check, start an ordinary Flow session on desktop and choose Copy Invitation Link. On iPad choose Menu > Join co-editing and paste that entire invitation, including its guest pass; a bare share code requires a configured account/relay credential. Invitations made by older desktops can be pasted into this menu even if their address begins with upstream cardmirror.app. Do not post invitation links publicly: the fragment contains the document's encryption key. The app clears invitation fragments from the address bar before joining.

Both peers should use matching current Flow code. Account-less invitation joins do not require entering a Tabroom password or adding an AI API key. Starting a new hosted session on iPad needs the existing browser account connection or a self-hosted relay configuration; receiving an invitation can use its room-scoped guest pass.

Prep/Round logging and enforcement remain desktop-only. A desktop Prep document cannot be joined from the web app by pretending it is an ordinary document. Browser editing is not an enforcement substitute. OpenCaselist's authenticated desktop panel also remains desktop-only.

## Validation and limits

Headless WebKit uses fresh synthetic profiles, files and a local mock relay. Its emulation does not establish real iPad keyboard, Files picker, PWA lifecycle, storage retention or real-relay behavior. Test these on an actual iPad before relying on the app in a round. Desktop apps and personal profiles must not be launched or controlled without the user's explicit approval.

Headless Chromium separately verifies the real service worker: offline reload, offline Flow editing, journal persistence and reopening the unsaved draft after another offline reload. Playwright documents service-worker support for Chromium; its WebKit CacheStorage/reload limitations prevent treating those automated runs as Safari offline verification. Tablet startup recovery is enabled and its panel appears above Home, with touch-sized controls. Reading-only phones still defer recovery.

The web workflow builds and verifies the Green manifest/icon, scoped subpath assets and offline service worker, runs regression tests and headless WebKit checks, then deploys to GitHub Pages from feature/full-card-api. GitHub Pages must be enabled for GitHub Actions in this repository; main remains unchanged. Web updates activate on a later launch instead of forcibly reloading an editing session.
