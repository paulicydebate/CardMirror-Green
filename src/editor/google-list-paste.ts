import { formatListNumber } from '../import/list-labels.js';

/** Google Docs' clipboard lists carry their labels in HTML list styling, not
 * text. CardMirror has flat paragraphs, so preserve visible labels as text. */
export function preserveGoogleListLabels(html: string): string {
  if (!/\bid=["']?docs-internal-guid-/i.test(html) || !/<(?:ol|ul)\b/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lists = Array.from(doc.querySelectorAll('ol,ul')).filter(el => !el.parentElement?.closest('ol,ul'));
  const walk = (list: Element): void => {
    const ordered = list.tagName.toLowerCase() === 'ol';
    let value = Number(list.getAttribute('start') ?? 1);
    if (!Number.isFinite(value)) value = 1;
    for (const item of Array.from(list.children)) {
      if (item.tagName.toLowerCase() !== 'li') continue;
      const override = item.getAttribute('value');
      if (override !== null && Number.isFinite(Number(override))) value = Number(override);
      const style = (item as HTMLElement).style.listStyleType || (list as HTMLElement).style.listStyleType || list.getAttribute('type') || '';
      const map: Record<string, string> = { 'lower-alpha': 'lowerLetter', 'lower-latin': 'lowerLetter', 'upper-alpha': 'upperLetter', 'upper-latin': 'upperLetter', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman' };
      const prefix = !ordered || ['disc','circle','square'].includes(style) ? '•' : formatListNumber(value, map[style] ?? 'decimal') + '.';
      const first = item.firstElementChild;
      const target = first && /^(p|div)$/i.test(first.tagName) ? first : item;
      target.insertBefore(doc.createTextNode(prefix + ' '), target.firstChild);
      value++;
      for (const nested of Array.from(item.querySelectorAll('ol,ul')).filter(el => el.parentElement?.closest('li') === item)) walk(nested);
    }
  };
  for (const list of lists) walk(list);
  return doc.body.innerHTML;
}
