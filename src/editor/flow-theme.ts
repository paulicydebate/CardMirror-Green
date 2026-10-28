import { DEFAULT_FLOW_HIGHLIGHT_KEY, normalizeFlowShortcut } from './flow-shortcuts.js';
/**
 * Flow appearance (CardMirror Green): a base style (background, lines,
 * panels) combined with a colorway (the two sides' text colors), plus
 * personal overrides (custom side colors, text size, font).
 *
 * A viewer preference, not document content: stored per computer in
 * localStorage and applied to every flow in every window (other windows
 * hear about changes through the `storage` event, this window through a
 * custom event). Never stored in the flow file, so a teammate opening the
 * same flow keeps their own look.
 */

export type FlowBaseId = 'light' | 'dark' | 'classic' | 'contrast';
export type FlowTextSize = 'small' | 'medium' | 'large';
export type FlowFont = 'ui' | 'arial' | 'serif';

export interface FlowTheme {
  base: FlowBaseId;
  colorway: string;
  /** Custom text colors for the first side (aff / gov) and second side; null = colorway color. */
  affText: string | null;
  negText: string | null;
  size: FlowTextSize;
  font: FlowFont | null;
  highlightColor: string | null;
  highlightKey: string;
}

interface BaseSpec {
  label: string;
  dark: boolean;
  /** Fill whole columns per speech, like a spreadsheet template. */
  fills: boolean;
  /** Shade every other column. */
  stripes: boolean;
  font: FlowFont;
  vars: Record<string, string>;
}

export const FLOW_BASES: Record<FlowBaseId, BaseSpec> = {
  light: {
    label: 'Light',
    dark: false,
    fills: false,
    stripes: false,
    font: 'ui',
    vars: {
      '--flow-bg': '#ffffff', '--flow-panel': '#f7f7f9', '--flow-line': '#e8e8ec', '--flow-text': '#1f2328',
      '--flow-muted': '#6b7280', '--flow-shadow': '0 1px 2px rgba(16, 24, 40, 0.06), 0 8px 24px rgba(16, 24, 40, 0.06)',
      '--flow-tint-aff': 'color-mix(in srgb, var(--flow-aff) 5%, transparent)',
      '--flow-tint-neg': 'color-mix(in srgb, var(--flow-neg) 5%, transparent)',
      '--flow-stripe': 'transparent',
      '--flow-hl': 'rgba(34, 230, 80, 0.38)',
    },
  },
  dark: {
    label: 'Dark',
    dark: true,
    fills: false,
    stripes: true,
    font: 'ui',
    vars: {
      '--flow-bg': '#232326', '--flow-panel': '#1b1b1e', '--flow-line': '#323236', '--flow-text': '#e7e7ea',
      '--flow-muted': '#9b9ba3', '--flow-shadow': '0 10px 30px rgba(0, 0, 0, 0.35)',
      '--flow-tint-aff': 'transparent', '--flow-tint-neg': 'transparent',
      '--flow-stripe': 'rgba(255, 255, 255, 0.03)',
      '--flow-hl': 'rgba(57, 255, 20, 0.30)',
    },
  },
  classic: {
    label: 'Classic sheet',
    dark: false,
    fills: true,
    stripes: false,
    font: 'arial',
    vars: {
      '--flow-bg': '#ffffff', '--flow-panel': '#f3f3f3', '--flow-line': '#cfcfcf', '--flow-text': '#000000',
      '--flow-muted': '#555555', '--flow-shadow': '0 1px 3px rgba(0, 0, 0, 0.08)',
      '--flow-tint-aff': 'transparent', '--flow-tint-neg': 'transparent', '--flow-stripe': 'transparent',
      // The pastel column fills of the user's parli template.
      '--flow-fill-0': '#ffff99', '--flow-fill-1': '#ccffcc', '--flow-fill-2': '#ffcc99', '--flow-fill-3': '#ccffff',
      '--flow-hl': '#00ff00',
    },
  },
  contrast: {
    label: 'High contrast',
    dark: true,
    fills: false,
    stripes: true,
    font: 'ui',
    vars: {
      '--flow-bg': '#000000', '--flow-panel': '#0b0b0b', '--flow-line': '#4a4a4a', '--flow-text': '#ffffff',
      '--flow-muted': '#cfcfcf', '--flow-shadow': 'none',
      '--flow-tint-aff': 'transparent', '--flow-tint-neg': 'transparent',
      '--flow-stripe': 'rgba(255, 255, 255, 0.06)',
      '--flow-hl': 'rgba(0, 255, 0, 0.45)',
    },
  },
};

interface Colorway {
  label: string;
  /** Text colors on light backgrounds (darker shades) and dark backgrounds (lighter shades). */
  light: { aff: string; neg: string };
  dark: { aff: string; neg: string };
}

