/** Fork identity: separate installations, profiles, taskbar groups and bridges. */
export const APP_NAME = 'CardMirror Green';
export const APP_ID = 'com.paulicydebate.cardmirror.green';
export const PROFILE_NAME = 'CardMirror Green';
export const BRIDGE_ID = 'cardmirror-green';
/** Green releases support Windows and Apple Silicon Mac; other builds stay manual. */
export function manualUpdates(platform: string, arch = process.arch): boolean { return platform !== 'win32' && !(platform === 'darwin' && arch === 'arm64'); }
export const MANUAL_PREVIEW_UPDATES = manualUpdates(process.platform, process.arch);
export const PREVIEW_DOWNLOADS = 'https://github.com/paulicydebate/CardMirror-Green/actions/workflows/desktop-previews.yml';
