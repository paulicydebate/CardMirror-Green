/**
 * Copy-paste card cutting for chat AIs (Grok, ChatGPT, Claude chat, …).
 *
 * No API keys: the app builds a prompt holding the card's text and a strict
 * reply format, the user pastes it into any chat AI, then pastes the reply
 * back. The reply names text to underline / box (emphasis) / highlight as
 * EXACT QUOTES from the card. Every quote is located in the card's own text;
 * anything the AI invented, paraphrased or merged across paragraphs is
 * rejected and reported, never applied. Outside agents (Claude Code, Codex)
 * can produce the same reply format.
 *
 * Pure: no DOM, no ProseMirror. Text offsets are UTF-16 indexes into each
 * body paragraph's text as given by the caller.
 */

export const CHAT_CUT_FORMAT = 'cardmirror.cut.v1' as const;

export type CutLayer = 'u' | 'em' | 'hl';

export interface CutSpan {
  layer: CutLayer;
  /** Body paragraph index. */
  p: number;
  start: number;
  end: number;
}

export interface ChatCutReply {
  tag: string | null;
  underline: string[];
  emphasis: string[];
  highlight: string[];
}

export interface PromptInput {
  tag: string;
  cite: string;
  paragraphs: string[];
  /** What the card should prove, in the user's words. */
  purpose?: string;
  /** Rough number of highlighted words to aim for. */
  targetWords?: number | null;
}

const MAX_QUOTES = 400;
const MAX_QUOTE_CHARS = 5000;
const MAX_TAG_CHARS = 1000;

// ─── Prompt ──────────────────────────────────────────────────────────

