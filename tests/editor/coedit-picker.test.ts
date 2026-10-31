// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openCoeditPicker, type CoeditPickerOptions } from '../../src/editor/collab/coedit-picker.js';
import { promptForChoice } from '../../src/editor/text-prompt.js';
vi.mock('../../src/editor/text-prompt.js', () => ({ promptForChoice: vi.fn() }));
vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));
const choice = vi.mocked(promptForChoice);
afterEach(() => vi.clearAllMocks());
function options(): CoeditPickerOptions {
  return { documentUid: 'active-flow', documentTitle: 'Gov case', currentUid: () => 'active-flow', connected: true,
    partners: [{ code: 'alex-code', name: 'Alex' }, { code: 'hidden-code', name: 'Hidden', hidden: true }],
    invite: vi.fn(async () => {}), configure: vi.fn(), join: vi.fn() };
}
describe('named partner co-edit picker', () => {
  it('names the active document and invites the selected saved partner without exposing hidden contacts', async () => {
    const opts = options(); choice.mockResolvedValue('person:0'); await openCoeditPicker(opts);
    expect(choice.mock.calls[0]![0].message).toContain('Gov case');
    expect(choice.mock.calls[0]![0].choices.map(c => c.label)).toContain('Co-edit with Alex');
    expect(choice.mock.calls[0]![0].choices.map(c => c.label).join(' ')).not.toContain('Hidden');
    expect(opts.invite).toHaveBeenCalledWith({ codes: ['alex-code'], label: 'Alex' });
  });
  it('does not invite if the active document changes, the picker is canceled, or sharing is not configured', async () => {
    const opts = options(); opts.currentUid = () => 'other-doc'; choice.mockResolvedValue('person:0'); await openCoeditPicker(opts);
    expect(opts.invite).not.toHaveBeenCalled();
    choice.mockResolvedValue(null); await openCoeditPicker(options());
    const disconnected = options(); disconnected.connected = false; choice.mockResolvedValue('settings'); await openCoeditPicker(disconnected);
    expect(choice.mock.calls.at(-1)![0].choices.map(c => c.value)).not.toContain('person:0');
    expect(disconnected.configure).toHaveBeenCalledOnce(); expect(disconnected.invite).not.toHaveBeenCalled();
  });
});
