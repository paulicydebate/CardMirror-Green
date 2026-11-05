/** Show the actual selected words, independent of read-aloud formatting. */
export function countSelectedWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function installSelectionWordCount(doc: Document, display: HTMLElement): () => void {
  let frame = 0;
  const update = (): void => {
    frame = 0;
    const active = doc.activeElement;
    let selected = '';
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
      // Passwords and non-text input types never expose a selected value.
      if (!(active instanceof HTMLInputElement) || active.type !== 'password') {
        const start = active.selectionStart, end = active.selectionEnd;
        if (start !== null && end !== null && end > start) selected = active.value.slice(start, end);
      }
    } else {
      selected = doc.getSelection()?.toString() ?? '';
    }
    const words = countSelectedWords(selected);
    display.hidden = !selected;
    display.textContent = selected ? `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} selected` : '';
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const events = ['selectionchange', 'select', 'keyup', 'mouseup', 'input', 'focusin', 'focusout'] as const;
  for (const type of events) doc.addEventListener(type, schedule, true);
  update();
  return () => {
    for (const type of events) doc.removeEventListener(type, schedule, true);
    if (frame) cancelAnimationFrame(frame);
  };
}
