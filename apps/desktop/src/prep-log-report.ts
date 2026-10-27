/** Pure presentation of an audit log, shared by the viewer and text export.
 * Never rewrites the chained source or infers a paste from text length.
 */
interface Entry { seq: number; time: string; kind: string; document: string | null; window: number | null; data: unknown }
export interface PrepTimelineRow {
  seq: number;
  start: string;
  end: string;
  documentId: string | null;
  document: string;
  window: number | null;
  action: string;
  text: string;
  target: string;
  category: 'typing' | 'edit' | 'clipboard' | 'session' | 'other';
  outcome?: 'blocked' | 'recorded' | 'unconfirmed';
  flagged: boolean;
}
export interface PrepLogReport {
  rows: PrepTimelineRow[];
  timeZone: string;
  start: string | null;
  end: string | null;
  round: string | null;
  rawEvents: number;
  typedCharacters: number;
  deletedCharacters: number;
  blockedCopies: number;
  blockedPastes: number;
  recordedPastes: number;
  chainValid?: boolean;
  sealCode?: string;
}
type Data = Record<string, unknown>;
function dataOf(entry: Entry): Data { return entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? entry.data as Data : {}; }
function timeOf(entry: Entry): string {
  const client = dataOf(entry)['clientTime'];
  return typeof client === 'string' && Number.isFinite(Date.parse(client)) ? client : entry.time;
}
function keyOf(entry: Entry): string { return JSON.stringify([entry.window, entry.document]); }
const changes = new Set(['input', 'macro', 'autocorrect', 'undo', 'redo', 'remote-insert']);
const hidden = new Set(['document-created', 'document-opened', 'document-closed', 'document-saved', 'prep-document-marked', 'prep-identity-bound', 'prep-document-reopened', 'focus', 'blur']);

