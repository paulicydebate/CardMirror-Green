/** Acknowledge only the exact target window; a timeout/close aborts the move. */
export class CollabPopoutCoordinator {
  private pending = new Map<number, (ready: boolean) => void>();

  wait(target: number, timeoutMs = 45_000): Promise<boolean> {
    if (this.pending.has(target)) throw new Error('Pop-out already pending');
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (ready: boolean): void => {
        if (this.pending.get(target) !== finish) return;
        clearTimeout(timer); this.pending.delete(target); resolve(ready);
      };
      this.pending.set(target, finish);
    });
  }

  complete(target: number, ready: boolean): boolean {
    const finish = this.pending.get(target);
    if (!finish) return false;
    finish(ready); return true;
  }
}

export interface PopoutPrepPolicy {
  started: string | null;
  mode: string | null;
}
export function popoutPrepAllowed(original: PopoutPrepPolicy, current: PopoutPrepPolicy & {transitioning: boolean; error: string | null}, protectedDoc: boolean): boolean {
  return !current.transitioning && !current.error && original.started === current.started && original.mode === current.mode && (current.started === null || protectedDoc);
}
