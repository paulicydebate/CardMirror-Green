// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { manualUpdates } from '../../apps/desktop/src/app-identity.js';
describe('Green Windows release policy', () => {
  it('enables Windows while leaving Mac and Linux manual', () => {
    expect(manualUpdates('win32')).toBe(false);
    expect(manualUpdates('darwin')).toBe(true);
    expect(manualUpdates('linux')).toBe(true);
  });
  it('keeps the release provider isolated and installs only on confirmation', () => {
    const config=JSON.parse(readFileSync('apps/desktop/package.json','utf8'));
    expect(config.build.publish).toMatchObject({provider:'github',owner:'paulicydebate',repo:'CardMirror-Green'});
    const main=readFileSync('apps/desktop/src/main.ts','utf8');
    expect(main).toContain('autoUpdater.autoInstallOnAppQuit = false;');
    expect(main).toContain('autoUpdater.quitAndInstall(true, true)');
    expect(JSON.parse(readFileSync('package.json','utf8')).version).toBe(config.version);
  });
});
