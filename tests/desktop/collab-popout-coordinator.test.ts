import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollabPopoutCoordinator, popoutPrepAllowed } from '../../apps/desktop/src/collab-popout-coordinator.js';
afterEach(() => vi.useRealTimers());
describe('collaboration window handoff acknowledgement', () => {
  it('rejects an unprotected document, a mode change, and logging failure', () => {
    const prep = {started:'session',mode:'prep'};
    expect(popoutPrepAllowed(prep,{...prep,transitioning:false,error:null},true)).toBe(true);
    expect(popoutPrepAllowed(prep,{...prep,transitioning:false,error:null},false)).toBe(false);
    expect(popoutPrepAllowed(prep,{...prep,mode:'round',transitioning:false,error:null},true)).toBe(false);
    expect(popoutPrepAllowed(prep,{...prep,transitioning:true,error:null},true)).toBe(false);
    expect(popoutPrepAllowed(prep,{...prep,transitioning:false,error:'log failed'},true)).toBe(false);
  });
  it('accepts only the target window and settles exactly once', async () => {
    const manager = new CollabPopoutCoordinator(); const ready = manager.wait(2);
    expect(manager.complete(1, true)).toBe(false);
    expect(manager.complete(2, true)).toBe(true);
    expect(await ready).toBe(true);
    expect(manager.complete(2, false)).toBe(false);
  });
  it('fails closed if the target closes or never acknowledges', async () => {
    vi.useFakeTimers(); const manager = new CollabPopoutCoordinator();
    const closed = manager.wait(3); manager.complete(3, false); expect(await closed).toBe(false);
    const timeout = manager.wait(4, 20); await vi.advanceTimersByTimeAsync(20); expect(await timeout).toBe(false);
    expect(manager.complete(4, true)).toBe(false);
  });
});