/** Curated two-color sets; the first color is the first side (aff / gov). */
export const FLOW_COLORWAYS: Record<string, Colorway> = {
  'green-pink': { label: 'Green & Pink', light: { aff: '#15803d', neg: '#db2777' }, dark: { aff: '#4ade80', neg: '#f472b6' } },
  'yellow-purple': { label: 'Yellow & Purple', light: { aff: '#a16207', neg: '#7e22ce' }, dark: { aff: '#facc15', neg: '#c084fc' } },
  'teal-orange': { label: 'Teal & Orange', light: { aff: '#0f766e', neg: '#c2410c' }, dark: { aff: '#2dd4bf', neg: '#fb923c' } },
  'blue-red': { label: 'Blue & Red', light: { aff: '#1d4ed8', neg: '#b91c1c' }, dark: { aff: '#60a5fa', neg: '#f87171' } },
  'mint-coral': { label: 'Mint & Coral', light: { aff: '#047857', neg: '#d9480f' }, dark: { aff: '#6ee7b7', neg: '#ff8a7a' } },
  'sky-rose': { label: 'Sky & Rose', light: { aff: '#0369a1', neg: '#be123c' }, dark: { aff: '#7dd3fc', neg: '#fda4af' } },
  'lime-magenta': { label: 'Lime & Magenta', light: { aff: '#4d7c0f', neg: '#a21caf' }, dark: { aff: '#a3e635', neg: '#e879f9' } },
  'gold-indigo': { label: 'Gold & Indigo', light: { aff: '#b45309', neg: '#4338ca' }, dark: { aff: '#fbbf24', neg: '#a5b4fc' } },
  'lavender-peach': { label: 'Lavender & Peach', light: { aff: '#6d28d9', neg: '#c2410c' }, dark: { aff: '#c4b5fd', neg: '#fdba74' } },
  'aqua-berry': { label: 'Aqua & Berry', light: { aff: '#0e7490', neg: '#9d174d' }, dark: { aff: '#67e8f9', neg: '#f9a8d4' } },
  ink: { label: 'Ink (one color)', light: { aff: '#111111', neg: '#111111' }, dark: { aff: '#f2f2f2', neg: '#f2f2f2' } },
};

const FONT_STACKS: Record<FlowFont, string> = {
  ui: 'var(--pmd-ui-font, system-ui, sans-serif)',
  arial: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};
const SIZES: Record<FlowTextSize, string> = { small: '0.8rem', medium: '0.9rem', large: '1.05rem' };

export const DEFAULT_FLOW_THEME: FlowTheme = { base: 'dark', colorway: 'green-pink', affText: null, negText: null, size: 'medium', font: null, highlightColor: null, highlightKey: DEFAULT_FLOW_HIGHLIGHT_KEY };

const STORAGE_KEY = 'cmg-flow-theme';
const CHANGE_EVENT = 'cmg-flow-theme-change';
const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeTheme(value: unknown): FlowTheme {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  // Earlier versions stored one `preset` (light / flower / classic / contrast).
  const legacy: Record<string, [FlowBaseId, string]> = {
    light: ['light', 'blue-red'], flower: ['dark', 'green-pink'], classic: ['classic', 'ink'], contrast: ['contrast', 'gold-indigo'],
  };
  const fromLegacy = typeof v['preset'] === 'string' ? legacy[v['preset']] : undefined;
  const base = typeof v['base'] === 'string' && v['base'] in FLOW_BASES ? (v['base'] as FlowBaseId) : fromLegacy?.[0] ?? DEFAULT_FLOW_THEME.base;
  const colorway = typeof v['colorway'] === 'string' && v['colorway'] in FLOW_COLORWAYS ? v['colorway'] : fromLegacy?.[1] ?? DEFAULT_FLOW_THEME.colorway;
  return {
    base,
    colorway,
    highlightColor: typeof v['highlightColor'] === 'string' && HEX.test(v['highlightColor']) ? v['highlightColor'] : null,
    highlightKey: normalizeFlowShortcut(v['highlightKey']),
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

/** Colorway colors for a base (its light or dark shades). */
export function colorwayColors(colorway: string, base: FlowBaseId): { aff: string; neg: string } {
  const cw = FLOW_COLORWAYS[colorway] ?? FLOW_COLORWAYS[DEFAULT_FLOW_THEME.colorway]!;
  return FLOW_BASES[base].dark ? cw.dark : cw.light;
}

/** The side colors in effect (custom overrides win). */
export function themeSideColors(theme: FlowTheme): { aff: string; neg: string } {
  const cw = colorwayColors(theme.colorway, theme.base);
  return { aff: theme.affText ?? cw.aff, neg: theme.negText ?? cw.neg };
}

/** Apply a theme to a flow's root element as CSS variables + classes. */
export function applyFlowTheme(root: HTMLElement, theme: FlowTheme): void {
  const base = FLOW_BASES[theme.base];
  for (const n of [0, 1, 2, 3]) root.style.removeProperty(`--flow-fill-${n}`);
  for (const [name, value] of Object.entries(base.vars)) root.style.setProperty(name, value);
  const colors = themeSideColors(theme);
  if (theme.highlightColor) root.style.setProperty('--flow-hl', theme.highlightColor);
  root.style.setProperty('--flow-aff', colors.aff);
  root.style.setProperty('--flow-neg', colors.neg);
  root.style.setProperty('--flow-accent', colors.aff);
  root.style.setProperty('--flow-font', FONT_STACKS[theme.font ?? base.font]);
  root.style.setProperty('--flow-size', SIZES[theme.size]);
  root.dataset['flowTheme'] = theme.base;
  root.dataset['flowColorway'] = theme.colorway;
  root.classList.toggle('pmd-flow-dark', base.dark);
  root.classList.toggle('pmd-flow-usefills', base.fills);
  root.classList.toggle('pmd-flow-stripes', base.stripes);
}

/** Template fill slot for a speech column: the parli template colors each
 *  speech (PMC yellow, LOC green, MG orange, MO cyan, LOR yellow, PMR cyan);
 *  other speeches cycle through the four fills. */
const SPEECH_FILL: Record<string, number> = { PMC: 0, LOC: 1, MG: 2, MO: 3, LOR: 0, PMR: 3 };
export function speechFillSlot(name: string, index: number): number {
  return SPEECH_FILL[name] ?? index % 4;
}
