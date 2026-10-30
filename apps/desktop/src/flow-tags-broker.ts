import { randomUUID } from 'node:crypto';
export interface FlowTagSnapshot { tags: string[]; positions?: Array<{name: string; start: number}> }
/** Only the requested document's owning renderer can answer a pending read. */
export class FlowTagsBroker {
  private pending = new Map<string, { sender: number; uid: string; resolve: (value: FlowTagSnapshot) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  request(sender: number, uid: string, send: (payload: {requestId: string; uid: string}) => void, timeout = 5000): Promise<FlowTagSnapshot> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('The source document did not respond. Check that it is still open.')); }, timeout);
      this.pending.set(requestId, {sender, uid, resolve, reject, timer});
      try { send({requestId, uid}); } catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  answer(sender: number, payload: {requestId?: string; uid?: string; tags?: unknown; positions?: unknown; error?: unknown}): void {
    const entry = this.pending.get(payload?.requestId ?? '');
    if (!entry || entry.sender !== sender || entry.uid !== payload.uid) return;
    clearTimeout(entry.timer); this.pending.delete(payload.requestId!);
    if (typeof payload.error === 'string') { entry.reject(new Error(payload.error.slice(0, 300))); return; }
    const tags = payload.tags;
    if (!Array.isArray(tags) || tags.length > 5000 || tags.some(t => typeof t !== 'string' || t.length > 100000) || tags.reduce((n, t) => n + t.length, 0) > 10000000) {
      entry.reject(new Error('The source returned an invalid or oversized tag list.')); return;
    }
    const positions = payload.positions;
    if (positions !== undefined && (!Array.isArray(positions) || positions.length > 5000 || positions.some((p, i) =>
      !p || typeof p.name !== 'string' || p.name.length > 90 || !Number.isInteger(p.start) || p.start < 0 || p.start >= tags.length ||
      (i === 0 ? p.start !== 0 : p.start <= positions[i - 1].start)) || (tags.length > 0 && positions.length === 0))) {
      entry.reject(new Error('The source returned invalid position boundaries.')); return;
    }
    entry.resolve({tags: tags as string[], ...(positions === undefined ? {} : {positions: positions as FlowTagSnapshot['positions']})});
  }
}