/** Collapse whitespace runs so the AI sees (and quotes) clean text. */
export function cleanParagraph(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function buildCutPrompt(input: PromptInput): string {
  const paras = input.paragraphs.map(cleanParagraph).filter(Boolean);
  const target = input.targetWords && input.targetWords > 0 ? Math.round(input.targetWords) : null;
  const purpose = input.purpose?.trim();
  const lines: string[] = [
    'You are cutting a piece of debate evidence (a "card") in the Verbatim style used in NFA-LD, CEDA/NDT and high-school policy debate.',
    '',
    'TASK',
    purpose ? `The card should prove: ${purpose}` : 'Decide the strongest honest claim this evidence supports.',
    '- UNDERLINE the author\'s claims and warrants that matter for that argument, plus enough surrounding text for context.',
    '- HIGHLIGHT a subset of the underlined text. Read on its own, in order, the highlighted text must make sense and make the argument. This is what the debater reads aloud.' +
      (target ? ` Aim for about ${target} highlighted words.` : ''),
    '- EMPHASIS (boxed text): at most a few of the most important words or short phrases, all inside underlined text.',
    '- TAG: one sentence stating the claim the highlighted text actually proves. Do not overclaim.',
    '- Never make the author say something they do not mean. Do not highlight around a "not" or a qualifier in a way that flips or inflates the meaning.',
    '',
    'QUOTING RULES (replies that break these are rejected automatically)',
    '- Every quote must be copied EXACTLY from the card text below: same words, same spelling, same punctuation.',
    '- Do not add, drop or change words. No ellipses (...), no brackets, no paraphrase.',
    '- A quote must stay inside one paragraph. Paragraphs are separated by blank lines.',
    '- A quote is one unbroken run of text. To mark words that are not next to each other, list each run as its own quote: for "cascading ecosystem collapse", highlighting "cascading" and "collapse" means two quotes, never "cascading collapse".',
    '- List quotes in reading order. Quotes may be single words or phrases; longer phrases are matched more reliably.',
    '- Highlighted text must also be underlined or emphasized.',
    '',
    'REPLY FORMAT',
    'Reply with ONLY this JSON in a ```json code block, nothing else:',
    '```json',
    '{',
    `  "format": "${CHAT_CUT_FORMAT}",`,
    '  "tag": "one-sentence tag",',
    '  "underline": ["exact quote", "exact quote"],',
    '  "emphasis": ["exact quote"],',
    '  "highlight": ["exact quote", "exact quote"]',
    '}',
    '```',
    '',
  ];
  if (input.tag.trim()) lines.push('CURRENT TAG (may be improved): ' + cleanParagraph(input.tag), '');
  if (input.cite.trim()) lines.push('CITATION (do not quote from it): ' + cleanParagraph(input.cite), '');
  lines.push('CARD TEXT (quote only from here)', '<<<', paras.join('\n\n'), '>>>');
  return lines.join('\n');
}

// ─── Reply parsing ───────────────────────────────────────────────────

export type ParseResult = { ok: true; reply: ChatCutReply } | { ok: false; error: string };

function extractJsonText(text: string): string | null {
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(text);
  const body = fence ? fence[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`"${field}" must be a list of quotes`);
  if (value.length > MAX_QUOTES) throw new Error(`"${field}" has too many quotes`);
  return value.map((v) => {
    if (typeof v !== 'string') throw new Error(`"${field}" must contain only text quotes`);
    if (v.length > MAX_QUOTE_CHARS) throw new Error(`A quote in "${field}" is too long`);
    return v;
  }).filter((v) => v.trim() !== '');
}

/** Parse a chat AI's reply. Tolerates surrounding chatter, a missing code
 *  fence, curly quotes used as JSON delimiters, and trailing commas. */
export function parseCutReply(text: string): ParseResult {
  const raw = extractJsonText(text);
  if (!raw) return { ok: false, error: 'No JSON found in the reply. Paste the AI\'s whole answer, including the ```json block.' };
  let data: unknown;
  const attempts = [
    raw,
    raw.replace(/,\s*([\]}])/g, '$1'),
    // Some chat apps "smarten" the JSON's own quote marks.
    raw.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/,\s*([\]}])/g, '$1'),
  ];
  for (const attempt of attempts) {
    try {
      data = JSON.parse(attempt);
      break;
    } catch { /* try the next repair */ }
  }
  if (data === undefined) return { ok: false, error: 'The reply\'s JSON could not be read. Ask the AI to resend it in the exact format.' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'The reply\'s JSON must be one object.' };
  const obj = data as Record<string, unknown>;
  if (obj['format'] !== undefined && obj['format'] !== CHAT_CUT_FORMAT) {
    return { ok: false, error: `Unknown reply format "${String(obj['format'])}".` };
  }
  try {
    const tag = typeof obj['tag'] === 'string' && obj['tag'].trim() ? obj['tag'].trim().slice(0, MAX_TAG_CHARS) : null;
    const reply = {
      tag,
      underline: stringList(obj['underline'], 'underline'),
      emphasis: stringList(obj['emphasis'], 'emphasis'),
      highlight: stringList(obj['highlight'], 'highlight'),
    };
    if (!reply.tag && reply.underline.length + reply.emphasis.length + reply.highlight.length === 0) {
      return { ok: false, error: 'The reply has no tag and no quotes.' };
    }
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Matching ────────────────────────────────────────────────────────

/** Map look-alike characters to one form so a quote still matches when the
 *  chat app "smartened" quotes, swapped dashes or reflowed whitespace. */
function canonicalChar(ch: string): string {
  if (/[\u2018\u2019\u201A\u201B\u2032\u02BC`]/.test(ch)) return "'";
  if (/[\u201C\u201D\u201E\u201F\u2033]/.test(ch)) return '"';
  if (/[\u2010-\u2015\u2212\u2E3A\u2E3B]/.test(ch)) return '-';
  return ch;
}

interface Normalized { text: string; map: number[] }

/** Normalize text, keeping for each output char the index of the source
 *  char it came from. Whitespace runs become one space; invisible
 *  characters are dropped; "…" becomes "...". */
export function normalizeWithMap(source: string, lower = false): Normalized {
  let text = '';
  const map: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (/[\u00AD\u200B-\u200D\u2060\uFEFF]/.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (pendingSpace < 0) pendingSpace = i;
      continue;
    }
    if (pendingSpace >= 0) {
      if (text.length > 0) {
        text += ' ';
        map.push(pendingSpace);
      }
      pendingSpace = -1;
    }
    let out = ch === '\u2026' ? '...' : canonicalChar(ch);
    if (lower) out = out.toLowerCase();
    // One map entry per UTF-16 unit (lowercasing can change the length).
    for (let k = 0; k < out.length; k++) map.push(i);
    text += out;
  }
  return { text, map };
}

function normalizeQuote(quote: string, lower: boolean): string {
  let q = normalizeWithMap(quote, lower).text;
  // Strip wrapping quotation marks the AI sometimes adds around a quote.
  if (q.length > 2 && /^["']/.test(q) && /["']$/.test(q) && !/["']/.test(q.slice(1, -1))) q = q.slice(1, -1).trim();
  return q;
}

export type RejectReason = 'not-found' | 'too-short';

export interface MatchReport {
  spans: CutSpan[];
  rejected: Array<{ layer: CutLayer; quote: string; reason: RejectReason }>;
  /** Quotes found only before the previous quote (the reply's order was off). */
  outOfOrder: Array<{ layer: CutLayer; quote: string }>;
  /** Quotes matched only when ignoring upper/lower case. */
  caseInsensitive: Array<{ layer: CutLayer; quote: string }>;
  /** Highlight spans that were not inside underlined or boxed text and got underlined too. */
  autoUnderlined: number;
  counts: Record<CutLayer, number>;
  highlightedWords: number;
}

interface Cursor { p: number; at: number }

/** Locate `quote` (normalized) searching paragraphs from `cursor`, then
 *  from the start. Matches never span paragraphs. */
function locate(
  paras: Normalized[],
  quote: string,
  cursor: Cursor,
  wholeWord: boolean,
): { p: number; nStart: number; nEnd: number; wrapped: boolean } | null {
  const tryFrom = (p0: number, at0: number, pEnd: number): { p: number; nStart: number; nEnd: number } | null => {
    for (let p = p0; p < pEnd; p++) {
      const hay = paras[p]!.text;
      let from = p === p0 ? at0 : 0;
      while (from <= hay.length) {
        const i = hay.indexOf(quote, from);
        if (i < 0) break;
        // Prefer whole-word matches: a quote of "nuclear war" should not land inside "thermonuclear war".
        const before = i === 0 ? ' ' : hay[i - 1]!;
        const after = i + quote.length >= hay.length ? ' ' : hay[i + quote.length]!;
        const wordChar = /[\p{L}\p{N}]/u;
        const startsWord = wordChar.test(quote[0]!) ? !wordChar.test(before) : true;
        const endsWord = wordChar.test(quote[quote.length - 1]!) ? !wordChar.test(after) : true;
        if (!wholeWord || (startsWord && endsWord)) return { p, nStart: i, nEnd: i + quote.length };
        from = i + 1;
      }
    }
    return null;
  };
  const ahead = tryFrom(cursor.p, cursor.at, paras.length);
  if (ahead) return { ...ahead, wrapped: false };
  const behind = tryFrom(0, 0, Math.min(cursor.p + 1, paras.length));
  return behind ? { ...behind, wrapped: true } : null;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function covered(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([a, b]) => a <= start && end <= b);
}

/** Count words touched by the merged ranges of one paragraph. */
function wordsIn(text: string, ranges: Array<[number, number]>): number {
  let n = 0;
  const re = /[\p{L}\p{N}][\p{L}\p{N}'\u2019\-]*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (ranges.some(([a, b]) => a < e && s < b)) n++;
  }
  return n;
}

/** Find every quote of a parsed reply in the card's body paragraphs. */
export function matchCutReply(paragraphs: string[], reply: ChatCutReply): MatchReport {
  const exact = paragraphs.map((p) => normalizeWithMap(p, false));
  const lower = paragraphs.map((p) => normalizeWithMap(p, true));
  const report: MatchReport = {
    spans: [],
    rejected: [],
    outOfOrder: [],
    caseInsensitive: [],
    autoUnderlined: 0,
    counts: { u: 0, em: 0, hl: 0 },
    highlightedWords: 0,
  };
  const layers: Array<[CutLayer, string[]]> = [['u', reply.underline], ['em', reply.emphasis], ['hl', reply.highlight]];
  for (const [layer, quotes] of layers) {
    let cursor: Cursor = { p: 0, at: 0 };
    for (const quote of quotes) {
      let q = normalizeQuote(quote, false);
      if (!/[\p{L}\p{N}]/u.test(q)) {
        report.rejected.push({ layer, quote, reason: 'too-short' });
        continue;
      }
      let hit = locate(exact, q, cursor, true) ?? locate(exact, q, cursor, false);
      let space = exact;
      if (!hit) {
        q = normalizeQuote(quote, true);
        hit = locate(lower, q, cursor, true) ?? locate(lower, q, cursor, false);
        space = lower;
        if (hit) report.caseInsensitive.push({ layer, quote });
      }
      if (!hit) {
        report.rejected.push({ layer, quote, reason: 'not-found' });
        continue;
      }
      if (hit.wrapped) report.outOfOrder.push({ layer, quote });
      const map = space[hit.p]!.map;
      report.spans.push({ layer, p: hit.p, start: map[hit.nStart]!, end: map[hit.nEnd - 1]! + 1 });
      report.counts[layer]++;
      cursor = { p: hit.p, at: hit.nEnd };
    }
  }
  // Verbatim convention: highlighted text is underlined. Boxed text needs
  // nothing extra: the Emphasis style is itself underlined (and it replaces
  // the Underline style on the text it covers).
  for (let p = 0; p < paragraphs.length; p++) {
    const u = mergeRanges(report.spans.filter((s) => s.p === p && s.layer !== 'hl').map((s) => [s.start, s.end]));
    for (const s of report.spans.filter((x) => x.p === p && x.layer === 'hl')) {
      if (!covered(u, s.start, s.end)) {
        report.autoUnderlined++;
        report.spans.push({ layer: 'u', p, start: s.start, end: s.end });
      }
    }
    const hl = mergeRanges(report.spans.filter((s) => s.p === p && s.layer === 'hl').map((s) => [s.start, s.end]));
    report.highlightedWords += wordsIn(paragraphs[p]!, hl);
  }
  return report;
}
