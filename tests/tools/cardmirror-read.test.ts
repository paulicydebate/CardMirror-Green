/**
 * cardmirror-read library — rendering + round-trip.
 *
 * The CLI's value is fidelity to the app's own formats, so the tests
 * drive the lib with docs built from the real schema and bytes from
 * the real serializer.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import {
  renderPlainText,
  toUncompressedJson,
  parseToDoc,
} from '../../src/tools/cardmirror-read-lib.js';

const n = schema.nodes;
const m = schema.marks;

function demoDoc() {
  return n['doc']!.createChecked(null, [
    n['pocket']!.create({ id: newHeadingId() }, schema.text('1AC')),
    n['block']!.create({ id: newHeadingId() }, schema.text('Governance ADV')),
    n['card']!.createChecked(null, [
      n['tag']!.create({ id: newHeadingId() }, schema.text('Space law collapses')),
      n['cite_paragraph']!.create(null, schema.text('Author 21, qualified')),
      n['card_body']!.create(null, [
        schema.text('plain '),
        schema.text('read ', [m['highlight']!.create()]),
        schema.text('aloud', [m['highlight']!.create()]),
        schema.text(' and ', [m['underline_mark']!.create()]),
        schema.text('kept', [m['underline_mark']!.create()]),
      ]),
    ]),
  ]);
}

describe('renderPlainText', () => {
  it('renders outline levels, cite lines, and merged mark runs', () => {
    const text = renderPlainText(demoDoc(), 'demo.cmir');
    expect(text).toContain('# 1AC');
    expect(text).toContain('### Governance ADV');
    expect(text).toContain('#### Space law collapses');
    expect(text).toContain('Cite: Author 21, qualified');
    // Adjacent same-mark text nodes merge into ONE wrapper pair, with
    // whitespace kept outside the markers.
    expect(text).toContain('plain ==read aloud== __and kept__');
    expect(text).not.toContain('====');
  });
});

describe('mirror planning', () => {
  it('single source maps flat; multiple sources get de-duplicated subfolders', async () => {
    const { planSources, shadowPathFor } = await import(
      '../../src/tools/cardmirror-read-mirror.js'
    );
    const single = planSources(['/a/Debate']);
    expect(single).toEqual([{ root: '/a/Debate', prefix: '' }]);
    const multi = planSources(['/a/Backfiles', '/b/Backfiles', '/c/Current']);
    expect(multi.map((s) => s.prefix)).toEqual(['Backfiles', 'Backfiles-2', 'Current']);
    // Shadow paths: extension swapped, tree preserved, non-convertibles null.
    expect(shadowPathFor(single[0]!, '/out', '/a/Debate/subdir/File Name.cmir')).toBe(
      path.join('/out', 'subdir', 'File Name.txt'),
    );
    expect(shadowPathFor(single[0]!, '/out', '/a/Debate/notes.txt')).toBeNull();
    expect(shadowPathFor(single[0]!, '/out', '/elsewhere/x.cmir')).toBeNull();
  });
});

describe('mcp dispatch', () => {
  it('handshake, list, and method-not-found behave per JSON-RPC', async () => {
    const { handleMcpMessage } = await import('../../src/tools/cardmirror-read-mcp.js');
    const init = JSON.parse(
      (await handleMcpMessage([], JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })))!,
    );
    expect(init.result.serverInfo.name).toBe('cardmirror-read');
    expect(init.result.protocolVersion).toBe('2025-06-18');
    // Notifications get NO reply.
    expect(await handleMcpMessage([], JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toBeNull();
    const tools = JSON.parse((await handleMcpMessage([], JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })))!);
    expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'list_debate_files',
      'read_debate_file',
    ]);
    const unknown = JSON.parse((await handleMcpMessage([], JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'resources/list' })))!);
    expect(unknown.error.code).toBe(-32601);
  });

  it('read_debate_file refuses paths outside the roots', async () => {
    const { handleMcpMessage } = await import('../../src/tools/cardmirror-read-mcp.js');
    const reply = JSON.parse(
      (await handleMcpMessage(
        ['/nonexistent-root-for-test'],
        JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'read_debate_file', arguments: { path: '/etc/hosts' } },
        }),
      ))!,
    );
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain('not found inside the configured folders');
  });
});

describe('json + parse round trip', () => {
  it('uncompressed json of real serialized bytes matches the doc', async () => {
    const doc = demoDoc();
    const bytes = serializeNative(doc, { appVersion: 'test' });
    const json = await toUncompressedJson(bytes, 'cmir');
    const envelope = JSON.parse(json);
    expect(envelope.format).toBe('cardmirror-doc');
    expect(envelope.doc.type).toBe('doc');
    // And the doc parses back identically through the app's own path.
    const parsed = await parseToDoc(bytes, 'cmir');
    expect(parsed.toJSON()).toEqual(doc.toJSON());
  });
});
