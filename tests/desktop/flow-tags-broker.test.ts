import {describe, expect, it} from 'vitest';
import {FlowTagsBroker} from '../../apps/desktop/src/flow-tags-broker.js';

describe('cross-window tag reads', () => {
  it('preserves validated position boundaries and refuses overlapping or out-of-range groups', async () => {
    const broker = new FlowTagsBroker();
    const positions = [{name: 'AD1', start: 0}, {name: 'AD2', start: 1}];
    await expect(broker.request(7, 'doc', request => broker.answer(7, {...request, tags: ['A', 'B'], positions}))).resolves.toEqual({tags: ['A', 'B'], positions});
    for (const invalid of [[{name: 'Off1', start: 1}], [{name: 'AD1', start: 0}, {name: 'AD2', start: 0}], [{name: 'AD1', start: 0}, {name: 'AD2', start: 9}]]) {
      await expect(broker.request(7, 'doc', request => broker.answer(7, {...request, tags: ['A', 'B'], positions: invalid}))).rejects.toThrow('position boundaries');
    }
  });
  it('accepts only the selected document owner and request id', async () => {
    const broker = new FlowTagsBroker(); let request!: {requestId: string; uid: string};
    const result = broker.request(7, 'doc-a', payload => {request = payload;});
    broker.answer(8, {...request, tags: ['Wrong window']});
    broker.answer(7, {...request, uid: 'doc-b', tags: ['Wrong document']});
    broker.answer(7, {...request, tags: ['Actual tag']});
    expect(await result).toEqual({tags: ['Actual tag']});
  });
  it('reports a closed/protected source and rejects malformed data', async () => {
    const broker = new FlowTagsBroker();
    const blocked = broker.request(7, 'doc-a', request => broker.answer(7, {...request, error: 'Protected source'}));
    await expect(blocked).rejects.toThrow('Protected source');
    const malformed = broker.request(7, 'doc-a', request => broker.answer(7, {...request, tags: [{text: 'Not a tag string'}]}));
    await expect(malformed).rejects.toThrow('invalid');
  });
  it('times out when an owning window closes or stops responding', async () => {
    await expect(new FlowTagsBroker().request(7, 'gone', () => {}, 10)).rejects.toThrow('did not respond');
  });
});
