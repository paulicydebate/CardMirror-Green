/**
 * OpenCaselist panel — main-process side.
 *
 * The renderer's OpenCaselist panel calls `host:opencaselist` with an
 * operation name and arguments. The service (src/opencaselist/app-service.ts,
 * esbuild-bundled into opencaselist-service.cjs because it lives outside this
 * tsconfig's rootDir) does the network work here in main, so the session token
 * never reaches the renderer. The Tabroom password passes through once to
 * OpenCaselist and is never stored.
 *
 * Only the token is saved, in `{userData}/opencaselist-session.bin`, encrypted
 * with the OS keychain (Electron safeStorage) when available. Without OS
 * encryption it is written as owner-only plain text, the same as the CLI.
 */

import { app, ipcMain, safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Result = { ok: boolean; [key: string]: unknown };
interface ServiceLike {
  status(): Promise<Result>;
  login(username: unknown, password: unknown): Promise<Result>;
  logout(): Promise<Result>;
  caselists(): Promise<Result>;
  schools(caselist: unknown): Promise<Result>;
  teams(caselist: unknown, school: unknown): Promise<Result>;
  rounds(caselist: unknown, school: unknown, team: unknown): Promise<Result>;
  download(filePath: unknown): Promise<Result>;
}

const ENC_PREFIX = Buffer.from('CMGE1');
const PLAIN_PREFIX = Buffer.from('CMGP1');

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'opencaselist-session.bin');
}

const store = {
  read(): string | null {
    const file = sessionFile();
    if (!existsSync(file)) return null;
    const raw = readFileSync(file);
    if (raw.subarray(0, ENC_PREFIX.length).equals(ENC_PREFIX)) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(raw.subarray(ENC_PREFIX.length));
    }
    if (raw.subarray(0, PLAIN_PREFIX.length).equals(PLAIN_PREFIX)) {
      return raw.subarray(PLAIN_PREFIX.length).toString('utf8');
    }
    return null;
  },
  write(value: string): void {
    const body = safeStorage.isEncryptionAvailable()
      ? Buffer.concat([ENC_PREFIX, safeStorage.encryptString(value)])
      : Buffer.concat([PLAIN_PREFIX, Buffer.from(value, 'utf8')]);
    writeFileSync(sessionFile(), body, { mode: 0o600 });
  },
  remove(): void {
    rmSync(sessionFile(), { force: true });
  },
};

let service: ServiceLike | null = null;
function getService(): ServiceLike {
  if (!service) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(__dirname, 'opencaselist-service.cjs')) as {
      createOpenCaselistService(opts: { store: typeof store }): ServiceLike;
    };
    service = mod.createOpenCaselistService({ store });
  }
  return service;
}

export function registerOpenCaselistIpc(): void {
  ipcMain.handle('host:opencaselist', async (_event, op: unknown, ...args: unknown[]): Promise<Result> => {
    const s = getService();
    switch (op) {
      case 'status': return s.status();
      case 'login': return s.login(args[0], args[1]);
      case 'logout': return s.logout();
      case 'caselists': return s.caselists();
      case 'schools': return s.schools(args[0]);
      case 'teams': return s.teams(args[0], args[1]);
      case 'rounds': return s.rounds(args[0], args[1], args[2]);
      case 'download': return s.download(args[0]);
      default: return { ok: false, error: 'Unknown OpenCaselist operation', signedOut: false };
    }
  });
}
