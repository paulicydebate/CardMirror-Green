/** Green-only macOS updater. Keep the previous app for recovery; never touch profiles/documents. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function bundlePathFromExe(exePath: string): string | null {
  const bundle = path.resolve(exePath, '..', '..', '..');
  return bundle.endsWith('.app') && path.basename(path.dirname(exePath)) === 'MacOS' && path.basename(path.dirname(path.dirname(exePath))) === 'Contents' ? bundle : null;
}
export function macBundleSelfUpdatable(exePath: string): boolean {
  const bundle = bundlePathFromExe(exePath);
  if (!bundle || bundle.includes('/AppTranslocation/')) return false;
  try {
    if (fs.lstatSync(bundle).isSymbolicLink()) return false;
    fs.accessSync(bundle, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch { return false; }
}
function shq(s: string): string { return "'" + s.replace(/'/g, "'\\''") + "'"; }
export interface SwapArgs {
  pid: number;
  zipPath: string;
  appBundlePath: string;
  sha512: string;
  version: string;
  /** Only headless synthetic-bundle tests disable relaunch. Production always launches. */
  relaunch?: boolean;
}
export function buildSwapScript(a: SwapArgs): string {
  if (!Number.isSafeInteger(a.pid) || a.pid <= 0 || !path.isAbsolute(a.zipPath) || !path.isAbsolute(a.appBundlePath) || !a.appBundlePath.endsWith('.app') || !/^[A-Za-z0-9+/]{86}==$/.test(a.sha512) || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(a.version)) throw new Error('Invalid Mac update parameters.');
  return `#!/bin/bash
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
PID=${a.pid}
ZIP=${shq(a.zipPath)}
APP=${shq(a.appBundlePath)}
EXPECTED_HASH=${shq(a.sha512)}
EXPECTED_VERSION=${shq(a.version)}
LOG="\${TMPDIR:-/tmp}/cardmirror-green-update.log"
exec >>"$LOG" 2>&1
echo "== $(date) Green update start"
for _ in $(seq 1 600); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then echo 'app never exited; aborting'; exit 1; fi
STAGE=''
launch_app() { ${a.relaunch === false ? ':' : 'open -n "$APP"'}; }
fail_restore() {
  echo "$1"
  if [ -n "$STAGE" ] && [ -d "$STAGE/previous.app" ] && [ ! -e "$APP" ]; then
    mv "$STAGE/previous.app" "$APP" || echo "RESTORE FAILED: previous app preserved at $STAGE/previous.app"
  fi
  echo "Recovery files retained: $STAGE"
  [ -d "$APP" ] && launch_app
  exit 1
}
[ -d "$APP" ] && [ ! -L "$APP" ] || fail_restore 'invalid installed app'
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" = 'com.paulicydebate.cardmirror.green' ] || fail_restore 'installed app is not Green'
ACTUAL_HASH=$(openssl dgst -sha512 -binary "$ZIP" | openssl base64 -A)
[ "$ACTUAL_HASH" = "$EXPECTED_HASH" ] || fail_restore 'update ZIP hash mismatch'
# Stage on the same filesystem so bundle moves are atomic renames.
STAGE=$(mktemp -d "$(dirname "$APP")/.cardmirror-green-update.XXXXXX") || fail_restore 'cannot stage update beside app'
ditto -x -k "$ZIP" "$STAGE" || fail_restore 'extract failed'
NEWAPP="$STAGE/cardmirror-green.app"
[ -d "$NEWAPP" ] && [ ! -L "$NEWAPP" ] || fail_restore 'expected Green bundle missing'
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$NEWAPP/Contents/Info.plist")" = 'com.paulicydebate.cardmirror.green' ] || fail_restore 'update identity mismatch'
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$NEWAPP/Contents/Info.plist")" = "$EXPECTED_VERSION" ] || fail_restore 'update version mismatch'
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$NEWAPP/Contents/Info.plist")" = 'cardmirror-green' ] || fail_restore 'unexpected executable'
codesign --verify --deep --strict "$NEWAPP" || fail_restore 'update signature invalid'
lipo "$NEWAPP/Contents/MacOS/cardmirror-green" -verify_arch arm64 || fail_restore 'update architecture mismatch'
# Keep quarantine attributes and let macOS enforce its normal policy.
mv "$APP" "$STAGE/previous.app" || fail_restore 'could not back up old app'
mv "$NEWAPP" "$APP" || fail_restore 'swap failed'
if ! launch_app; then
  mv "$APP" "$STAGE/failed.app" || fail_restore 'new app could not launch; backup retained'
  fail_restore 'new app launch failed; restoring previous app'
fi
echo "Update installed. Previous app retained at $STAGE/previous.app"
`;
}
/** Resolve only once the helper has spawned successfully, before the caller quits. */
export async function launchSwapHelper(a: SwapArgs): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardmirror-green-update-'));
  const scriptPath = path.join(dir, 'install.sh');
  fs.writeFileSync(scriptPath, buildSwapScript(a), { mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
