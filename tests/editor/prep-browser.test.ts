import { describe, expect, it } from 'vitest';
import { BrowserPrepSession, verifyBrowserPrepLog, type BrowserPrepStorage } from '../../src/editor/prep-browser.js';
import { verifyPrepLog, checkPrepSeal } from '../../apps/desktop/src/prep-session.js';
import { createPrepLogReport } from '../../apps/desktop/src/prep-log-report.js';

function fixture() {
  let active: string | null = null;
  const logs = new Map<string, { id: string; entries: Parameters<typeof verifyBrowserPrepLog>[0] }>();
  let fail = false;
  const storage: BrowserPrepStorage = {
    async load() { return structuredClone({ active, logs: [...logs.values()] }); },
    async commit(log, nextActive) { if (fail) throw new Error('Quota exceeded'); logs.set(log.id, structuredClone(log)); active = nextActive; },
  };
  return { storage, fail: () => { fail = true; }, logs };
}
describe('tablet durable Prep sessions', () => {
  it('preserves restrictions on restart, exports desktop-compatible chains and seals, and distinguishes input sources', async () => {
    const f = fixture(), owner = new BrowserPrepSession(f.storage);
    await owner.load(); await owner.start();
    await owner.documentAction('created-prep', 'prep1'); await owner.documentAction('bind', 'prep1', 'file1');
    await owner.events([
      { kind: 'input', uid: 'strategy', data: { phase: 'transaction', inserted: ['PRIVATE STRATEGY'] } },
      { kind: 'input', uid: 'prep1', data: { phase: 'beforeinput', inputType: 'insertText', text: 'hello' } },
      { kind: 'input', uid: 'prep1', data: { phase: 'transaction', inserted: ['hello'] } },
      { kind: 'blocked', uid: 'prep1', data: { reason: 'paste' } },
      { kind: 'remote-insert', uid: 'prep1', data: { inserted: ['partner'], partners: ['Partner'] } },
    ]);
    await owner.round();
    const resumed = new BrowserPrepSession(f.storage); await resumed.load();
    expect(resumed.state?.mode).toBe('round'); expect(resumed.state?.prepDocIds).toEqual(['prep1']);
    await resumed.documentAction('restore', 'reopened', 'file1');
    expect(resumed.state?.prepDocIds).toContain('reopened');
    const fingerprint = 'a'.repeat(64);
    const result = await resumed.end([{ document: 'prep1', persistentId: 'file1', name: 'Prep', fingerprint }]) as { certificate: unknown; sealCode: string };
    const entries = [...resumed.logs.values()][0]!;
    const text = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    expect(text).not.toContain('PRIVATE STRATEGY');
    expect(verifyPrepLog(text).sealCode).toBe(result.sealCode);
    expect(checkPrepSeal(result.certificate, result.sealCode, 'file1', fingerprint).status).toBe('unchanged');
    expect(checkPrepSeal(result.certificate, result.sealCode, 'file1', 'b'.repeat(64)).status).toBe('modified');
    const report = createPrepLogReport(text);
    expect(report.rows.map(r => r.action)).toEqual(expect.arrayContaining(['Typed', 'Paste blocked', 'Partner edit']));
    const after = new BrowserPrepSession(f.storage); await after.load(); expect(after.state).toBeNull();
  });
  it('does not advance the durable log on storage failure and refuses damaged active logs on restart', async () => {
    const f = fixture(), owner = new BrowserPrepSession(f.storage); await owner.start();
    const id = owner.state!.sessionId;
    f.fail(); await expect(owner.documentAction('created', 'doc')).rejects.toThrow('Quota');
    expect(f.logs.get(id)!.entries).toHaveLength(1);
    f.logs.get(id)!.entries[0]!.data = { tampered: true };
    await expect(new BrowserPrepSession(f.storage).load()).rejects.toThrow('damaged');
  });
  it('refuses pre-existing marking and unknown file identities; protects new Round documents', async () => {
    const f = fixture(), owner = new BrowserPrepSession(f.storage); await owner.start();
    await expect(owner.documentAction('mark', 'old')).rejects.toThrow('new blank');
    await expect(owner.documentAction('restore', 'old', 'unknown')).rejects.toThrow('Unknown');
    await expect(owner.round()).rejects.toThrow('prep document');
    await owner.documentAction('created-prep', 'prep'); await owner.round();
    await owner.documentAction('created', 'round-notes');
    expect(owner.state!.prepDocIds).toContain('round-notes');
  });
});
