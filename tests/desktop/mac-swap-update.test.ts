// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, chmodSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildSwapScript, bundlePathFromExe, macBundleSelfUpdatable } from '../../apps/desktop/src/mac-swap-update.js';
const describePosix = describe.skipIf(process.platform === 'win32');
const hash = createHash('sha512').update('synthetic').digest('base64');
describePosix('Green Mac updater', () => {
  it('recognizes only app executable layouts and rejects translocation', () => {
    expect(bundlePathFromExe('/Applications/cardmirror-green.app/Contents/MacOS/cardmirror-green')).toBe('/Applications/cardmirror-green.app');
    expect(bundlePathFromExe('/tmp/fake.app/other/bin/program')).toBeNull();
    expect(macBundleSelfUpdatable('/private/AppTranslocation/ABC/cardmirror-green.app/Contents/MacOS/cardmirror-green')).toBe(false);
  });
  it('requires a writable bundle and parent', () => {
    const dir=mkdtempSync(path.join(os.tmpdir(),'cm-green-gate-'));
    try {
      const app=path.join(dir,'cardmirror-green.app');mkdirSync(path.join(app,'Contents','MacOS'),{recursive:true});
      const exe=path.join(app,'Contents','MacOS','cardmirror-green');expect(macBundleSelfUpdatable(exe)).toBe(true);
      chmodSync(app,0o555);
      try { if (process.getuid?.() !== 0) expect(macBundleSelfUpdatable(exe)).toBe(false); } finally { chmodSync(app,0o755); }
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it('quotes paths, validates before swapping, retains backups and preserves quarantine', () => {
    const script=buildSwapScript({pid:4242,zipPath:"/tmp/it's a test/update.zip",appBundlePath:'/Applications/cardmirror-green.app',sha512:hash,version:'1.16.4'});
    expect(script).toContain("'/tmp/it'\\''s a test/update.zip'");
    expect(script.indexOf('kill -0')).toBeLessThan(script.indexOf('ditto -x -k'));
    const swap=script.indexOf('mv "$APP" "$STAGE/previous.app"');
    for (const check of ['update ZIP hash mismatch','update identity mismatch','update version mismatch','update signature invalid']) expect(script.indexOf(check)).toBeLessThan(swap);
    expect(script).toContain('mv "$STAGE/previous.app" "$APP"');
    expect(script).toContain('open -n "$APP"');
    expect(script).not.toContain('rm -rf');expect(script).not.toContain('xattr -d');
  });
  it('rejects malformed expected digests, versions and pids', () => {
    const args={pid:4242,zipPath:'/tmp/update.zip',appBundlePath:'/Applications/cardmirror-green.app',sha512:hash,version:'1.16.4'};
    expect(()=>buildSwapScript({...args,sha512:'wrong'})).toThrow();
    expect(()=>buildSwapScript({...args,version:'1.0; command'})).toThrow();
    expect(()=>buildSwapScript({...args,pid:-1})).toThrow();
  });
});
// Real ditto/codesign/rename against synthetic bundles on hosted macOS.
// Relaunch is disabled: these checks never launch an application.
describe.skipIf(process.platform !== 'darwin')('Mac helper execution with synthetic bundles', () => {
  function exercise(mode: 'success'|'hash'|'identity'|'signature') {
    const dir=mkdtempSync(path.join(os.tmpdir(),"cm-green's-test-"));
    try {
      const installed=path.join(dir,'installed','cardmirror-green.app');
      const incoming=path.join(dir,'incoming','cardmirror-green.app');
      const make=(app:string,version:string,id='com.paulicydebate.cardmirror.green') => {
        mkdirSync(path.join(app,'Contents','MacOS'),{recursive:true});
        writeFileSync(path.join(app,'Contents','Info.plist'),`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>cardmirror-green</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
        const source=path.join(dir,'fixture.c');writeFileSync(source,'int main(void) { return 0; }');
        execFileSync('clang',[source,'-o',path.join(app,'Contents','MacOS','cardmirror-green')]);
        execFileSync('codesign',['--force','--deep','--sign','-',app]);
      };
      make(installed,'1.0.0');writeFileSync(path.join(installed,'old-marker'),'previous app');
      make(incoming,'1.16.4',mode==='identity'?'com.example.wrong':'com.paulicydebate.cardmirror.green');
      if(mode==='signature') writeFileSync(path.join(incoming,'Contents','MacOS','cardmirror-green'),'tampered');
      const zip=path.join(dir,'update.zip');execFileSync('ditto',['-c','-k','--keepParent',incoming,zip]);
      const digest=createHash('sha512').update(readFileSync(zip)).digest('base64');
      const script=path.join(dir,'install.sh');writeFileSync(script,buildSwapScript({pid:2147483647,zipPath:zip,appBundlePath:installed,sha512:mode==='hash'?hash:digest,version:'1.16.4',relaunch:false}));
      const result=spawnSync('/bin/bash',[script],{env:{...process.env,TMPDIR:dir},encoding:'utf8',timeout:15000});
      expect(result.error).toBeUndefined();
      if(mode==='success') {
        expect(result.status, readFileSync(path.join(dir,'cardmirror-green-update.log'),'utf8')).toBe(0);
        const stage=readdirSync(path.dirname(installed)).find(n=>n.startsWith('.cardmirror-green-update.'))!;
        expect(readFileSync(path.join(path.dirname(installed),stage,'previous.app','old-marker'),'utf8')).toBe('previous app');
        expect(readFileSync(path.join(installed,'Contents','Info.plist'),'utf8')).toContain('1.16.4');
      } else {
        expect(result.status).toBe(1);
        expect(readFileSync(path.join(installed,'old-marker'),'utf8')).toBe('previous app');
      }
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }
  it('installs a verified bundle and retains the previous bundle',()=>exercise('success'),30000);
  it('preserves the installed app when the ZIP hash differs',()=>exercise('hash'),30000);
  it('rejects another app identity before moving the installed app',()=>exercise('identity'),30000);
  it('rejects tampered executable signatures',()=>exercise('signature'),30000);
});
