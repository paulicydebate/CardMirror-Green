# CardMirror Green on iPad

Status: first editable tablet web/PWA preview deployed and automated checks passed. Actual iPad acceptance testing remains pending. This is a browser app, not an App Store app or an iPad build of Electron.

Green address: https://paulicydebate.github.io/CardMirror-Green/ . Deployment succeeded for 2c428fe3; upstream cardmirror.app is a separate deployment.

## First use

Open the Green address in Safari. Use Share > Add to Home Screen if desired. Load the app online once before relying on the cached offline shell. Documents stay in this browser's local recovery store unless you export a copy or explicitly start/join collaboration. Clearing website data removes that local recovery store; keep exported copies in Files.

The tablet layout supports Edit, Read and Move modes. Home and the menu offer New Flow. The Save button opens the existing export dialog; As-Is saves a full .cmir copy. On Safari this starts a download rather than overwriting the source file in Files. Reopen your exported copy to verify it. The browser cannot confirm whether you kept or cancelled a download in the system UI. DOCX export remains available through the same dialog.

## Co-editing

For the first cross-device check, start an ordinary Flow session on desktop and choose Copy Invitation Link. On iPad choose Menu > Join co-editing and paste that entire invitation, including its guest pass; a bare share code requires a configured account/relay credential. Invitations made by older desktops can be pasted into this menu even if their address begins with upstream cardmirror.app. Do not post invitation links publicly: the fragment contains the document's encryption key. The app clears invitation fragments from the address bar before joining.

Both peers should use matching current Flow code. Account-less invitation joins do not require entering a Tabroom password or adding an AI API key. Starting a new hosted session on iPad needs the existing browser account connection or a self-hosted relay configuration; receiving an invitation can use its room-scoped guest pass.

Prep/Round is available on editable iPads. Open a document, then Menu > Start Prep. Use Menu > New prep document or New prep flow before typing. The bottom-pane Prep / Round control also provides actions and current status. Only new blank session documents can become prep documents. A desktop Prep invitation requires starting your own Prep session first; the collaboration protocol retains the host's Isolation/Co-Flowing rule. OpenCaselist's authenticated desktop panel remains desktop-only.

Menu > Round checklist lists the protected documents, what will close, file restrictions and collaboration rules before you confirm Start Round. Existing shared sessions keep their host's rule; changing your default does not change an already shared session. Round blocks existing file imports, while saving and new blank notes remain available. End Session records the end and seals open prep documents. Save each sealed document as .cmir afterward; DOCX copies do not retain its certificate.

Menu > Typing logs > View shows timestamps, accepted typing, blocked paste attempts and partner edits separately. Export readable downloads a .txt timeline; Export raw JSONL preserves the technical audit chain. Logs and active mode live in this browser's IndexedDB, separately from document recovery. Reload resumes the mode; one Green workspace per browser storage partition is allowed to prevent competing log writers. Close any other Green tab before reloading a workspace paused by that check. Ordinary strategy-document contents are excluded. Browser storage failure pauses protected editing instead of silently disabling the log.

The browser cannot inspect other apps/devices or prevent website-data deletion. Focus/visibility events indicate only what the browser reported; they do not prove cheating. iPad suspension or sudden termination can lose the final uncommitted input batch. Keep exported copies, and have the judge record the session's final seal independently. A self-generated hash chain alone is not proof of authenticity or uninterrupted supervision.

## Validation and limits

Headless WebKit uses fresh synthetic profiles, files and a local mock relay. Its emulation does not establish real iPad keyboard, Files picker, PWA lifecycle, storage retention or real-relay behavior. Test these on an actual iPad before relying on the app in a round. Desktop apps and personal profiles must not be launched or controlled without the user's explicit approval.

Headless Chromium separately verifies the real service worker: offline reload, offline Flow editing, journal persistence and reopening the unsaved draft after another offline reload. Playwright documents service-worker support for Chromium; its WebKit CacheStorage/reload limitations prevent treating those automated runs as Safari offline verification. Tablet startup recovery is enabled and its panel appears above Home, with touch-sized controls. Reading-only phones still defer recovery.

The web workflow builds and verifies the Green manifest/icon, scoped subpath assets and offline service worker, runs regression tests and headless WebKit checks, then deploys to GitHub Pages from feature/full-card-api. GitHub Pages must be enabled for GitHub Actions in this repository; main remains unchanged. Web updates activate on a later launch instead of forcibly reloading an editing session.

## Easier collaboration

Once both people have their relay/account connected and card sharing enabled, save the partner's CardMirror code once under Collaboration settings. In an open document choose Menu > Co-edit with… > Co-edit with [name]. The app starts or reuses that document's live session and sends the invitation. Your partner chooses Join on the received document invitation. You do not need to create a session and separately copy/send its code. Co-editing changes the whole live document; Send / Receive still supports one-time card transfers. Manual invitation links, join codes and view-only invitations remain available. The sender's invitation toast means sent, not accepted; live session presence shows who has actually joined.