export function createPrepLogReport(text: string, options: { timeZone?: string; chainValid?: boolean; sealCode?: string } = {}): PrepLogReport {
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat('en-US', { timeZone }); // reject an invalid zone, not misleading dates
  const entries: Entry[] = text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const e: unknown = JSON.parse(line);
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('Invalid audit record.');
    const value = e as Entry;
    if (!Number.isSafeInteger(value.seq) || typeof value.kind !== 'string' || typeof value.time !== 'string' || !Number.isFinite(Date.parse(value.time)) ||
        !(value.document === null || typeof value.document === 'string') || !(value.window === null || Number.isSafeInteger(value.window))) throw new Error('Invalid audit timestamp or event.');
    return value;
  });
  const report: PrepLogReport = { rows: [], timeZone, start: entries.find(e => e.kind === 'prep-start')?.time ?? null,
    end: entries.find(e => e.kind === 'session-end')?.time ?? null, round: entries.find(e => e.kind === 'round-start')?.time ?? null,
    rawEvents: entries.length, typedCharacters: 0, deletedCharacters: 0, blockedCopies: 0, blockedPastes: 0, recordedPastes: 0,
    chainValid: options.chainValid, sealCode: options.sealCode };
  const names = new Map<string, string>();
  for (const e of entries) if (e.document && e.kind === 'document-opened' && typeof dataOf(e)['name'] === 'string') names.set(e.document, String(dataOf(e)['name']).slice(0, 256));
  const aliases = new Map<string, string>();
  for (const e of entries) if (e.document && !aliases.has(e.document)) aliases.set(e.document, names.get(e.document) ?? `Document ${aliases.size + 1}`);
  const row = (e: Entry, action: string, text: string, category: PrepTimelineRow['category'], outcome?: PrepTimelineRow['outcome']): PrepTimelineRow => ({
    seq: e.seq, start: timeOf(e), end: timeOf(e), documentId: e.document, document: e.document ? aliases.get(e.document)! : 'Session',
    window: e.window, action, text, target: '', category, outcome, flagged: dataOf(e)['flagged'] === true,
  });
  const rawInputs: Array<{ entry: Entry; consumed: boolean }> = [];
  const pending = new Map<string, typeof rawInputs[number]>();
  for (const e of entries) {
    const data = dataOf(e);
    if (e.kind === 'input' && data['phase'] === 'beforeinput') {
      const raw = { entry: e, consumed: false }; rawInputs.push(raw); pending.set(keyOf(e), raw); continue;
    }
    if (hidden.has(e.kind)) continue;
    if (e.kind === 'blocked') {
      const reason = [data['reason'], data['operation'], data['action']].filter(v => typeof v === 'string').join(' ');
      const paste = /paste|clipboard[.:/-]read/i.test(reason);
      const cut = /\bcut\b/i.test(reason);
      const copy = !paste && !cut && /copy|clipboard[.:/-]write/i.test(reason);
      const action = paste ? 'Paste blocked' : cut ? 'Cut blocked' : copy ? 'Copy blocked' : /drop|drag/i.test(reason) ? 'Drag/drop blocked' : 'Action blocked';
      if (paste) report.blockedPastes++;
      if (copy) report.blockedCopies++;
      report.rows.push(row(e, action, 'Prevented — no transfer was completed by this attempt.', 'clipboard', 'blocked')); continue;
    }
    if (changes.has(e.kind)) {
      const inserted = Array.isArray(data['inserted']) ? data['inserted'].filter((v): v is string => typeof v === 'string') : [];
      const deleted = typeof data['deleted'] === 'number' && Number.isSafeInteger(data['deleted']) && data['deleted'] > 0 ? data['deleted'] : 0;
      const raw = pending.get(keyOf(e));
      const delta = raw ? Date.parse(timeOf(e)) - Date.parse(timeOf(raw.entry)) : -1;
      const canPair = e.kind === 'input' || e.kind === 'autocorrect' || (['undo', 'redo'].includes(e.kind) && /^history/.test(String(raw ? dataOf(raw.entry)['inputType'] : '')));
      const input = raw && canPair && delta >= 0 && delta <= 1500 ? raw : undefined;
      if (input) { input.consumed = true; pending.delete(keyOf(e)); }
      const inputData = input ? dataOf(input.entry) : {};
      const inputType = typeof inputData['inputType'] === 'string' ? inputData['inputType'] : typeof data['inputType'] === 'string' ? data['inputType'] : '';
      const pasted = /^insertFromPaste/.test(inputType);
      const typed = /^(insertText|insertCompositionText)$/.test(inputType);
      const textAdded = inserted.join('');
      report.deletedCharacters += deleted;
      if (e.kind === 'input' && typed) report.typedCharacters += textAdded.length;
      if (e.kind === 'input' && pasted) report.recordedPastes++;
      let action = e.kind === 'macro' ? 'Macro expansion' : e.kind === 'autocorrect' ? 'Autocorrect' : e.kind === 'undo' ? 'Undo' : e.kind === 'redo' ? 'Redo' : e.kind === 'remote-insert' ? 'Partner edit' : pasted ? 'Paste recorded' : deleted && !textAdded ? 'Deleted' : typed ? deleted ? 'Typed replacement' : 'Typed' : textAdded ? 'Text inserted (source unconfirmed)' : 'Edit';
      if (!inserted.length && !deleted && e.kind === 'input') {
        if (typeof data['text'] === 'string') report.rows.push(row(e, 'Input event (not confirmed)', data['text'], 'edit', 'unconfirmed'));
        continue;
      }
      const detail = deleted ? `${deleted} character${deleted === 1 ? '' : 's'} deleted${textAdded ? `; inserted ${JSON.stringify(textAdded)}` : ''}` : textAdded;
      const r = row(e, action, detail, pasted ? 'clipboard' : e.kind === 'input' && typed && !deleted ? 'typing' : 'edit', pasted ? 'recorded' : undefined);
      if (input) r.start = r.end = timeOf(input.entry);
      r.target = typeof inputData['target'] === 'string' ? inputData['target'] : '';
      report.rows.push(r); continue;
    }
    const labels: Record<string, string> = { 'prep-start': 'Prep started', 'round-start': 'Round started', 'session-end': 'Session ended', 'app-restart': 'App restarted', 'app-quit': 'App quit', 'collaboration-ended': 'Collaboration ended' };
    if (labels[e.kind]) report.rows.push(row(e, labels[e.kind]!, '', 'session'));
    else report.rows.push(row(e, 'Other event', e.kind, 'other'));
  }
  // An attempted input without a matching committed change must not be shown
  // as accepted typing (e.g. a later filter refused it or a crash cut it off).
  for (const raw of rawInputs) if (!raw.consumed) {
    const data = dataOf(raw.entry);
    report.rows.push(row(raw.entry, 'Input attempted (not confirmed)', typeof data['text'] === 'string' ? data['text'] : String(data['inputType'] ?? 'Input'), 'edit', 'unconfirmed'));
  }
  report.rows.sort((a, b) => a.seq - b.seq);
  const grouped: PrepTimelineRow[] = [];
  for (const r of report.rows) {
    const previous = grouped.at(-1);
    const gap = previous ? Date.parse(r.start) - Date.parse(previous.end) : -1;
    if (previous && r.category === 'typing' && previous.category === 'typing' && !r.flagged && !previous.flagged &&
        r.documentId === previous.documentId && r.window === previous.window && r.target === previous.target && gap >= 0 && gap <= 1500 &&
        Date.parse(r.end) - Date.parse(previous.start) <= 10000) {
      previous.text += r.text; previous.end = r.end;
    } else grouped.push(r);
  }
  report.rows = grouped;
  return report;
}

