// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {countSelectedWords, installSelectionWordCount} from '../../src/editor/selection-word-count.js';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
const frame = () => new Promise(resolve => setTimeout(resolve, 30));

describe('selected text word count', () => {
  it('counts all selected words regardless of whitespace', () => {
    expect(countSelectedWords('  one\n two\tthree  ')).toBe(3);
    expect(countSelectedWords('  ')).toBe(0);
  });
  it('updates for document selections spanning differently formatted text and clears when collapsed', async () => {
    document.body.innerHTML = '<div contenteditable="true">One <b>two three</b> four</div><span id="counter"></span>';
    const display = document.querySelector<HTMLElement>('#counter')!;
    dispose = installSelectionWordCount(document, display);
    const editor = document.querySelector('div')!, range = document.createRange();
    range.setStart(editor.firstChild!, 0); range.setEnd(editor.querySelector('b')!.firstChild!, 9);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange')); await frame();
    expect(display.textContent).toBe('3 words selected'); expect(display.hidden).toBe(false);
    selection.collapseToStart(); document.dispatchEvent(new Event('selectionchange')); await frame();
    expect(display.hidden).toBe(true);
  });
  it('counts text selected in Flow textareas and updates when selection changes', async () => {
    document.body.innerHTML = '<textarea>Argument one and two</textarea><span id="counter"></span>';
    const area = document.querySelector('textarea')!, display = document.querySelector<HTMLElement>('#counter')!;
    dispose = installSelectionWordCount(document, display); area.focus(); area.setSelectionRange(0, 12);
    area.dispatchEvent(new Event('select', {bubbles:true})); await frame();
    expect(display.textContent).toBe('2 words selected');
    area.setSelectionRange(0, 8); area.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true})); await frame();
    expect(display.textContent).toBe('1 word selected');
    area.setSelectionRange(0, 0); area.dispatchEvent(new Event('select', {bubbles:true})); await frame();
    expect(display.hidden).toBe(true);
  });
  it('does not report a selection from a password field', async () => {
    document.body.innerHTML = '<input type="password" value="secret words"><span id="counter"></span>';
    const input = document.querySelector('input')!, display = document.querySelector<HTMLElement>('#counter')!;
    dispose = installSelectionWordCount(document, display); input.focus(); input.select();
    input.dispatchEvent(new Event('select', {bubbles:true})); await frame(); expect(display.hidden).toBe(true);
  });
});
