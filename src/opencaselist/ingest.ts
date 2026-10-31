/**
 * OpenCaselist -> batch v1 adapter.
 *
 * Discovers open-source disclosure files for a small scope (one school, optionally
 * one team and side), downloads each unique file once, parses DOCX/CMIR with the
 * editor's own parsers, and feeds successes into createIngestBatch() unchanged.
 * Skips and failures go in a separate run manifest, never into the strict v1 batch.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { createIngestBatch, sha256Bytes, type IngestBatch } from '../editor/card-ingest-batch.js';
import { OpenCaselistError, type OpenCaselistClient, type Round } from './client.js';

export const RUN_SCHEMA = 'cardmirror.opencaselist.run' as const;
export const RUN_VERSION = 1 as const;
export const DEFAULT_MAX_DOCUMENTS = 25;

export interface OpenCaselistScope {
  caselist: string;
  school: string;
  /** Omit to include every team at the school. */
  team?: string;
  /** OpenCaselist side code, e.g. "A" or "N". Omit for both. */
  side?: string;
}

export interface RoundRef {
  roundId: number;
  school: string;
  team: string;
  tournament: string | null;
  side: string | null;
  round: string | null;
  opponent: string | null;
  judge: string | null;
  createdAt: string | null;
}

export type DocumentStatus = 'imported' | 'skipped' | 'failed';
export interface ManifestDocument {
  /** OpenCaselist open-source path: the stable document key. */
  path: string;
  sourceId: string;
  status: DocumentStatus;
  /** Machine-readable reason for skipped/failed documents. */
  reason: 'unsupported-format' | 'download-failed' | 'not-a-docx' | 'parse-failed' | null;
  message: string | null;
  httpStatus: number | null;
  sha256: string | null;
  bytes: number | null;
  /** Every disclosed round that points at this file. */
  rounds: RoundRef[];
}
export interface DiscoveryError { school: string; team: string | null; message: string; httpStatus: number | null }

export interface RunManifest {
  schema: typeof RUN_SCHEMA;
  schemaVersion: typeof RUN_VERSION;
  apiBase: string;
  scope: OpenCaselistScope;
  maxDocuments: number;
  startedAt: string;
  finishedAt: string;
  /** ID of the batch built from the imported documents, or null if none imported. */
  batchId: string | null;
  discoveryErrors: DiscoveryError[];
  documents: ManifestDocument[];
  summary: {
    teams: number;
    rounds: number;
    roundsWithFiles: number;
    uniqueFiles: number;
    /** Files left out because of maxDocuments. */
    notAttempted: number;
    imported: number;
    skipped: number;
    failed: number;
    records: number;
  };
}

export type ProgressEvent =
  | { phase: 'discover'; team: string }
  | { phase: 'download'; index: number; total: number; path: string }
  | { phase: 'done'; path: string; status: DocumentStatus };

export interface IngestOptions {
  client: OpenCaselistClient;
  scope: OpenCaselistScope;
  parse: (bytes: Uint8Array, kind: 'docx' | 'cmir') => Promise<PMNode>;
  maxDocuments?: number;
  onProgress?: (event: ProgressEvent) => void;
  now?: () => Date;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);

function formatOf(path: string): 'docx' | 'cmir' | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.cmir')) return 'cmir';
  return null;
}
const basename = (path: string): string => path.split(/[\\/]/).pop() || path;

