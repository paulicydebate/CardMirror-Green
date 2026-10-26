/**
 * Flow appearance (CardMirror Green): preset colorways plus personal
 * overrides (side text colors, text size, font).
 *
 * A viewer preference, not document content: stored per computer in
 * localStorage, applied to every flow in every window (other windows hear
 * about changes through the `storage` event, this window through a custom
 * event). Never stored in the flow file, so a teammate opening the same
 * flow keeps their own look.
 */

export type FlowPresetId = 'light' | 'flower' | 'classic' | 'contrast';
export type FlowTextSize = 'small' | 'medium' | 'large';
export type FlowFont = 'ui' | 'arial' | 'serif';

export interface FlowTheme {
  preset: FlowPresetId;
  /** Overrides for the first side's (aff / gov) and second side's text color; null = preset color. */
  affText: string | null;
  negText: string | null;
  size: FlowTextSize;
  font: FlowFont | null;
}

interface PresetSpec {
  label: string;
  vars: Record<string, string>;
  /** Color whole columns per speech, like a spreadsheet template. */
  fills: boolean;
  font: FlowFont;
  /** Shade every other column. */
  stripes: boolean;
}

export const FLOW_PRESETS: Record<FlowPresetId, PresetSpec> = {
  light: {
    label: 'Light',
    fills: false,
    stripes: false,
    font: 'ui',
    vars: {
      '--flow-bg': '#ffffff', '--flow-panel': '#f6f7f9', '--flow-line': '#e3e5e8', '--flow-text': '#1f2328',
      '--flow-muted': '#6b7280', '--flow-aff': '#1d4ed8', '--flow-neg': '#b91c1c', '--flow-accent': '#2563eb',
      '--flow-tint-aff': 'rgba(37, 99, 235, 0.05)', '--flow-tint-neg': 'rgba(220, 38, 38, 0.05)', '--flow-stripe': 'transparent',
    },
  },
  flower: {
    label: 'Dark (Flower-style)',
    fills: false,
    stripes: true,
    font: 'ui',
    vars: {
      '--flow-bg': '#262626', '--flow-panel': '#1e1e1e', '--flow-line': '#363636', '--flow-text': '#e5e5e5',
      '--flow-muted': '#9ca3af', '--flow-aff': '#4ade80', '--flow-neg': '#fb923c', '--flow-accent': '#4ade80',
      '--flow-tint-aff': 'transparent', '--flow-tint-neg': 'transparent', '--flow-stripe': 'rgba(255, 255, 255, 0.035)',
    },
  },
  classic: {
    label: 'Classic sheet',
    fills: true,
    stripes: false,
    font: 'arial',
    vars: {
      '--flow-bg': '#ffffff', '--flow-panel': '#f2f2f2', '--flow-line': '#c9c9c9', '--flow-text': '#000000',
      '--flow-muted': '#555555', '--flow-aff': '#000000', '--flow-neg': '#000000', '--flow-accent': '#1a73e8',
      '--flow-tint-aff': 'transparent', '--flow-tint-neg': 'transparent', '--flow-stripe': 'transparent',
      // The pastel column fills of the user's parli template.
      '--flow-fill-0': '#ffff99', '--flow-fill-1': '#ccffcc', '--flow-fill-2': '#ffcc99', '--flow-fill-3': '#ccffff',
    },
  },
  contrast: {
    label: 'High contrast',
    fills: false,
    stripes: true,
    font: 'ui',
    vars: {
      '--flow-bg': '#000000', '--flow-panel': '#0d0d0d', '--flow-line': '#4d4d4d', '--flow-text': '#ffffff',
      '--flow-muted': '#cccccc', '--flow-aff': '#ffd400', '--flow-neg': '#00e5ff', '--flow-accent': '#ffd400',
      '--flow-tint-aff': 'transparent', '--flow-tint-neg': 'transparent', '--flow-stripe': 'rgba(255, 255, 255, 0.06)',
    },
  },
};

