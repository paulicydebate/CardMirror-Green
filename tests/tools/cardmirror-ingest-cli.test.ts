import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { schema } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';

it('exports native input without mutation, omits absolute paths, and refuses overwrite or partial output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-ingest-cli-'));
  try {
    const file = join(dir, 'sample.cmir');
    const out = join(dir, 'batch.json');
    const d = schema.nodes.doc!.createChecked(null, [schema.nodes.card!.createChecked(null, [
      schema.nodes.tag!.create({ id: 'test-card' }, schema.text('Test tag')),
      schema.nodes.cite_paragraph!.create(null, schema.text('Author')),
      schema.nodes.card_body!.create(null, schema.text('Evidence')),
    ])]);
    const original = Buffer.from(serializeNative(d, { appVersion: 'test' }));
    writeFileSync(file, original);
    const run = (...files: string[]) => spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/tools/cardmirror-ingest-cli.ts'), '--out', out, ...files], { encoding: 'utf8' });
    const result = run(file);
    expect(result.status, result.stderr).toBe(0);
    const json = readFileSync(out, 'utf8');
    expect(json).not.toContain(dir.replaceAll('\\', '\\\\'));
    expect(JSON.parse(json).summary.byType.evidence).toBe(1);
    expect(readFileSync(file)).toEqual(original);
    expect(run(file).status).not.toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(json);
    const badOut = join(dir, 'partial.json');
    const bad = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/tools/cardmirror-ingest-cli.ts'), '--out', badOut, file, join(dir, 'missing.cmir')], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(existsSync(badOut)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
