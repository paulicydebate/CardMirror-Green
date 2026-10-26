import { describe, expect, it } from 'vitest';
import {
  buildCutPrompt,
  CHAT_CUT_FORMAT,
  matchCutReply,
  normalizeWithMap,
  parseCutReply,
  type ChatCutReply,
  type CutSpan,
} from '../../src/cutting/chat-cut.js';

const PARAS = [
  'Nuclear war is not inevitable. However, the risk of escalation is “rising quickly” — experts say thermonuclear exchange could follow a regional conflict.',
  'Deterrence still works in most cases, but miscalculation is the most likely path to war.',
];

const reply = (r: Partial<ChatCutReply>): ChatCutReply => ({ tag: null, underline: [], emphasis: [], highlight: [], ...r });
const text = (s: CutSpan): string => PARAS[s.p]!.slice(s.start, s.end);

describe('chat cut prompt', () => {
  it('includes the rules, the format and only the cleaned card text', () => {
    const prompt = buildCutPrompt({ tag: 'Escalation  risk', cite: 'Smith 25', paragraphs: ['  a\n b ', '', 'c'], purpose: 'war is likely', targetWords: 40 });
    expect(prompt).toContain('The card should prove: war is likely');
    expect(prompt).toContain('Aim for about 40 highlighted words.');
    expect(prompt).toContain(`"format": "${CHAT_CUT_FORMAT}"`);
    expect(prompt).toContain('CURRENT TAG (may be improved): Escalation risk');
    expect(prompt).toContain('<<<\na b\n\nc\n>>>');
  });
});

describe('parseCutReply', () => {
  it('reads JSON from a fenced block surrounded by chatter', () => {
    const r = parseCutReply('Sure! Here you go:\n```json\n{"format":"cardmirror.cut.v1","tag":" T ","underline":["a"],"highlight":["b"]}\n```\nHope that helps.');
    expect(r).toEqual({ ok: true, reply: { tag: 'T', underline: ['a'], emphasis: [], highlight: ['b'] } });
  });

  it('repairs trailing commas and smart quotes used as JSON delimiters', () => {
    const r = parseCutReply('{“tag”: “T”, “underline”: [“a”,],}');
    expect(r).toMatchObject({ ok: true, reply: { tag: 'T', underline: ['a'] } });
  });

  it('rejects missing JSON, wrong shapes and unknown formats', () => {
    expect(parseCutReply('no json here')).toMatchObject({ ok: false });
    expect(parseCutReply('{"underline": "a"}')).toMatchObject({ ok: false, error: '"underline" must be a list of quotes' });
    expect(parseCutReply('{"format": "other", "tag": "x"}')).toMatchObject({ ok: false });
    expect(parseCutReply('{"underline": []}')).toMatchObject({ ok: false, error: 'The reply has no tag and no quotes.' });
  });
});

describe('matchCutReply', () => {
  it('finds exact quotes and maps them to original offsets', () => {
    const m = matchCutReply(PARAS, reply({ underline: ['the risk of escalation is', 'miscalculation is the most likely path to war'], highlight: ['risk of escalation', 'miscalculation', 'path to war'] }));
    expect(m.rejected).toEqual([]);
    expect(m.spans.filter((s) => s.layer === 'hl').map(text)).toEqual(['risk of escalation', 'miscalculation', 'path to war']);
    expect(m.counts).toEqual({ u: 2, em: 0, hl: 3 });
    expect(m.autoUnderlined).toBe(0);
    expect(m.highlightedWords).toBe(7);
  });

  it('tolerates straight quotes, plain hyphens, extra spaces and wrapping quote marks', () => {
    const m = matchCutReply(PARAS, reply({ underline: ['"rising quickly" - experts   say', '"Deterrence still works"'] }));
    expect(m.rejected).toEqual([]);
    expect(m.spans.map(text)).toEqual(['“rising quickly” — experts say', 'Deterrence still works']);
  });

  it('rejects invented or paraphrased text and quotes spanning paragraphs', () => {
    const m = matchCutReply(PARAS, reply({ underline: ['war is inevitable', 'regional conflict. Deterrence still works'], highlight: ['...'] }));
    expect(m.spans).toEqual([]);
    expect(m.rejected.map((r) => r.reason)).toEqual(['not-found', 'not-found', 'too-short']);
  });

  it('uses reading order to pick between repeated words and flags out-of-order quotes', () => {
    const m = matchCutReply(PARAS, reply({ highlight: ['war', 'war'] }));
    const hl = m.spans.filter((s) => s.layer === 'hl');
    expect(hl.map((s) => s.p)).toEqual([0, 1]);
    const back = matchCutReply(PARAS, reply({ highlight: ['Deterrence', 'Nuclear'] }));
    expect(back.outOfOrder.map((o) => o.quote)).toEqual(['Nuclear']);
  });

  it('prefers whole words, falling back to a part of a word', () => {
    const m = matchCutReply(PARAS, reply({ highlight: ['Nuclear war'] }));
    expect(m.spans[0]).toMatchObject({ p: 0, start: 0 });
    const part = matchCutReply(['thermonuclear exchange'], reply({ highlight: ['nuclear exchange'] }));
    expect(part.spans.filter((s) => s.layer === 'hl').map((s) => [s.start, s.end])).toEqual([[6, 22]]);
  });

  it('falls back to case-insensitive matching and reports it', () => {
    const m = matchCutReply(PARAS, reply({ underline: ['DETERRENCE still works'] }));
    expect(m.spans.map(text)).toEqual(['Deterrence still works']);
    expect(m.caseInsensitive).toHaveLength(1);
  });

  it('underlines highlighted text that was not underlined or boxed', () => {
    const m = matchCutReply(PARAS, reply({ underline: ['the risk of'], highlight: ['risk of escalation', 'quickly'], emphasis: ['quickly'] }));
    expect(m.autoUnderlined).toBe(1);
    const u = m.spans.filter((s) => s.layer === 'u').map(text);
    expect(u).toEqual(['the risk of', 'risk of escalation']);
  });

  it('normalizes with a map back to source indexes, including length-changing lowercase', () => {
    const n = normalizeWithMap('A  b­c…', false);
    expect(n.text).toBe('A bc...');
    expect(n.map).toEqual([0, 1, 3, 5, 6, 6, 6]);
    const lower = normalizeWithMap('İx', true);
    expect(lower.text.length).toBe(lower.map.length);
    const m = matchCutReply(['İstanbul trade grew'], reply({ highlight: ['trade grew'] }));
    expect(m.spans.filter((s) => s.layer === 'hl').map((s) => ['İstanbul trade grew'.slice(s.start, s.end)])).toEqual([['trade grew']]);
  });
});
