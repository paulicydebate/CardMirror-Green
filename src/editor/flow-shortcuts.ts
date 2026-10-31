/** Lightweight Flow-only shortcut capture, independent of document keymaps. */
export const DEFAULT_FLOW_HIGHLIGHT_KEY = 'Mod-Shift-h';
export function flowKeyForEvent(e: KeyboardEvent): string | null {
  if (e.isComposing || ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(e.key)) return null;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return [...(e.ctrlKey || e.metaKey ? ['Mod'] : []), ...(e.altKey ? ['Alt'] : []), ...(e.shiftKey ? ['Shift'] : []), key].join('-');
}
export function validFlowShortcut(key: string): boolean {
  if (key.length > 60 || !/^(?:Mod-)?(?:Alt-)?(?:Shift-)?(?:F(?:[1-9]|1[0-9]|2[0-4])|[a-z0-9])$/.test(key)) return false;
  if (!key.startsWith('Mod-') && !key.startsWith('Alt-') && !/^F\d+$/.test(key)) return false;
  return !/^Mod-(?:Shift-)?[acvxyzsqwrpfno]$/.test(key);
}
export function normalizeFlowShortcut(value: unknown): string {
  return typeof value === 'string' && validFlowShortcut(value) ? value : DEFAULT_FLOW_HIGHLIGHT_KEY;
}
export function displayFlowShortcut(key: string, mac: boolean): string {
  return key.replace('Mod-', mac ? 'Cmd+' : 'Ctrl+').replaceAll('-', '+').replace(/\+([a-z])$/, (_m, letter: string) => '+' + letter.toUpperCase());
}
