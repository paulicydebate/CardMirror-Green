/**
 * Editor glue for copy-paste chat cutting (src/cutting/chat-cut.ts).
 *
 * Reads the card at the cursor (tag, cite, body paragraphs) and applies a
 * checked reply as ONE transaction: optional tag replacement, optional
 * clearing of existing underline/emphasis/highlight in the body, then the
 * matched spans. One Ctrl+Z undoes the whole cut.
 *
 * Only `card_body` paragraphs are quotable — not the tag, cite or
 * undertags. Delimiter-protected text (bracketed omissions, ALT TEXT,
 * translator notes, the user's custom protections — the same set Shrink and
 * the card cutter honor) is blanked, so a quote of it never matches.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema/index.js';
import { settings } from './settings.js';
import { compileShrinkProtections, findProtectedRanges } from './ribbon-commands.js';
import type { CutLayer, MatchReport } from '../cutting/chat-cut.js';

/** A run of the paragraph's text that maps 1:1 onto doc positions. */
interface Segment { textStart: number; pos: number; len: number }

export interface ChatCutCard {
  /** The tag heading's stable id — re-finds the card after the user leaves to chat. */
  tagId: string;
  tag: string;
  cite: string;
  paragraphs: string[];
  segments: Segment[][];
}

function protectionPatterns(): readonly RegExp[] {
  const custom = settings.get('condenseWarningDelimiter') === 'custom';
  return compileShrinkProtections(
    settings.get('shrinkCustomProtections'),
    custom ? settings.get('condenseWarningCustomPauseMarker') : '',
    custom ? settings.get('condenseWarningCustomResumeMarker') : '',
  );
}

function readCard(doc: PMNode, cardNode: PMNode, cardPos: number): ChatCutCard | null {
  let tagId: string | null = null;
  let tag = '';
  let cite = '';
  const paragraphs: string[] = [];
  const segments: Segment[][] = [];
  const patterns = protectionPatterns();
  cardNode.forEach((child, offset) => {
    const childPos = cardPos + 1 + offset;
    const type = child.type.name;
    if (type === 'tag') {
      tag += child.textContent;
      if (typeof child.attrs['id'] === 'string' && child.attrs['id']) tagId = child.attrs['id'];
      return;
    }
    if (type === 'cite_paragraph') {
      cite += (cite ? '\n' : '') + child.textContent;
      return;
    }
    if (type !== 'card_body') return;
    const prot = findProtectedRanges(doc, [{ from: childPos, to: childPos + child.nodeSize }], patterns);
    let text = '';
    const segs: Segment[] = [];
    child.forEach((inline, inlineOffset) => {
      const pos = childPos + 1 + inlineOffset;
      if (inline.isText && inline.text) {
        let run = '';
        for (let i = 0; i < inline.text.length; i++) {
          const blanked = prot.some((r) => pos + i >= r.from && pos + i < r.to);
          run += blanked ? ' ' : inline.text[i];
        }
        segs.push({ textStart: text.length, pos, len: run.length });
        text += run;
      } else {
        // Images, footnotes and other inline atoms: a word break, never quotable.
        text += ' ';
      }
    });
    paragraphs.push(text);
    segments.push(segs);
  });
  if (!tagId || paragraphs.every((p) => p.trim() === '')) return null;
  return { tagId, tag, cite, paragraphs, segments };
}

/** The card containing the cursor, or null (cursor outside a card, a card
 *  with no body text, or a tag without an id). */
export function chatCutCardAtCursor(view: EditorView): ChatCutCard | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'card') return readCard(view.state.doc, node, $from.before(d));
  }
  return null;
}

/** Re-find a card by its tag id at its current position. */
export function chatCutCardById(view: EditorView, tagId: string): ChatCutCard | null {
  const found = findCardNode(view.state.doc, tagId);
  return found ? readCard(view.state.doc, found.node, found.pos) : null;
}

function findCardNode(doc: PMNode, tagId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== 'card') return true;
    const first = node.firstChild;
    if (first?.type.name === 'tag' && first.attrs['id'] === tagId) found = { node, pos };
    return false;
  });
  return found;
}

/** The doc's own highlight color when every highlight in it agrees,
 *  otherwise green (CardMirror Green's card standard). */
export function chatCutHighlightColor(doc: PMNode): string {
  const seen = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) if (m.type.name === 'highlight') seen.add(String(m.attrs['color'] ?? 'yellow'));
    return true;
  });
  return seen.size === 1 ? [...seen][0]! : 'green';
}

const LAYER_MARK: Record<CutLayer, string> = { u: 'underline_mark', em: 'emphasis_mark', hl: 'highlight' };
const CLEARED_MARKS = ['underline_mark', 'underline_direct', 'emphasis_mark', 'highlight'];

/** Text-offset range → doc ranges, skipping blanked atoms between segments. */
function docRanges(segs: Segment[], start: number, end: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of segs) {
    const a = Math.max(start, s.textStart);
    const b = Math.min(end, s.textStart + s.len);
    if (b > a) out.push([s.pos + (a - s.textStart), s.pos + (b - s.textStart)]);
  }
  return out;
}

export interface ApplyOptions {
  /** Clear underline / emphasis / highlight in the body first. */
  replaceExisting: boolean;
  /** Replace the tag text (null keeps it). */
  newTag: string | null;
}

/** Apply a match report to the card with `tagId`. Re-reads the card, so
 *  `report` must have been computed against the card's current
 *  paragraphs (the UI re-matches right before applying). Returns false if
 *  the card is gone. */
export function applyChatCut(view: EditorView, tagId: string, report: MatchReport, options: ApplyOptions): boolean {
  const located = findCardNode(view.state.doc, tagId);
  const card = located ? readCard(view.state.doc, located.node, located.pos) : null;
  if (!located || !card) return false;
  const tr = view.state.tr;
  const color = chatCutHighlightColor(view.state.doc);
  if (options.replaceExisting) {
    for (const segs of card.segments) {
      for (const s of segs) {
        for (const name of CLEARED_MARKS) {
          const type = schema.marks[name];
          if (type) tr.removeMark(s.pos, s.pos + s.len, type);
        }
      }
    }
  }
  // Underline and Emphasis are exclusive character styles (as in Word), so
  // order matters: underline first, then emphasis replaces it where boxed.
  const order: Record<CutLayer, number> = { u: 0, em: 1, hl: 2 };
  const spans = [...report.spans].sort((a, b) => order[a.layer] - order[b.layer]);
  for (const span of spans) {
    const segs = card.segments[span.p];
    const type = schema.marks[LAYER_MARK[span.layer]];
    if (!segs || !type) continue;
    for (const [from, to] of docRanges(segs, span.start, span.end)) {
      tr.addMark(from, to, span.layer === 'hl' ? type.create({ color }) : type.create());
    }
  }
  // Tag last: mark steps above sit after the tag, but mapping keeps this safe regardless.
  const newTag = options.newTag?.trim();
  if (newTag) {
    const tagNode = located.node.firstChild!;
    const from = tr.mapping.map(located.pos + 2);
    const to = tr.mapping.map(located.pos + 2 + tagNode.content.size);
    tr.replaceWith(from, to, schema.text(newTag));
  }
  if (!tr.docChanged) return true;
  view.dispatch(tr.scrollIntoView());
  return true;
}