export function formatPrepTime(time: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(time));
}
export function formatPrepTimeRange(row: PrepTimelineRow, timeZone: string): string {
  const first = formatPrepTime(row.start, timeZone), last = formatPrepTime(row.end, timeZone);
  return first === last ? first : `${first} – ${last}`;
}
export function prepReportSummary(report: PrepLogReport): string {
  return `${report.typedCharacters} typed characters · ${report.deletedCharacters} deleted · ${report.blockedCopies} copy attempts blocked · ${report.blockedPastes} paste attempts blocked · ${report.recordedPastes} accepted paste events recorded · Round ${report.round ? 'started' : 'not started'}`;
}
export function exportPrepLogReport(report: PrepLogReport): string {
  const date = (time: string | null): string => time ? new Intl.DateTimeFormat('en-US', { timeZone: report.timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(time)) : 'Not recorded';
  return [
    'CardMirror Green — readable session report', `Time zone: ${report.timeZone}`, `Prep started: ${date(report.start)}`, `Round started: ${report.round ? date(report.round) : 'Not started'}`,
    `Session ended: ${report.end ? date(report.end) : 'Not recorded — session may be active or incomplete'}`,
    `Audit chain: ${report.chainValid === true ? 'Verified' : report.chainValid === false ? 'FAILED verification' : 'Not checked'}`,
    `Seal: ${report.end && report.chainValid === true && report.sealCode ? report.sealCode : 'No verified final seal supplied'}`, prepReportSummary(report), '',
    'Time | Document | Action | Text / result',
    ...report.rows.map(r => `${date(r.start)}${formatPrepTime(r.start, report.timeZone) !== formatPrepTime(r.end, report.timeZone) ? ' – ' + formatPrepTime(r.end, report.timeZone) : ''} | ${r.document} | ${r.action}${r.flagged ? ' [flagged]' : ''} | ${r.text ? r.category === 'typing' ? JSON.stringify(r.text) : r.text : '—'}${r.target ? ' [' + r.target + ']' : ''}`),
    '', 'Typing is grouped by document, target when available, and time; positions within older logs were not recorded. This is an input history, not a reconstruction of the final document.',
    'Blocked means prevented. An unconfirmed insert is not evidence of a paste. This log does not establish activity outside CardMirror.',
    'The original JSONL remains the authoritative audit file. Compare its seal with the value recorded independently when the session ended.', '',
  ].join('\n');
}
