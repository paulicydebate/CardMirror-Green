// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrepSession, checkPrepSeal, verifyPrepLog } from '../../apps/desktop/src/prep-session.js';

let dir: string;
const now = () => new Date('2026-10-26T22:00:00.000Z');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cm-prep-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const logPath = (id: string) => join(dir, 'lockdown', `${id}.jsonl`);

describe('Prep / Round session foundation', () => {
  it('records the complete lifecycle, keeps stable prep identities and seals the final log', () => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    session.documentCreated('new-blank', 1);
    session.markPrepDocument('new-blank', 1);
    session.record('input', { text: 'A typed argument' }, 1, 'new-blank');
    session.record('macro', { text: 'expanded words' }, 1, 'new-blank');
    session.record('autocorrect', { text: 'corrected words' }, 1, 'new-blank');
    expect(session.startRound()).toMatchObject({ mode: 'round', prepDocIds: ['new-blank'], roundStartedAt: now().toISOString() });
    session.documentCreated('blank-in-round', 2);
    const result = session.end();
    expect(result.state).toMatchObject({ prepStartedAt: now().toISOString(), endedAt: now().toISOString() });
    const log = verifyPrepLog(readFileSync(logPath(start.sessionId), 'utf8'), result.finalHash);
    expect(log.sealCode).toBe(result.sealCode);
    expect(log.entries.map(e => e.kind)).toEqual(['prep-start', 'document-created', 'prep-document-marked', 'input', 'macro', 'autocorrect', 'round-start', 'document-created', 'document-fingerprints', 'session-end']);
    expect(session.snapshot()).toBeNull();
    expect(new PrepSession(dir, now).snapshot()).toBeNull();
  });

  it('rejects preexisting docs, duplicate identities, repeated starts and backwards transitions without logging them', () => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    expect(() => session.start()).toThrow('already active');
    expect(() => session.markPrepDocument('old-file', 1)).toThrow('Only new');
    session.documentCreated('blank', 1);
    expect(() => session.documentCreated('blank', 2)).toThrow('Duplicate');
    session.markPrepDocument('blank', 1);
    expect(() => session.markPrepDocument('blank', 1)).toThrow('Only new');
    session.startRound();
    expect(() => session.startRound()).toThrow('already started');
    session.documentCreated('round-blank', 2);
    expect(() => session.markPrepDocument('round-blank', 2)).toThrow('Only new');
    expect(verifyPrepLog(readFileSync(logPath(start.sessionId), 'utf8')).entries).toHaveLength(5);
  });

  it.each(['prep', 'round'] as const)('resumes %s state from disk, preserving prep docs and logging restart', mode => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    session.documentCreated('blank', 1);
    session.markPrepDocument('blank', 1);
    if (mode === 'round') session.startRound();
    const resumed = new PrepSession(dir, now);
    expect(resumed.snapshot()).toMatchObject({ mode, sessionId: start.sessionId, prepDocIds: ['blank'], newDocIds: ['blank'] });
    const text = readFileSync(logPath(start.sessionId), 'utf8');
    expect(verifyPrepLog(text).entries.at(-1)?.kind).toBe('app-restart');
  });

  it('does not expose mutable session state and refuses logging strategy-doc content', () => {
    const session = new PrepSession(dir, now);
    session.start();
    session.snapshot()!.prepDocIds.push('strategy');
    expect(() => session.record('input', { text: 'private' }, 1, 'strategy')).toThrow('only for prep');
    expect(session.snapshot()!.prepDocIds).toEqual([]);
    session.record('document-opened', { name: 'strategy' }, 1, 'strategy');
  });

  it('rejects tampering, reordering, missing entries and incomplete final writes', () => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    session.documentCreated('blank', 1);
    session.markPrepDocument('blank', 1);
    session.record('input', { text: 'typed' }, 1, 'blank');
    const end = session.end();
    const text = readFileSync(logPath(start.sessionId), 'utf8');
    expect(() => verifyPrepLog(text.replace('typed', 'pasted'))).toThrow('chain');
    const lines = text.trimEnd().split('\n');
    expect(() => verifyPrepLog([lines[0], lines[2], lines[1], ...lines.slice(3)].join('\n') + '\n')).toThrow('chain');
    expect(() => verifyPrepLog(lines.slice(1).join('\n') + '\n')).toThrow('chain');
    expect(() => verifyPrepLog(text.slice(0, -2))).toThrow('incomplete');
    // A valid prefix still needs comparison to the independently recorded seal.
    expect(() => verifyPrepLog(lines.slice(0, -1).join('\n') + '\n', end.finalHash)).toThrow('seal');
  });

  it('fails closed on corrupt logs and path traversal in the active pointer', () => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    writeFileSync(logPath(start.sessionId), 'broken\n');
    expect(() => new PrepSession(dir, now)).toThrow();
    writeFileSync(join(dir, 'lockdown', 'state.json'), JSON.stringify({ sessionId: '../outside' }));
    expect(() => new PrepSession(dir, now)).toThrow('pointer');
  });

  it('recovers a crash after the end event but before removing the state pointer', () => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    const pointer = readFileSync(join(dir, 'lockdown', 'state.json'), 'utf8');
    session.end();
    writeFileSync(join(dir, 'lockdown', 'state.json'), pointer);
    expect(new PrepSession(dir, now).snapshot()).toBeNull();
  });

  it('does not advance state after a failed durable write and refuses further session operations', () => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    unlinkSync(logPath(start.sessionId));
    mkdirSync(logPath(start.sessionId));
    expect(() => session.startRound()).toThrow();
    expect(session.snapshot()?.mode).toBe('prep');
    expect(() => session.documentCreated('blank', 1)).toThrow('logging failed');
    expect(() => session.end()).toThrow('logging failed');
    expect(session.loggingFailed).toBe(true);
  });

  it('does not silently recreate a deleted log while a session is active', () => {
    const session = new PrepSession(dir, now);
    const start = session.start();
    unlinkSync(logPath(start.sessionId));
    expect(() => session.record('focus', {}, 1)).toThrow();
    expect(session.loggingFailed).toBe(true);
    expect(readdirSync(join(dir, 'lockdown'))).not.toContain(`${start.sessionId}.jsonl`);
  });
  it('keeps prep identity across save/reopen, Save As, aliases, and process restart', () => {
    const session = new PrepSession(dir, now);
    session.start(); session.documentCreated('original', 1); session.markPrepDocument('original', 1);
    session.bindIdentity('original', 'persistent-doc-id', 1);
    session.restoreIdentity('reopened', 'persistent-doc-id', 2);
    expect(session.snapshot()?.prepDocIds).toEqual(['original', 'reopened']);
    expect(() => session.restoreIdentity('old-file', 'unrelated-doc-id', 2)).toThrow('Unknown');
    const resumed = new PrepSession(dir, now);
    expect(resumed.snapshot()?.persistentDocIds).toEqual({ 'persistent-doc-id': 'original' });
    expect(resumed.snapshot()?.prepDocIds).toEqual(['original', 'reopened']);
    resumed.restoreIdentity('save-as-copy', 'persistent-doc-id', 3);
    expect(resumed.snapshot()?.prepDocIds).toContain('save-as-copy');
  });
  it('protects blank documents created during Round so they cannot become a paste bypass', () => {
    const session = new PrepSession(dir, now); session.start(); session.startRound();
    session.documentCreated('round-blank', 1);
    expect(session.snapshot()?.prepDocIds).toContain('round-blank');
    expect(new PrepSession(dir, now).snapshot()?.prepDocIds).toContain('round-blank');
  });

  it('supports successive sessions without overwriting logs and validates JSON before writing', () => {
    const session = new PrepSession(dir, now);
    const first = session.start();
    expect(() => session.record('focus', { invalid: undefined }, 1)).toThrow('JSON');
    expect(() => session.record('focus', {}, -1)).toThrow('window');
    expect(verifyPrepLog(readFileSync(logPath(first.sessionId), 'utf8')).entries).toHaveLength(1);
    session.end();
    const second = session.start();
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(readdirSync(join(dir, 'lockdown')).filter(n => n.endsWith('.jsonl'))).toHaveLength(2);
    expect(() => new PrepSession(dir, now).record('session-end' as 'focus', {}, 1)).toThrow('Reserved');
  });
});

