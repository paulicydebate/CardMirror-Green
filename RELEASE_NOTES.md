CardMirror Green 1.16.4 — Windows x64 and Mac Apple Silicon

- Apple Silicon Mac builds can now check and download updates from CardMirror Green's GitHub Releases.
- Restart to install uses a Green-only bundle replacement helper. It rechecks the ZIP SHA-512, app identity, version and code signature integrity before moving the installed app. It retains the previous app as a recovery backup beside the installed bundle.
- The helper preserves quarantine attributes and does not use administrator privileges. If the app is running from a disk image, a translocated path or an unwritable location, use the manual download instead.
- Installation happens only after clicking Restart to install. No updates install on ordinary quit.
- Windows retains its existing in-app updater. Prep/Round controls remain beside zoom in the status bar.

Mac setup: install this release once from the ARM64 DMG, placing CardMirror Green in a writable Applications location. Older Mac previews have their updater disabled and require this one manual install. Future releases can then be checked from Help > Check for Updates.

These Mac builds are ad-hoc signed, not Apple-notarized. macOS may require your explicit approval to open the app, and app permissions may need approval again after updates. The update helper is tested against synthetic bundles on a hosted Mac; a full real-app upgrade still needs confirmation on your Mac. No paid Apple Developer membership is used.

Recovery: retained previous bundles are in .cardmirror-green-update.* folders beside the installed app. Helper diagnostics are in $TMPDIR/cardmirror-green-update.log. The updater never modifies your documents or Green user profile.
