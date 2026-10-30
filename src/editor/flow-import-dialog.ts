import { columnsFor, type FlowSide } from '../flow/flow-model.js';
import { flowTabName, tagPositionGroups, type FlowTagSnapshot } from '../flow/doc-tags.js';
import { flowDocSources, type FlowDocSource } from './flow-doc-sources.js';
import { armDialogFocus, captureFocusForDialog, installModalKeys } from './text-prompt.js';
import { pushOverlay, popOverlay } from './overlay-stack.js';

export interface FlowImportChoice { source: FlowDocSource; side: FlowSide; speech: string; splitPositions: boolean }
/** One import dialog: source, filename-derived tab, side and speech column. */
export function chooseFlowTagSource(event: string, sources: FlowDocSource[]): Promise<FlowImportChoice | null> {
  return new Promise(resolve => {
    const restore = captureFocusForDialog(), token = pushOverlay();
    const overlay = document.createElement('div'); overlay.className = 'pmd-route-overlay';
    const form = document.createElement('form'); form.className = 'pmd-route-dialog pmd-text-prompt-dialog pmd-flow-import-dialog';
    const heading = document.createElement('h2'); heading.textContent = 'Import tags from open doc';
    const intro = document.createElement('p'); intro.textContent = 'Create a tab per position (AD1, AD2, DA, Off1…) with one tag per row. Your source stays unchanged; later edits are independent.';
    const field = (caption: string) => {
      const label = document.createElement('label'); label.textContent = caption;
      const select = document.createElement('select'); label.append(select); form.append(label); return select;
    };
    form.append(heading, intro);
    const source = field('Open document');
    for (const doc of sources) source.add(new Option(doc.filename || 'Untitled document', doc.uid));
    const tab = document.createElement('p'); form.append(tab);
    const splitLabel = document.createElement('label'); splitLabel.className = 'pmd-flow-import-split'; const split = document.createElement('input'); split.type = 'checkbox'; split.checked = true;
    splitLabel.append(split, 'One tab per position heading'); form.append(splitLabel);
    const side = field('Sheet starts with'); side.add(new Option('Aff', 'aff')); side.add(new Option('Neg', 'neg'));
    const speech = field('Put tags in speech column');
    const updateSpeech = () => { speech.replaceChildren(); for (const name of columnsFor(event, side.value as FlowSide)) speech.add(new Option(name, name)); };
    side.onchange = updateSpeech; updateSpeech();
    const preview = document.createElement('p'); preview.setAttribute('role', 'status'); form.append(preview);
    const buttons = document.createElement('div'); buttons.className = 'pmd-text-prompt-buttons';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.className = 'pmd-route-cancel';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Create sheets'; submit.className = 'pmd-text-prompt-ok'; submit.disabled = true;
    buttons.append(cancel, submit); form.append(buttons); overlay.append(form);
    let closed = false, generation = 0;
    const finish = (choice: FlowImportChoice | null) => { if (closed) return; closed = true; generation++; removeKeys(); popOverlay(token); overlay.remove(); restore(); resolve(choice); };
    const removeKeys = installModalKeys(form, token, e => { if (e.key === 'Escape') { finish(null); return true; } return false; });
    cancel.onclick = () => finish(null);
    overlay.onclick = e => { if (e.target === overlay) finish(null); };
    form.onsubmit = e => {
      e.preventDefault(); if (submit.disabled) return;
      const doc = sources.find(d => d.uid === source.value);
      if (doc) finish({source: doc, side: side.value as FlowSide, speech: speech.value, splitPositions: split.checked});
    };
    let snapshot: FlowTagSnapshot | null = null;
    const showPreview = () => {
      const doc = sources.find(d => d.uid === source.value);
      if (!snapshot || !doc) return;
      const groups = tagPositionGroups(snapshot, flowTabName(doc.filename), split.checked);
      tab.textContent = groups.length ? `New tabs: ${groups.map(group => `${group.name} (${group.tags.length})`).join(' · ')}` : '';
      preview.textContent = snapshot.tags.length ? `${snapshot.tags.length} tags found. ${split.checked && !snapshot.positions?.some(p => p.name) ? 'No position headings detected; using the filename. ' : ''}Citations and evidence bodies are excluded.` : 'No tags found. Apply the Tag style to the lines you want to flow.';
      submit.disabled = !snapshot.tags.length;
    };
    split.onchange = showPreview;
    const refresh = async () => {
      const current = ++generation, doc = sources.find(d => d.uid === source.value);
      snapshot = null; submit.disabled = true; preview.textContent = 'Reading tags…'; tab.textContent = '';
      if (!doc) { preview.textContent = 'Open a tagged document in CardMirror Green first.'; return; }
      try {
        const read = await flowDocSources().read(doc.uid);
        if (closed || current !== generation) return;
        snapshot = read; showPreview();
      } catch (error) { if (!closed && current === generation) preview.textContent = error instanceof Error ? error.message : String(error); }
    };
    source.onchange = () => { void refresh(); };
    document.body.append(overlay); armDialogFocus(form, 'dialog', 'Import tags from open doc'); void refresh();
  });
}