describe('Prep seal for Check Prep Document', () => {
  const fp = (c: string) => c.repeat(64);
  function sealed() {
    const session = new PrepSession(dir, now);
    const start = session.start();
    session.documentCreated('doc-a', 1);
    session.markPrepDocument('doc-a', 1);
    session.documentCreated('doc-b', 1);
    session.markPrepDocument('doc-b', 1);
    session.startRound();
    const result = session.end([
      { document: 'doc-a', persistentId: 'file-a', name: 'Gov case', fingerprint: fp('a') },
      { document: 'doc-b', persistentId: 'file-b', name: 'Off 1', fingerprint: fp('b') },
    ]);
    return { start, result };
  }

  it('seals fingerprints into the log just before the end, under the same seal code', () => {
    const { start, result } = sealed();
    const log = verifyPrepLog(readFileSync(logPath(start.sessionId), 'utf8'), result.finalHash);
    expect(log.entries.slice(-2).map(e => e.kind)).toEqual(['document-fingerprints', 'session-end']);
    expect(result.certificate.entries).toEqual(log.entries.slice(-2));
    expect(result.sealCode).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  });

  it('answers unchanged, modified, wrong code, not in seal and damaged', () => {
    const { result } = sealed();
    const cert = JSON.parse(JSON.stringify(result.certificate));
    const unchanged = checkPrepSeal(cert, result.sealCode.toLowerCase(), 'file-a', fp('a'));
    expect(unchanged).toMatchObject({ status: 'unchanged', name: 'Gov case', sealCode: result.sealCode, endedAt: now().toISOString(), roundStartedAt: now().toISOString() });
    expect(checkPrepSeal(cert, result.sealCode.replace(/-/g, ''), 'file-b', fp('b')).status).toBe('unchanged');
    expect(checkPrepSeal(cert, result.finalHash, 'file-a', fp('a')).status).toBe('unchanged');
    expect(checkPrepSeal(cert, result.sealCode, 'file-a', fp('c')).status).toBe('modified');
    expect(checkPrepSeal(cert, '0000-0000-0000-0000', 'file-a', fp('a')).status).toBe('wrong-code');
    expect(checkPrepSeal(cert, result.sealCode, 'other-file', fp('a')).status).toBe('not-in-seal');
    // Editing the sealed fingerprint (to make a changed doc pass) breaks the chain.
    const forged = JSON.parse(JSON.stringify(cert));
    forged.entries[0].data.docs[0].fingerprint = fp('c');
    expect(checkPrepSeal(forged, result.sealCode, 'file-a', fp('c')).status).toBe('damaged');
    expect(checkPrepSeal({ format: 'other' }, result.sealCode, 'file-a', fp('a')).status).toBe('damaged');
    expect(checkPrepSeal(null, result.sealCode, 'file-a', fp('a')).status).toBe('damaged');
  });

  it('only seals prep docs, with valid fingerprints', () => {
    const session = new PrepSession(dir, now);
    session.start();
    session.documentCreated('doc-a', 1);
    session.markPrepDocument('doc-a', 1);
    expect(() => session.end([{ document: 'strategy-doc', persistentId: 'x', name: 'Doc 1', fingerprint: fp('a') }])).toThrow('Invalid document fingerprint');
    expect(() => session.end([{ document: 'doc-a', persistentId: 'x', name: 'A', fingerprint: 'nope' }])).toThrow('Invalid document fingerprint');
    expect(session.end([]).certificate.entries.map(e => e.kind)).toEqual(['document-fingerprints', 'session-end']);
  });
});
