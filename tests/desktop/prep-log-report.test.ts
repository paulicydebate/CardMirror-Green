// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createPrepLogReport, exportPrepLogReport } from '../../apps/desktop/src/prep-log-report.js';
const records = (items: Array<[string, unknown, number?]>) => items.map(([kind,data,ms],i) => JSON.stringify({seq:i,time:new Date(Date.UTC(2026,9,27,3,0,0,ms ?? i*100)).toISOString(),kind,data,document:'d',window:1})).join('\n');
describe('readable Prep reports', () => {
  it('groups accepted typing without counting beforeinput twice and keeps deletion separate', () => {
    const text=records([['input',{phase:'beforeinput',inputType:'insertText',text:'h'}],['input',{phase:'transaction',inserted:['h'],deleted:0}],['input',{phase:'beforeinput',inputType:'insertText',text:'i'}],['input',{phase:'transaction',inserted:['i'],deleted:0}],['input',{phase:'beforeinput',inputType:'deleteContentBackward'}],['input',{phase:'transaction',inserted:[],deleted:1}]]);
    const report=createPrepLogReport(text,{timeZone:'America/Los_Angeles'});
    expect(report.typedCharacters).toBe(2); expect(report.rows.map(r=>r.action)).toEqual(['Typed','Deleted']); expect(report.rows[0]!.text).toBe('hi'); expect(report.deletedCharacters).toBe(1);
    expect(exportPrepLogReport(report)).toContain('Oct 26, 2026');
  });
  it('distinguishes blocked transfers, accepted paste, unknown inserts and unconfirmed input', () => {
    const report=createPrepLogReport(records([['blocked',{reason:'copy'}],['blocked',{reason:'paste'}],['input',{phase:'beforeinput',inputType:'insertFromPaste',text:'abc'}],['input',{phase:'transaction',inserted:['abc']}],['input',{phase:'transaction',inserted:['unknown']}],['input',{phase:'beforeinput',inputType:'insertText',text:'x'}]]));
    expect(report.blockedCopies).toBe(1); expect(report.blockedPastes).toBe(1); expect(report.recordedPastes).toBe(1); expect(report.typedCharacters).toBe(0);
    expect(report.rows.map(r=>r.action)).toEqual(['Copy blocked','Paste blocked','Paste recorded','Text inserted (source unconfirmed)','Input attempted (not confirmed)']);
  });
  it('does not let a remote edit consume a pending local input',()=>{
    const report=createPrepLogReport(records([['input',{phase:'beforeinput',inputType:'insertText',text:'a'}],['remote-insert',{inserted:['remote']}],['input',{phase:'transaction',inserted:['a']}]]));
    expect(report.typedCharacters).toBe(1); expect(report.rows[0]!.action).toBe('Partner edit');
  });
  it('rejects malformed logs and never presents an unchecked seal as verified',()=>{
    expect(()=>createPrepLogReport('broken')).toThrow();
    const report=createPrepLogReport(records([['session-end',{}]]),{sealCode:'ABCD'});
    expect(exportPrepLogReport(report)).toContain('No verified final seal supplied');
  });
});
