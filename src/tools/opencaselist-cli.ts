/**
 * OpenCaselist command line. Read-only against OpenCaselist; writes only NEW local files.
 *
 *   npm run caselist -- login                 (asks for Tabroom email + hidden password)
 *   npm run caselist -- status | logout
 *   npm run caselist -- caselists [--archived]
 *   npm run caselist -- schools <caselist>
 *   npm run caselist -- teams <caselist> <school>
 *   npm run caselist -- rounds <caselist> <school> <team> [--side A|N]
 *   npm run caselist -- export --caselist <c> --school <s> [--team <t>] [--side A|N]
 *                              [--limit 25] --out batch.json [--manifest run.json]
 *
 * The session token is stored outside the repository in ~/.cardmirror-green/ (override
 * with CARDMIRROR_GREEN_HOME) and is never printed. The password is never stored.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { login, OpenCaselistClient, OpenCaselistError, OPENCASELIST_API } from '../opencaselist/client.js';
import { DEFAULT_MAX_DOCUMENTS, ingestOpenCaselist } from '../opencaselist/ingest.js';
import { parseToDoc } from './cardmirror-read-lib.js';

const MAX_LIMIT = 500;

function apiBase(): string {
  const value = process.env['CARDMIRROR_OPENCASELIST_API'];
  if (!value) return OPENCASELIST_API;
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('CARDMIRROR_OPENCASELIST_API must be HTTPS (or HTTP on loopback for tests)');
  return url.href.replace(/\/+$/, '');
}
const sessionFile = (): string => join(process.env['CARDMIRROR_GREEN_HOME'] || join(homedir(), '.cardmirror-green'), 'opencaselist-session.json');

function readToken(base: string): string {
  const file = sessionFile();
  if (!existsSync(file)) throw new OpenCaselistError('Not signed in. Run: npm run caselist -- login', 401, false);
  const session = JSON.parse(readFileSync(file, 'utf8')) as { token?: unknown; apiBase?: unknown };
  // A token is only ever sent back to the server that issued it.
  if (typeof session.token !== 'string' || session.apiBase !== base) throw new OpenCaselistError('Saved session is for a different server. Run: npm run caselist -- login', 401, false);
  return session.token;
}

async function ask(question: string, hidden: boolean): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Sign-in needs an interactive terminal');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const internals = rl as unknown as { _writeToOutput: (s: string) => void };
  let muted = false;
  internals._writeToOutput = (s: string) => { if (!muted || s.includes('\n')) process.stdout.write(muted ? '\n' : s); };
  return new Promise(resolvePromise => {
    rl.question(question, answer => { rl.close(); resolvePromise(answer.trim()); });
    muted = hidden;
  });
}

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const name = arg.slice(2);
    const next = args[i + 1];
    if (name === 'archived') flags.set(name, true);
    else if (next === undefined || next.startsWith('--')) throw new Error('Missing value for --' + name);
    else { flags.set(name, next); i++; }
  }
  return { positional, flags };
}
const flag = (flags: Map<string, string | true>, name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
};
const print = (value: unknown): void => console.log(JSON.stringify(value, null, 2));

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  const known = new Set(['archived', 'side', 'caselist', 'school', 'team', 'limit', 'out', 'manifest', 'username']);
  for (const name of flags.keys()) if (!known.has(name)) throw new Error('Unknown option: --' + name);
  const base = apiBase();

  switch (command) {
    case 'login': {
      const username = flag(flags, 'username') ?? await ask('Tabroom email: ', false);
      const password = await ask('Tabroom password (hidden): ', true);
      const { token } = await login(username, password, { baseUrl: base });
      const file = sessionFile();
      mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(file, JSON.stringify({ apiBase: base, token, savedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
      console.log('Signed in to OpenCaselist. Session saved outside the repository.');
      return;
    }
    case 'logout':
      rmSync(sessionFile(), { force: true });
      console.log('Signed out (local session removed).');
      return;
    case 'status': {
      const client = new OpenCaselistClient({ token: readToken(base), baseUrl: base });
      const lists = await client.listCaselists();
      console.log(`Signed in. ${lists.length} active caselists visible.`);
      return;
    }
    case 'caselists': {
      const client = new OpenCaselistClient({ token: readToken(base), baseUrl: base });
      print((await client.listCaselists(flags.get('archived') === true)).map(c => ({ name: c.name, display_name: c.display_name, event: c.event, level: c.level, year: c.year, archived: c.archived })));
      return;
    }
    case 'schools': case 'teams': case 'rounds': {
      const needed = { schools: 1, teams: 2, rounds: 3 }[command];
      if (positional.length !== needed) throw new Error(`Usage: npm run caselist -- ${command} ${['<caselist>', '<school>', '<team>'].slice(0, needed).join(' ')}`);
      const client = new OpenCaselistClient({ token: readToken(base), baseUrl: base });
      const [c, s, t] = positional as [string, string, string];
      if (command === 'schools') print((await client.listSchools(c)).map(x => ({ name: x.name, display_name: x.display_name, state: x.state ?? null })));
      else if (command === 'teams') print((await client.listTeams(c, s)).map(x => ({ name: x.name, display_name: x.display_name })));
      else print((await client.listRounds(c, s, t, flag(flags, 'side'))).map(r => ({ round_id: r.round_id, tournament: r.tournament, side: r.side, round: r.round, opponent: r.opponent, judge: r.judge, opensource: r.opensource ?? null })));
      return;
    }
    case 'export': {
      const caselist = flag(flags, 'caselist');
      const school = flag(flags, 'school');
      const out = flag(flags, 'out');
      if (!caselist || !school || !out) throw new Error('Usage: npm run caselist -- export --caselist <c> --school <s> [--team <t>] [--side A|N] [--limit 25] --out batch.json');
      const limit = Number(flag(flags, 'limit') ?? DEFAULT_MAX_DOCUMENTS);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`--limit must be a whole number from 1 to ${MAX_LIMIT}`);
      const outPath = resolve(out);
      const manifestPath = resolve(flag(flags, 'manifest') ?? outPath.replace(/\.json$/i, '') + '.run.json');
      // Refuse before any network traffic rather than after a long download.
      for (const p of [outPath, manifestPath]) if (existsSync(p)) throw new Error('Output already exists; choose a new name: ' + p);
      const team = flag(flags, 'team');
      const side = flag(flags, 'side');
      const client = new OpenCaselistClient({ token: readToken(base), baseUrl: base });
      const { batch, manifest } = await ingestOpenCaselist({
        client, parse: parseToDoc, maxDocuments: limit,
        scope: { caselist, school, ...(team ? { team } : {}), ...(side ? { side } : {}) },
        onProgress: e => {
          if (e.phase === 'download') process.stderr.write(`[${e.index}/${e.total}] ${e.path}\n`);
          else if (e.phase === 'done' && e.status !== 'imported') process.stderr.write(`  ${e.status}: ${e.path}\n`);
        },
      });
      if (batch) writeFileSync(outPath, JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      print({ batch: batch ? outPath : null, manifest: manifestPath, ...manifest.summary, byType: batch?.summary.byType ?? null, duplicates: batch?.summary.duplicates ?? 0 });
      if (manifest.summary.failed > 0 || manifest.discoveryErrors.length > 0) process.exitCode = 2;
      return;
    }
    default:
      throw new Error('Commands: login, logout, status, caselists, schools, teams, rounds, export');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
