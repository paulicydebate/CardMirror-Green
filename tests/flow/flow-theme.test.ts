import { flowKeyForEvent, validFlowShortcut } from '../../src/editor/flow-shortcuts.js';
import { describe, expect, it } from 'vitest';
import { FLOW_BASES, FLOW_COLORWAYS, flowColorPickerValue, normalizeTheme, pastelSideColor, themeSideColors } from '../../src/editor/flow-theme.js';

describe('flow theme', () => {
  it('keeps new muted Soft palettes readable on their normal and selected-cell backgrounds', () => {
    const luminance = (hex: string) => {
      const channels = [1,3,5].map(i => parseInt(hex.slice(i, i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
      return channels[0]!*.2126 + channels[1]!*.7152 + channels[2]!*.0722;
    };
    const contrast = (a: string, b: string) => { const values=[luminance(a),luminance(b)].sort((x,y)=>y-x); return (values[0]!+.05)/(values[1]!+.05); };
    for (const colorway of Object.keys(FLOW_COLORWAYS)) {
      for (const base of ['soft','soft-dark'] as const) {
        const colors = themeSideColors(normalizeTheme({base, colorway}));
        for (const color of Object.values(colors)) for (const background of base === 'soft' ? ['#ffffff'] : ['#292929','#1e1e1e']) {
          expect(contrast(flowColorPickerValue(color), background), `${colorway}/${base}: ${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    expect(themeSideColors(normalizeTheme({base:'soft-dark',colorway:'sage-plum',affText:'#abcdef'})).aff).toBe('#abcdef');
  });
  it('shows the actual HSL palette shade in native hex-only color pickers', () => {
    expect(flowColorPickerValue('hsl(0 0% 85%)')).toBe('#d9d9d9');
    expect(flowColorPickerValue('hsl(120 60% 80%)')).toBe('#adebad');
    expect(flowColorPickerValue('#ABCDEF')).toBe('#abcdef');
  });
  it('ships at least 10 two-color colorways with readable shades for both backgrounds', () => {
    const colorful = Object.keys(FLOW_COLORWAYS).filter((k) => k !== 'ink');
    expect(colorful.length).toBeGreaterThanOrEqual(10);
    expect(colorful).toEqual(expect.arrayContaining(['green-pink', 'yellow-purple', 'teal-orange']));
    for (const cw of Object.values(FLOW_COLORWAYS)) {
      for (const shade of [cw.light, cw.dark]) {
        expect(shade.aff).toMatch(/^#[0-9a-f]{6}$/i);
        expect(shade.neg).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('validates Flow highlight preferences without stealing editing and file shortcuts', () => {
    expect(normalizeTheme({highlightColor: '#ffe100', highlightKey: 'F8'})).toMatchObject({highlightColor: '#ffe100', highlightKey: 'F8'});
    expect(normalizeTheme({highlightColor: 'red', highlightKey: 'Mod-v'})).toMatchObject({highlightColor: null, highlightKey: 'Mod-Shift-h'});
    for (const key of ['a', 'Shift-a', 'Mod-c', 'Mod-v', 'Mod-z', 'Mod-s', 'Mod-w']) expect(validFlowShortcut(key)).toBe(false);
    expect(validFlowShortcut('Mod-Alt-h')).toBe(true);
    expect(flowKeyForEvent({key: 'H', code: 'KeyH', metaKey: true, shiftKey: true} as KeyboardEvent)).toBe('Mod-Shift-h');
  });
  it('normalizes stored values, migrating the earlier single-preset format', () => {
    expect(normalizeTheme(null)).toMatchObject({ base: 'dark', colorway: 'green-pink', size: 'medium' });
    expect(normalizeTheme({ preset: 'classic' })).toMatchObject({ base: 'classic', colorway: 'ink' });
    expect(normalizeTheme({ base: 'nope', colorway: 'nope', affText: 'red', size: 'huge' })).toMatchObject({ base: 'dark', colorway: 'green-pink', affText: null, size: 'medium' });
    expect(themeSideColors(normalizeTheme({ base: 'light', colorway: 'teal-orange', negText: '#abcdef' }))).toEqual({ aff: '#0f766e', neg: '#abcdef' });
  });

  it('adds Flower-style Soft bases without changing the existing ones', () => {
    expect(FLOW_BASES.soft).toMatchObject({ label: 'Soft', dark: false, font: 'soft', pastel: true });
    expect(FLOW_BASES['soft-dark']).toMatchObject({ label: 'Soft dark', dark: true, font: 'soft', pastel: true });
    expect(FLOW_BASES['soft-dark'].vars).toMatchObject({ '--flow-text': 'hsl(0 0% 80%)', '--flow-bg': 'hsl(0 0% 16%)', '--flow-panel': 'hsl(0 0% 10%)', '--flow-shadow': 'none' });
    expect(FLOW_BASES.soft.vars).toMatchObject({ '--flow-text': 'hsl(0 0% 30%)', '--flow-panel': 'hsl(0 0% 95%)', '--flow-shadow': 'none' });
    expect(normalizeTheme({ base: 'soft-dark' }).base).toBe('soft-dark');
    expect(pastelSideColor('#4ade80', true)).toMatch(/^hsl\(\d+ 60% 80%\)$/);
    expect(pastelSideColor('#15803d', false)).toMatch(/^hsl\(\d+ 90% (?:2\d|30)%\)$/);
    expect(pastelSideColor('#f2f2f2', true)).toBe('hsl(0 0% 85%)');
    expect(themeSideColors(normalizeTheme({ base: 'soft', colorway: 'teal-orange', negText: '#abcdef' })).neg).toBe('#abcdef');
    // Existing bases keep their colorway hexes.
    expect(themeSideColors(normalizeTheme({ base: 'dark', colorway: 'green-pink' }))).toEqual({ aff: '#4ade80', neg: '#f472b6' });
  });
});
