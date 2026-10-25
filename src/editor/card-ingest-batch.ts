/** Version 1 local batch contract. No network, file writes, or document mutations. */
import type { Node as PMNode } from 'prosemirror-model';
import { extractStructuredCards, type StructuredCard } from './structured-card-extract.js';

export const INGEST_SCHEMA = 'cardmirror.ingest.batch' as const;
export const INGEST_VERSION = 1 as const;
export type IngestRecordType = 'evidence' | 'analytic' | 'tag_only' | 'incomplete';
export type IngestWarning = 'missing-tag' | 'missing-citation' | 'missing-body' | 'tag-only' | 'missing-heading-id' | 'rich-content';
export interface IngestSource {
  /** Logical source key chosen by the adapter. Never use a machine-specific path. */
  id: string;
  format: 'docx' | 'cmir';
  /** SHA-256 of the ORIGINAL input bytes, before parsing or healing. */
  sha256: string;
  title?: string;
  /** Optional original disclosure/download URL, supplied by a future adapter. */
  uri?: string;
}
export interface IngestRecord {
  id: string;
  recordType: IngestRecordType;
  sourceId: string;
  ordinal: number;
  /** Exact source revision and editor snapshot offsets, not Word byte offsets. */
  provenance: { sourceSha256: string; headingId: string | null; from: number; to: number };
  warnings: IngestWarning[];
  content: StructuredCard;
  /** Authoritative ordered rich content, including tables and non-text inline nodes. */
  rawNode: Record<string, unknown>;
  contentHash: string;
  /** First identical record in this batch. Duplicates are retained, never removed. */
  duplicateOf: string | null;
}
export interface IngestBatch {
  schema: typeof INGEST_SCHEMA;
  schemaVersion: typeof INGEST_VERSION;
  fingerprintAlgorithm: 'sha256-canonical-json-v1';
  id: string;
  sources: Array<IngestSource & { document: Record<string, unknown> }>;
  records: IngestRecord[];
  summary: { sources: number; records: number; uniqueRecords: number; duplicates: number; byType: Record<IngestRecordType, number> };
}

/** Sort object keys, preserve array order, and reject non-JSON inputs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw new Error('Fingerprint input must contain only JSON values');
}
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
const hash = (value: unknown): Promise<string> => sha256Bytes(new TextEncoder().encode(canonicalJson(value)));

/** Heading UUIDs are generated on some DOCX imports; they are provenance, not content. */
function fingerprintNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fingerprintNode);
  if (typeof value !== 'object' || value === null) return value;
  const node = value as Record<string, unknown>;
  const heading = typeof node['type'] === 'string' && ['tag', 'analytic', 'pocket', 'hat', 'block'].includes(node['type']);
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key,
    key === 'attrs' && heading && child && typeof child === 'object'
      ? fingerprintNode(Object.fromEntries(Object.entries(child).filter(([attr]) => attr !== 'id')))
      : fingerprintNode(child)]));
}
function classify(card: StructuredCard, rich: boolean): { recordType: IngestRecordType; warnings: IngestWarning[] } {
  const tagged = Boolean(card.tag?.text.trim());
  const cited = card.citations.some(p => Boolean(p.text.trim()));
  const body = card.bodies.some(p => Boolean(p.text.trim()));
  const undertag = card.undertags.some(p => Boolean(p.text.trim()));
  const recordType: IngestRecordType = card.kind === 'analytic_unit' ? 'analytic'
    : !cited && !body && !undertag && !rich ? 'tag_only' : cited && body ? 'evidence' : 'incomplete';
  const warnings: IngestWarning[] = [];
  if (!tagged) warnings.push('missing-tag');
  if (!card.id) warnings.push('missing-heading-id');
  if (recordType === 'tag_only') warnings.push('tag-only');
  if (card.kind === 'card' && recordType !== 'tag_only') {
    if (!cited) warnings.push('missing-citation');
    if (!body) warnings.push('missing-body');
  }
  return { recordType, warnings };
}

/** Hashes identify exact parsed content; they are not fuzzy plagiarism/evidence matching. */
export async function createIngestBatch(inputs: ReadonlyArray<{ source: IngestSource; doc: PMNode }>): Promise<IngestBatch> {
  const ids = new Set<string>();
  const sources: IngestBatch['sources'] = [];
  const records: IngestRecord[] = [];
  const seen = new Map<string, string>();
  const byType: Record<IngestRecordType, number> = { evidence: 0, analytic: 0, tag_only: 0, incomplete: 0 };
  for (const { source, doc } of inputs) {
    if (!source.id.trim() || ids.has(source.id)) throw new Error('Source IDs must be nonempty and unique within a batch');
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Source SHA-256 must be 64 lowercase hex characters');
    if (source.format !== 'docx' && source.format !== 'cmir') throw new Error('Unsupported source format');
    if (source.uri !== undefined) {
      let uri: URL;
      try { uri = new URL(source.uri); } catch { throw new Error('Source URI must be an HTTP(S) URL'); }
      if (uri.protocol !== 'https:' && uri.protocol !== 'http:') throw new Error('Source URI must be an HTTP(S) URL');
    }
    ids.add(source.id);
    sources.push({ ...source, document: structuredClone(doc.toJSON()) as Record<string, unknown> });
    const cards = structuredClone(extractStructuredCards(doc));
    for (const [ordinal, card] of cards.entries()) {
      const node = doc.nodeAt(card.from)!;
      const rawNode = structuredClone(node.toJSON()) as Record<string, unknown>;
      let rich = false;
      node.descendants(child => {
        if (child.type.name === 'table' || (child.isInline && !child.isText)) rich = true;
      });
      const { recordType, warnings } = classify(card, rich);
      if (rich) warnings.push('rich-content');
      const contentHash = await hash(fingerprintNode(rawNode));
      const id = 'record:' + await hash({ sourceId: source.id, sourceSha256: source.sha256, ordinal, contentHash });
      records.push({ id, recordType, sourceId: source.id, ordinal,
        provenance: { sourceSha256: source.sha256, headingId: card.id, from: card.from, to: card.to },
        warnings, content: card, rawNode, contentHash, duplicateOf: seen.get(contentHash) ?? null });
      if (!seen.has(contentHash)) seen.set(contentHash, id);
      byType[recordType]++;
    }
  }
  const id = 'batch:' + await hash({ schema: INGEST_SCHEMA, version: INGEST_VERSION,
    sources: sources.map(s => ({ id: s.id, sha256: s.sha256 })), records: records.map(r => r.id) });
  return { schema: INGEST_SCHEMA, schemaVersion: INGEST_VERSION, fingerprintAlgorithm: 'sha256-canonical-json-v1', id,
    sources, records, summary: { sources: sources.length, records: records.length, uniqueRecords: seen.size,
      duplicates: records.length - seen.size, byType } };
}