const FONT_STACKS: Record<FlowFont, string> = {
  ui: 'var(--pmd-ui-font, system-ui, sans-serif)',
  arial: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};
const SIZES: Record<FlowTextSize, string> = { small: '0.8rem', medium: '0.9rem', large: '1.05rem' };

export const DEFAULT_FLOW_THEME: FlowTheme = { preset: 'light', affText: null, negText: null, size: 'medium', font: null };

const STORAGE_KEY = 'cmg-flow-theme';
const CHANGE_EVENT = 'cmg-flow-theme-change';
const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeTheme(value: unknown): FlowTheme {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    preset: typeof v['preset'] === 'string' && v['preset'] in FLOW_PRESETS ? (v['preset'] as FlowPresetId) : 'light',
    affText: typeof v['affText'] === 'string' && HEX.test(v['affText']) ? v['affText'] : null,
    negText: typeof v['negText'] === 'string' && HEX.test(v['negText']) ? v['negText'] : null,
    size: v['size'] === 'small' || v['size'] === 'large' ? v['size'] : 'medium',
    font: v['font'] === 'ui' || v['font'] === 'arial' || v['font'] === 'serif' ? v['font'] : null,
  };
}

export function loadFlowTheme(): FlowTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeTheme(JSON.parse(raw)) : { ...DEFAULT_FLOW_THEME };
  } catch {
    return { ...DEFAULT_FLOW_THEME };
  }
}

export function saveFlowTheme(theme: FlowTheme): void {
  const clean = normalizeTheme(theme);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); } catch { /* storage unavailable: applies to this window only */ }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: clean }));
}

/** Call `fn` whenever the theme changes (this window or another). Returns unsubscribe. */
export function onFlowThemeChange(fn: (theme: FlowTheme) => void): () => void {
  const local = (e: Event): void => fn(normalizeTheme((e as CustomEvent).detail));
  const other = (e: StorageEvent): void => { if (e.key === STORAGE_KEY) fn(loadFlowTheme()); };
  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener('storage', other);
  };
}

/** The effective preset text colors, for the appearance panel's color inputs. */
export function themeSideColors(theme: FlowTheme): { aff: string; neg: string } {
  const vars = FLOW_PRESETS[theme.preset].vars;
  return { aff: theme.affText ?? vars['--flow-aff']!, neg: theme.negText ?? vars['--flow-neg']! };
}

/** Apply a theme to a flow's root element as CSS variables + classes. */
export function applyFlowTheme(root: HTMLElement, theme: FlowTheme): void {
  const preset = FLOW_PRESETS[theme.preset];
  for (const [name, value] of Object.entries(preset.vars)) root.style.setProperty(name, value);
  for (const n of [0, 1, 2, 3]) if (!preset.vars[`--flow-fill-${n}`]) root.style.removeProperty(`--flow-fill-${n}`);
  if (theme.affText) root.style.setProperty('--flow-aff', theme.affText);
  if (theme.negText) root.style.setProperty('--flow-neg', theme.negText);
  root.style.setProperty('--flow-font', FONT_STACKS[theme.font ?? preset.font]);
  root.style.setProperty('--flow-size', SIZES[theme.size]);
  root.dataset['flowTheme'] = theme.preset;
  root.classList.toggle('pmd-flow-usefills', preset.fills);
  root.classList.toggle('pmd-flow-stripes', preset.stripes);
}

/** Template fill slot for a speech column: the parli template colors each
 *  speech (PMC yellow, LOC green, MG orange, MO cyan, LOR yellow, PMR cyan);
 *  other speeches cycle through the four fills. */
const SPEECH_FILL: Record<string, number> = { PMC: 0, LOC: 1, MG: 2, MO: 3, LOR: 0, PMR: 3 };
export function speechFillSlot(name: string, index: number): number {
  return SPEECH_FILL[name] ?? index % 4;
}