export async function ingestOpenCaselist(options: IngestOptions): Promise<{ batch: IngestBatch | null; manifest: RunManifest }> {
  const { client, scope, parse, onProgress } = options;
  const now = options.now ?? (() => new Date());
  const maxDocuments = options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1) throw new Error('maxDocuments must be a positive integer');
  if (!scope.caselist || !scope.school) throw new Error('A caselist and a school are required');
  const startedAt = now().toISOString();

  // 1. Discovery. A failed team listing is recorded and the run continues.
  const discoveryErrors: DiscoveryError[] = [];
  let teams: string[];
  if (scope.team) teams = [scope.team];
  else {
    // Without a team list there is nothing to do, so this failure is fatal.
    teams = (await client.listTeams(scope.caselist, scope.school)).map(t => t.name);
  }
  teams = [...new Set(teams)].sort();

  const byPath = new Map<string, RoundRef[]>();
  let rounds = 0;
  for (const team of teams) {
    onProgress?.({ phase: 'discover', team });
    let list: Round[];
    try { list = await client.listRounds(scope.caselist, scope.school, team, scope.side); }
    catch (error) {
      if (error instanceof OpenCaselistError && error.status === 401) throw error;
      discoveryErrors.push({ school: scope.school, team, message: describe(error), httpStatus: error instanceof OpenCaselistError ? error.status : null });
      continue;
    }
    rounds += list.length;
    for (const r of [...list].sort((a, b) => a.round_id - b.round_id)) {
      const path = text(r.opensource);
      if (!path) continue;
      const ref: RoundRef = { roundId: r.round_id, school: scope.school, team, tournament: text(r.tournament), side: text(r.side),
        round: text(r.round), opponent: text(r.opponent), judge: text(r.judge), createdAt: text(r.created_at) };
      const refs = byPath.get(path);
      if (refs) refs.push(ref); else byPath.set(path, [ref]);
    }
  }
  const roundsWithFiles = [...byPath.values()].reduce((n, refs) => n + refs.length, 0);
  const allPaths = [...byPath.keys()].sort();
  const paths = allPaths.slice(0, maxDocuments);

  // 2. Retrieve and parse, one file at a time.
  const documents: ManifestDocument[] = [];
  const inputs: Array<{ source: { id: string; format: 'docx' | 'cmir'; sha256: string; title: string; uri: string }; doc: PMNode }> = [];
  for (const [index, path] of paths.entries()) {
    const entry: ManifestDocument = { path, sourceId: 'opencaselist:' + path, status: 'failed', reason: null, message: null,
      httpStatus: null, sha256: null, bytes: null, rounds: byPath.get(path)! };
    documents.push(entry);
    const format = formatOf(path);
    if (!format) {
      entry.status = 'skipped'; entry.reason = 'unsupported-format';
      entry.message = 'Only .docx and .cmir files are imported';
      onProgress?.({ phase: 'done', path, status: entry.status });
      continue;
    }
    onProgress?.({ phase: 'download', index: index + 1, total: paths.length, path });
    let bytes: Uint8Array;
    try { bytes = await client.download(path); }
    catch (error) {
      if (error instanceof OpenCaselistError && error.status === 401) throw error;
      entry.reason = 'download-failed'; entry.message = describe(error);
      entry.httpStatus = error instanceof OpenCaselistError ? error.status : null;
      onProgress?.({ phase: 'done', path, status: entry.status });
      continue;
    }
    entry.bytes = bytes.byteLength;
    entry.sha256 = await sha256Bytes(bytes);
    if (format === 'docx' && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      entry.reason = 'not-a-docx'; entry.message = 'Downloaded file is not a DOCX (ZIP) document';
      onProgress?.({ phase: 'done', path, status: entry.status });
      continue;
    }
    let doc: PMNode;
    try { doc = await parse(bytes, format); }
    catch (error) {
      entry.reason = 'parse-failed'; entry.message = describe(error);
      onProgress?.({ phase: 'done', path, status: entry.status });
      continue;
    }
    entry.status = 'imported';
    inputs.push({ source: { id: entry.sourceId, format, sha256: entry.sha256, title: basename(path), uri: client.downloadUrl(path) }, doc });
    onProgress?.({ phase: 'done', path, status: entry.status });
  }

  // 3. Hand successes to the unchanged v1 batch builder.
  const batch = inputs.length ? await createIngestBatch(inputs) : null;
  const count = (status: DocumentStatus): number => documents.filter(d => d.status === status).length;
  return {
    batch,
    manifest: {
      schema: RUN_SCHEMA, schemaVersion: RUN_VERSION, apiBase: client.baseUrl, scope: { ...scope }, maxDocuments,
      startedAt, finishedAt: now().toISOString(), batchId: batch?.id ?? null, discoveryErrors, documents,
      summary: { teams: teams.length, rounds, roundsWithFiles, uniqueFiles: allPaths.length, notAttempted: allPaths.length - paths.length,
        imported: count('imported'), skipped: count('skipped'), failed: count('failed'), records: batch?.summary.records ?? 0 },
    },
  };
}
