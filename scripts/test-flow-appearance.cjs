/* Hidden browser checks: synthetic Flow only; no accounts or normal profiles. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium, devices} = require('playwright');
const root = path.resolve('dist'), output = path.resolve('tests/scratch/flow-appearance');
fs.mkdirSync(output, {recursive:true});
const watchdog = setTimeout(()=>{console.error('Flow appearance check timed out.');process.exit(1);},180000);watchdog.unref();
const server = http.createServer((req,res)=>{
  let relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/CardMirror-Green\//,'');
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{
    if(error){res.writeHead(404).end();return;}
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.woff2':'font/woff2','.png':'image/png'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(bytes);
  });
});
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=`http://127.0.0.1:${server.address().port}/CardMirror-Green/`;
  const browser=await chromium.launch({headless:true});
  try{
    for(const fixture of [{platform:'Win32',width:1366,pane:0},{platform:'MacIntel',width:1366,pane:320},{platform:'MacIntel',width:600,pane:0}]){
      const context=await browser.newContext({...devices['iPad Pro 11'],viewport:{width:fixture.width,height:900}});
      await context.route('**/registerSW.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* PWA checked separately. */'}));
      await context.addInitScript(platform=>{
        Object.defineProperty(navigator,'platform',{value:platform,configurable:true});
        localStorage.setItem('pmd-settings',JSON.stringify({showOnboardingStarter:false,multiDocWorkspace:false,aiFeaturesEnabled:false}));
        localStorage.setItem('cmg-flow-theme',JSON.stringify({base:'soft-dark',colorway:'sage-plum'}));
      },fixture.platform);
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(address);await page.getByRole('button',{name:/^New Flow/}).click();await page.getByRole('button',{name:'NPDA (parli)',exact:true}).click();
      await page.locator('textarea[data-row="0"][data-col="0"]').fill('Synthetic first-side argument');
      await page.locator('textarea[data-row="0"][data-col="1"]').fill('Synthetic second-side argument');
      if(fixture.pane)await page.locator('.pmd-flow-root').evaluate((el,width)=>{el.style.width=width+'px';},fixture.pane);
      for(const base of ['soft','soft-dark']){
        await page.getByTitle('Colors, text size and font',{exact:true}).click();
        await page.locator(`.pmd-flow-seg[data-base="${base}"]`).click();
        const contentFont=await page.locator('textarea[data-row="0"][data-col="0"]').evaluate(el=>({family:getComputedStyle(el).fontFamily,weight:getComputedStyle(el).fontWeight}));
        assert.ok(contentFont.family.includes('Merriweather Sans'));assert.equal(contentFont.weight,'300');
        const panel=page.locator('.pmd-flow-appearance'),shortcut=panel.getByRole('textbox',{name:'Highlight shortcut',exact:true});
        await shortcut.scrollIntoViewIfNeeded();
        const geometry=await panel.evaluate(el=>{
          const bounds=el.getBoundingClientRect(),owner=el.closest('.pmd-flow-root').getBoundingClientRect();
          const input=el.querySelector('input[aria-label="Highlight shortcut"]');
          return {fits:bounds.left>=owner.left&&bounds.right<=owner.right+1,overflow:el.scrollWidth-el.clientWidth,inputOverflow:input.scrollWidth-input.clientWidth,
            family:getComputedStyle(input).fontFamily,labelFamily:getComputedStyle(el.querySelector('.pmd-flow-app-head')).fontFamily,weight:getComputedStyle(el).fontWeight,
            chromeFamilies:[...el.closest('.pmd-flow-root').querySelectorAll('.pmd-flow-title,.pmd-flow-tab,.pmd-flow-head')].map(control=>getComputedStyle(control).fontFamily),
            buttons:[...el.querySelectorAll('.pmd-flow-segment:first-of-type button')].map(b=>b.scrollWidth-b.clientWidth)};
        });
        assert.equal(geometry.fits,true,JSON.stringify(geometry));assert.ok(geometry.overflow<=1,JSON.stringify(geometry));assert.ok(geometry.inputOverflow<=1,JSON.stringify(geometry));
        assert.equal(geometry.family,geometry.labelFamily);assert.equal(geometry.weight,'400');
        assert.ok(geometry.chromeFamilies.every(font=>font===geometry.labelFamily),JSON.stringify(geometry));
        const background=panel.locator('.pmd-flow-segment').first();assert.equal(await background.locator('button').count(),6);
        assert.ok(await background.locator('button').evaluateAll(buttons=>buttons.every(b=>b.scrollWidth<=b.clientWidth+1)));
        const initial=await shortcut.inputValue();assert.equal(initial,fixture.platform==='Win32'?'Ctrl+Shift+H':'Cmd+Shift+H');
        await shortcut.focus();await shortcut.press('Tab');assert.equal(await shortcut.evaluate(el=>el===document.activeElement),false);
        const palettes=fixture.platform==='Win32'?await panel.locator('[data-colorway]').evaluateAll(buttons=>buttons.map(b=>b.dataset.colorway)):['sage-plum'];
        await page.screenshot({path:path.join(output,`${fixture.platform}-${fixture.width}-${fixture.pane}-${base}-shortcut.png`)});
        let referenceBands=null;
        for(const colorway of palettes){
          await panel.locator(`[data-colorway="${colorway}"]`).click();
          await panel.getByTitle('Close',{exact:true}).click();
          const surfaces=await page.locator('.pmd-flow-root').evaluate(root=>{
            const neutral=element=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(element).backgroundColor;ctx.fillRect(0,0,1,1);const [r,g,b]=ctx.getImageData(0,0,1,1).data;return Math.abs(r-g)<=1&&Math.abs(g-b)<=1;};
            return [...root.querySelectorAll('.pmd-flow-td,.pmd-flow-chip,.pmd-flow-tab-active')].every(neutral);
          });
          assert.equal(surfaces,true,`${base}/${colorway}: speech-colored background remains`);
          const bands=await page.locator('.pmd-flow-root').evaluate(root=>({
            cells:[...root.querySelectorAll('.pmd-flow-grid tbody tr:nth-child(3) td')].slice(0,3).map(el=>getComputedStyle(el).backgroundColor),
            heads:[...root.querySelectorAll('.pmd-flow-head')].slice(0,3).map(el=>getComputedStyle(el).backgroundColor),
          }));
          assert.equal(bands.cells[0],bands.cells[2]);assert.notEqual(bands.cells[0],bands.cells[1]);
          assert.deepEqual(bands.heads,bands.cells,'Column headers must follow the body bands');
          if(referenceBands)assert.deepEqual(bands,referenceBands,'Text colorways must not change column backgrounds');else referenceBands=bands;
          for(const col of [0,1]){
            const contrast=await page.locator(`textarea[data-row="0"][data-col="${col}"]`).evaluate(area=>{
              area.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));area.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));area.focus();
              const rgb=color=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
              const lum=color=>{const c=rgb(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
              const ratio=(a,b)=>{const l=[lum(a),lum(b)].sort((a,b)=>b-a);return (l[0]+.05)/(l[1]+.05);};
              const text=getComputedStyle(area).color,bg=getComputedStyle(area.closest('td')).backgroundColor,selection=getComputedStyle(area,'::selection');
              return {selected:area.closest('td').getAttribute('aria-selected'),text,bg,nativeText:selection.color,nativeBg:selection.backgroundColor,cellAlpha:rgb(bg)[3],nativeAlpha:rgb(selection.backgroundColor)[3],cell:ratio(text,bg),native:ratio(selection.color,selection.backgroundColor)};
            });
            assert.equal(contrast.selected,'true');assert.equal(contrast.cellAlpha,255);assert.equal(contrast.nativeAlpha,255);assert.ok(contrast.cell>=4.5,`${base}/${colorway}/${col}: ${JSON.stringify(contrast)}`);assert.ok(contrast.native>=4.5,JSON.stringify(contrast));
          }
          await page.getByTitle('Colors, text size and font',{exact:true}).click();
        }
        await panel.evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:path.join(output,`${fixture.platform}-${fixture.width}-${fixture.pane}-${base}-backgrounds.png`)});
        await panel.getByTitle('Close',{exact:true}).click();
        console.log(`${fixture.platform}/${fixture.width}/pane ${fixture.pane||'full'}/${base}: controls fit, UI fonts match, ${palettes.length} palettes pass selected-cell and native-selection contrast.`);
      }
      assert.deepEqual(errors,[]);await context.close();
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
