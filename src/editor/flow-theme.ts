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

export type FlowBaseId = 'light' | 'dark' | 'classic' | 'contrast' | 'soft' | 'soft-dark';
export type FlowTextSize = 'small' | 'medium' | 'large';
export type FlowFont = 'ui' | 'arial' | 'serif' | 'soft';

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
  /** Derive pastel side colors from the colorway's hues (Flower-style). */
  pastel?: boolean;
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
  // Flower-inspired (Ashwagandhae/debate-flow): softened gray text, pastel
  // text colors over neutral layers, without speech-colored column fills.
  soft: {
    label: 'Soft',
    dark: false,
    fills: false,
    stripes: false,
    font: 'soft',
    pastel: true,
    vars: {
      '--flow-bg': 'hsl(0 0% 100%)', '--flow-panel': 'hsl(0 0% 95%)', '--flow-line': 'hsl(0 0% 94%)', '--flow-text': 'hsl(0 0% 30%)',
      '--flow-muted': 'hsl(0 0% 50%)', '--flow-shadow': 'none',
      '--flow-tint-aff': 'var(--flow-bg)',
      '--flow-tint-neg': 'var(--flow-bg)',
      '--flow-stripe': 'transparent',
      '--flow-hl': 'rgba(34, 230, 80, 0.30)',
    },
  },
  'soft-dark': {
    label: 'Soft dark',
    dark: true,
    fills: false,
    stripes: false,
    font: 'soft',
    pastel: true,
    vars: {
      '--flow-bg': 'hsl(0 0% 16%)', '--flow-panel': 'hsl(0 0% 10%)', '--flow-line': 'hsl(0 0% 19%)', '--flow-text': 'hsl(0 0% 80%)',
      '--flow-muted': 'hsl(0 0% 60%)', '--flow-shadow': 'none',
      '--flow-tint-aff': 'var(--flow-bg)',
      '--flow-tint-neg': 'var(--flow-bg)',
      '--flow-stripe': 'transparent',
      '--flow-hl': 'rgba(57, 255, 20, 0.22)',
    },
  },
};

interface Colorway {
  label: string;
  /** Text colors on light backgrounds (darker shades) and dark backgrounds (lighter shades). */
  light: { aff: string; neg: string };
  dark: { aff: string; neg: string };
  /** Muted shades tuned for the Soft backgrounds instead of hue-only conversion. */
  softLight?: { aff: string; neg: string };
  softDark?: { aff: string; neg: string };
}

/** Curated two-color sets; the first color is the first side (aff / gov). */
export const FLOW_COLORWAYS: Record<string, Colorway> = {
  'sage-plum': { label: 'Sage & Plum', light: { aff: '#32644c', neg: '#764565' }, dark: { aff: '#add6bd', neg: '#dfb2d1' }, softLight: { aff: '#32644c', neg: '#764565' }, softDark: { aff: '#add6bd', neg: '#dfb2d1' } },
  'slate-rose': { label: 'Slate & Rose', light: { aff: '#405e7d', neg: '#8c4559' }, dark: { aff: '#afcae4', neg: '#efb5c4' }, softLight: { aff: '#405e7d', neg: '#8c4559' }, softDark: { aff: '#afcae4', neg: '#efb5c4' } },
  'periwinkle-apricot': { label: 'Periwinkle & Apricot', light: { aff: '#57568a', neg: '#89502f' }, dark: { aff: '#c5c1ee', neg: '#edc3a1' }, softLight: { aff: '#57568a', neg: '#89502f' }, softDark: { aff: '#c5c1ee', neg: '#edc3a1' } },
  'seafoam-lilac': { label: 'Seafoam & Lilac', light: { aff: '#28686a', neg: '#795387' }, dark: { aff: '#a9dcd5', neg: '#d8bce6' }, softLight: { aff: '#28686a', neg: '#795387' }, softDark: { aff: '#a9dcd5', neg: '#d8bce6' } },
  'denim-copper': { label: 'Denim & Copper', light: { aff: '#3b5c82', neg: '#8b4c38' }, dark: { aff: '#b0cbe9', neg: '#edbba7' }, softLight: { aff: '#3b5c82', neg: '#8b4c38' }, softDark: { aff: '#b0cbe9', neg: '#edbba7' } },
  'olive-mauve': { label: 'Olive & Mauve', light: { aff: '#586329', neg: '#805272' }, dark: { aff: '#cad59e', neg: '#dcb7d0' }, softLight: { aff: '#586329', neg: '#805272' }, softDark: { aff: '#cad59e', neg: '#dcb7d0' } },
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
  soft: '"Merriweather Sans", var(--pmd-ui-font, system-ui, sans-serif)',
};
/** Body weight per font: the soft font is set light (bold cells stay 700). */
const FONT_WEIGHTS: Record<FlowFont, string> = { ui: '400', arial: '400', serif: '400', soft: '300' };

/** Hue (0-360) and saturation (0-1) of a #rrggbb color. */
function hexHueSat(hex: string): { h: number; s: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60);
  return { h: h < 0 ? h + 360 : h, s };
}

/** Pastels on dark; deepen bright light-theme hues until text stays readable. */
export function pastelSideColor(hex: string, dark: boolean): string {
  const { h, s } = hexHueSat(hex);
  if (s < 0.1) return dark ? 'hsl(0 0% 85%)' : 'hsl(0 0% 25%)';
  if (dark) return `hsl(${h} 60% 80%)`;
  let lightness = 30;
  while (lightness > 20 && hexLuminance(flowColorPickerValue(`hsl(${h} 90% ${lightness}%)`)) > .16) lightness--;
  return `hsl(${h} 90% ${lightness}%)`;
}
function hexLuminance(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722;
}
/** Native color inputs require hex, even when the theme uses HSL. */
export function flowColorPickerValue(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const hsl = /^hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)$/.exec(color);
  if (!hsl) return '#000000';
  const h = Number(hsl[1]), s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return '#' + channel(0) + channel(8) + channel(4);
}
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
  const spec = FLOW_BASES[base];
  if (base === 'soft' && cw.softLight) return cw.softLight;
  if (base === 'soft-dark' && cw.softDark) return cw.softDark;
  const shade = spec.dark ? cw.dark : cw.light;
  if (!spec.pastel) return shade;
  return { aff: pastelSideColor(shade.aff, spec.dark), neg: pastelSideColor(shade.neg, spec.dark) };
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
  root.style.setProperty('--flow-weight', FONT_WEIGHTS[theme.font ?? base.font]);
  root.style.setProperty('--flow-selection-bg', base.dark ? 'color-mix(in srgb, var(--flow-bg) 72%, black)' : 'var(--flow-bg)');
  root.style.setProperty('--flow-size', SIZES[theme.size]);
  root.dataset['flowTheme'] = theme.base;
  root.dataset['flowColorway'] = theme.colorway;
  root.classList.toggle('pmd-flow-dark', base.dark);
  root.classList.toggle('pmd-flow-usefills', base.fills);
  root.classList.toggle('pmd-flow-stripes', base.stripes);
  root.classList.toggle('pmd-flow-neutral', theme.base === 'soft' || theme.base === 'soft-dark');
}

/** Template fill slot for a speech column: the parli template colors each
 *  speech (PMC yellow, LOC green, MG orange, MO cyan, LOR yellow, PMR cyan);
 *  other speeches cycle through the four fills. */
const SPEECH_FILL: Record<string, number> = { PMC: 0, LOC: 1, MG: 2, MO: 3, LOR: 0, PMR: 3 };
export function speechFillSlot(name: string, index: number): number {
  return SPEECH_FILL[name] ?? index % 4;
}
