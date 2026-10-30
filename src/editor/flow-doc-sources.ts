import type { FlowTagSnapshot } from '../flow/doc-tags.js';
export interface FlowDocSource { uid: string; filename: string | null }
export interface FlowDocSources {
  list(): Promise<FlowDocSource[]>;
  read(uid: string): Promise<FlowTagSnapshot>;
}
let sources: FlowDocSources = { list: async () => [], read: async () => { throw new Error('No open document is available.'); } };
export function setFlowDocSources(provider: FlowDocSources): void { sources = provider; }
export function flowDocSources(): FlowDocSources { return sources; }
