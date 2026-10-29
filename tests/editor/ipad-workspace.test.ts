// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../../src/schema/index.js';
import { mobilePlugin, setMobileShellActive, setMobileTapMode } from '../../src/editor/mobile-plugin.js';
import { readModePlugin, PMD_READ_MODE_TOGGLE } from '../../src/editor/read-mode-plugin.js';
import { tabletDevice, resolveMobileLayout } from '../../src/editor/mobile-layout.js';
import { tabletViewportInsets, installTabletViewport } from '../../src/editor/tablet-viewport.js';
import { settings } from '../../src/editor/settings.js';
import { BrowserHost } from '../../src/editor/host/browser-host.js';
const properties: Array<() => void> = [];
function property(object: object, key: string, value: unknown): void { const before=Object.getOwnPropertyDescriptor(object,key); Object.defineProperty(object,key,{configurable:true,value}); properties.push(()=>{if(before)Object.defineProperty(object,key,before);else Reflect.deleteProperty(object,key);}); }
const ipad = { userAgent: 'Mozilla/5.0 Macintosh', platform: 'MacIntel', maxTouchPoints: 5, coarsePointer: false, screenWidth: 1366, screenHeight: 1024 };
afterEach(() => { setMobileShellActive(false); while(properties.length) properties.pop()!(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); document.body.replaceChildren(); });
describe('iPad workspace', () => {
  it('recognizes iPad desktop identification and keeps tablet chrome in landscape or split view', () => {
    expect(tabletDevice(ipad)).toBe(true);
    expect(tabletDevice({...ipad,maxTouchPoints:0})).toBe(false);
    expect(tabletDevice({...ipad,userAgent:'iPhone',platform:'iPhone',coarsePointer:true,screenWidth:390,screenHeight:844})).toBe(false);
    for (const width of [600,820,1366]) expect(resolveMobileLayout('auto',{hostKind:'browser',coarsePointer:false,viewportWidth:width,tablet:true})).toBe(true);
    expect(resolveMobileLayout('auto',{hostKind:'electron',coarsePointer:true,viewportWidth:600,tablet:true})).toBe(false);
  });
  it('allows tablet typing while preserving Read and Move locks and phone reading behavior', () => {
    settings.set('readMode',false); setMobileShellActive(true,true);
    const view = new EditorView(document.body,{state:EditorState.create({schema,doc:schema.nodes.doc!.create(null,[schema.nodes.paragraph!.create()]),plugins:[mobilePlugin,readModePlugin]})});
    try {
      expect(view.editable).toBe(true);view.dispatch(view.state.tr.insertText('typed on iPad',1));expect(view.state.doc.textContent).toBe('typed on iPad');
      setMobileTapMode(view,'move');expect(view.editable).toBe(false);
      setMobileTapMode(view,'none');expect(view.editable).toBe(true);
      view.dispatch(view.state.tr.setMeta(PMD_READ_MODE_TOGGLE,true));expect(view.editable).toBe(false);
      view.dispatch(view.state.tr.setMeta(PMD_READ_MODE_TOGGLE,false));expect(view.editable).toBe(true);
      setMobileShellActive(true);view.dispatch(view.state.tr);expect(view.editable).toBe(false);
    } finally { view.destroy(); }
  });
  it('reserves the keyboard inset and tracks visual viewport changes', () => {
    expect(tabletViewportInsets(1024,580,40)).toEqual({top:40,bottom:404});
    expect(tabletViewportInsets(800,900,0)).toEqual({top:0,bottom:0});
    const viewport = new EventTarget() as EventTarget & {height:number;offsetTop:number}; viewport.height=580;viewport.offsetTop=0;
    property(window,'visualViewport',viewport);
    const stop=installTabletViewport();expect(document.body.style.getPropertyValue('--pmd-tablet-bottom')).toBe(`${Math.max(0,innerHeight-580)}px`);
    viewport.height=innerHeight;viewport.dispatchEvent(new Event('resize'));expect(document.body.style.getPropertyValue('--pmd-tablet-bottom')).toBe('0px');stop();
  });
  it('does not spawn new tabs for installed iPad PWAs', () => {
    vi.spyOn(navigator,'platform','get').mockReturnValue('MacIntel');
    property(navigator,'maxTouchPoints',5);
    localStorage.setItem('pmd-pwa-installed','1');
    expect(new BrowserHost().canSpawnWindow).toBe(false);
  });
  it('keeps download blobs alive long enough for Safari to consume them', async () => {
    vi.useFakeTimers();const create=vi.fn(()=> 'blob:test-copy');const revoke=vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL=create; static revokeObjectURL=revoke; });
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    try {
      const result=await new BrowserHost().saveAs('flow.cmir',new Uint8Array([1,2,3]));
      expect(result).toEqual({name:'flow.cmir'});expect(click).toHaveBeenCalled();expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60000);expect(revoke).toHaveBeenCalledWith('blob:test-copy');
    } finally { vi.unstubAllGlobals(); }
  });
});
