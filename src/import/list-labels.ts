/** Preserve rendered list labels when importing into CardMirror's flat paragraphs. */
import { attrs, children, findChild, parseXml, type XmlNode } from '../ooxml/parse.js';

type Level = { format: string; text: string; start: number };
const getVal = (nodes: XmlNode[], name: string, fallback = ''): string => {
  const node = findChild(nodes, name); return node ? attrs(node)['w:val'] ?? fallback : fallback;
};
function levelOf(node: XmlNode, fallback?: Level): Level {
  const parts = children(node, 'w:lvl');
  const start = Number(getVal(parts, 'w:start', String(fallback?.start ?? 1)));
  return { format: getVal(parts, 'w:numFmt', fallback?.format ?? 'decimal'), text: getVal(parts, 'w:lvlText', fallback?.text ?? `%${Number(attrs(node)['w:ilvl'] ?? 0) + 1}.`), start: Number.isSafeInteger(start) ? start : 1 };
}
export function formatListNumber(n: number, format: string): string {
  if (format === 'bullet') return '•';
  if ((format === 'lowerLetter' || format === 'upperLetter') && n > 0 && n < 100000) {
    let out = ''; for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(97 + (v - 1) % 26) + out;
    return format === 'upperLetter' ? out.toUpperCase() : out;
  }
  if ((format === 'lowerRoman' || format === 'upperRoman') && n > 0 && n < 4000) {
    let value = n, out = ''; for (const [amount, symbol] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']] as const) while (value >= amount) { out += symbol; value -= amount; }
    return format === 'lowerRoman' ? out.toLowerCase() : out;
  }
  return String(n);
}
export function docxListLabels(xml: string): (id: number, level: number) => string | null {
  const root = findChild(parseXml(xml), 'w:numbering');
  const definitions = new Map<string, Map<number, Level>>();
  const instances = new Map<number, Map<number, Level>>();
  const counts = new Map<number, number[]>();
  if (!root) return () => null;
  const parts = children(root, 'w:numbering');
  for (const n of parts) if ('w:abstractNum' in n) {
    const levels = new Map<number, Level>();
    for (const l of children(n, 'w:abstractNum')) if ('w:lvl' in l) levels.set(Number(attrs(l)['w:ilvl']), levelOf(l));
    definitions.set(attrs(n)['w:abstractNumId'] ?? '', levels);
  }
  for (const n of parts) if ('w:num' in n) {
    const sub = children(n, 'w:num'); const levels = new Map(definitions.get(getVal(sub, 'w:abstractNumId')) ?? []);
    for (const o of sub) if ('w:lvlOverride' in o) {
      const i = Number(attrs(o)['w:ilvl']); const opts = children(o, 'w:lvlOverride'); const full = findChild(opts, 'w:lvl');
      const level = full ? levelOf(full, levels.get(i)) : levels.get(i);
      if (level) { const start = getVal(opts, 'w:startOverride'); levels.set(i, { ...level, start: start !== '' && Number.isFinite(Number(start)) ? Number(start) : level.start }); }
    }
    instances.set(Number(attrs(n)['w:numId']), levels);
  }
  return (id, level) => {
    const defs = instances.get(id), def = defs?.get(level); if (!defs || !def) return null;
    const nums = counts.get(id) ?? []; nums[level] = nums[level] === undefined ? def.start : nums[level]! + 1; nums.length = level + 1; counts.set(id, nums);
    if (def.format === 'bullet') return def.text || '•';
    if (def.format === 'none') return null;
    return def.text.replace(/%([1-9])/g, (_match, digit: string) => { const i = Number(digit) - 1; const d = defs.get(i); return formatListNumber(nums[i] ?? d?.start ?? 1, d?.format ?? 'decimal'); });
  };
}
