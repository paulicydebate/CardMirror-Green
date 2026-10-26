import { describe, expect, it } from 'vitest';
import { FLOW_COLORWAYS, normalizeTheme, themeSideColors } from '../../src/editor/flow-theme.js';

describe('flow theme', () => {
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

  it('normalizes stored values, migrating the earlier single-preset format', () => {
    expect(normalizeTheme(null)).toMatchObject({ base: 'dark', colorway: 'green-pink', size: 'medium' });
    expect(normalizeTheme({ preset: 'classic' })).toMatchObject({ base: 'classic', colorway: 'ink' });
    expect(normalizeTheme({ base: 'nope', colorway: 'nope', affText: 'red', size: 'huge' })).toMatchObject({ base: 'dark', colorway: 'green-pink', affText: null, size: 'medium' });
    expect(themeSideColors(normalizeTheme({ base: 'light', colorway: 'teal-orange', negText: '#abcdef' }))).toEqual({ aff: '#0f766e', neg: '#abcdef' });
  });
});
