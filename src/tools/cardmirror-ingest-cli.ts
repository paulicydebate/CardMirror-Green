/** Read-only local export. Writes a NEW JSON file; never overwrites a source or existing output. */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { parseToDoc } from './cardmirror-read-lib.js';
import { createIngestBatch, sha256Bytes } from '../editor/card-ingest-batch.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files: string[] = [];
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--out') {
      if (output || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Supply one --out JSON path');
      output = args[++i];
    } else if (arg.startsWith('-')) throw new Error('Unknown option: ' + arg);
    else files.push(resolve(arg));
  }
  if (!output || !files.length) throw new Error('Usage: npm run ingest:export -- --out batch.json file.docx [file.cmir ...]');
  const inputs = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.docx' && ext !== '.cmir') throw new Error('Expected .docx or .cmir: ' + basename(file));
    const format = ext === '.docx' ? 'docx' as const : 'cmir' as const;
    const bytes = readFileSync(file);
    const sha256 = await sha256Bytes(bytes);
    inputs.push({ source: { id: 'local:' + sha256 + ':' + basename(file).normalize('NFC'), format, sha256, title: basename(file) }, doc: await parseToDoc(bytes, format) });
  }
  const batch = await createIngestBatch(inputs);
  writeFileSync(resolve(output), JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: resolve(output), ...batch.summary }));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
