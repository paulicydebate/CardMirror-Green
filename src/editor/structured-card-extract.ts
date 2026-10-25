/**
 * Read-only structured evidence extraction for downstream research tools.
 * This module deliberately does not alter the editor schema or existing
 * extractSelection() / flowing-app contracts.
 */
import type { Node as PMNode } from 'prosemirror-model';

export interface CardTextRun {
  text: string;
  marks: Array<{ type: string; attrs: Record<string, unknown> }>;
}
export interface CardParagraph {
  kind: string;
  text: string;
  runs: CardTextRun[];
}
export interface StructuredCard {
  /** Stable heading UUID when present; null for legacy/unidentified cards. */
  id: string | null;
  kind: 'card' | 'analytic_unit';
  from: number;
  to: number;
  tag: CardParagraph | null;
  citations: CardParagraph[];
  bodies: CardParagraph[];
  undertags: CardParagraph[];
}

function paragraph(node: PMNode): CardParagraph {
  const runs: CardTextRun[] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return;
    runs.push({
      text: child.text,
      marks: child.marks.map((mark) => ({
        type: mark.type.name,
        attrs: { ...mark.attrs } as Record<string, unknown>,
      })),
    });
  });
  return { kind: node.type.name, text: node.textContent, runs };
}

/**
 * Collect cards in document order, preserving exact text and inline marks.
 * Derived transclusion/self-reference subtrees are skipped to prevent
 * duplicate attribution. Positions are ProseMirror document offsets.
 */
export function extractStructuredCards(doc: PMNode): StructuredCard[] {
  const cards: StructuredCard[] = [];
  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (type === 'self_ref' || type === 'transclusion_ref') return false;
    if (type !== 'card' && type !== 'analytic_unit') return true;

    const first = node.firstChild;
    const rawId = first?.attrs['id'];
    const result: StructuredCard = {
      id: typeof rawId === 'string' && rawId ? rawId : null,
      kind: type,
      from: pos,
      to: pos + node.nodeSize,
      tag: first && (first.type.name === 'tag' || first.type.name === 'analytic')
        ? paragraph(first) : null,
      citations: [],
      bodies: [],
      undertags: [],
    };
    node.forEach((child) => {
      switch (child.type.name) {
        case 'cite_paragraph': result.citations.push(paragraph(child)); break;
        case 'card_body': result.bodies.push(paragraph(child)); break;
        case 'undertag': result.undertags.push(paragraph(child)); break;
      }
    });
    cards.push(result);
    return false;
  });
  return cards;
}
