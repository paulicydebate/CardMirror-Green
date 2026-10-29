/* Headless WebKit smoke test. Uses synthetic data and fresh, disposable contexts only. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { webkit, devices } = require('playwright');
const watchdog=setTimeout(()=>{console.error('Headless iPad check exceeded three minutes.');process.exit(1);},180000);watchdog.unref();
require('tsx/cjs');
const { startRoomsMock } = require('../tests/collab/_rooms-mock.ts');
let relayMock;
const root = path.resolve('dist');
const output = path.resolve('tests/scratch/ipad-check');
fs.mkdirSync(output, {recursive:true});
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (relayMock && url.pathname.startsWith('/CardMirror-Green/relay/')) {
    const target = new URL('/relay/' + url.pathname.slice('/CardMirror-Green/relay/'.length) + url.search, relayMock.url);
    const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode, upstreamResponse.headers); upstreamResponse.pipe(res);
    });
    upstream.on('error', () => { if(!res.headersSent)res.writeHead(502);res.end(); });
    res.on('close', () => upstream.destroy()); req.pipe(upstream); return;
  }
  let relative = decodeURIComponent(url.pathname).replace(/^\/CardMirror-Green\//,'');
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root,relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file,(error,bytes) => {
    if(error) { res.writeHead(404).end(); return; }
    const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.png':'image/png'}[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length});res.end(bytes);
  });
});
async function run() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=`http://127.0.0.1:${server.address().port}/CardMirror-Green/`;
  relayMock = await startRoomsMock(); relayMock.setGuestPass('synthetic-browser-guest');
  const browser=await webkit.launch({headless:true});
  try {
    for(const width of [1024,1366,600]) {
      const context=await browser.newContext({...devices['iPad Pro 11'], viewport:{width,height:768},acceptDownloads:true});
      await context.route('**/registerSW.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* Service-worker tests run separately in Chromium. */'}));
      await context.addInitScript(()=>{
        if(!localStorage.getItem('pmd-settings')) localStorage.setItem('pmd-settings',JSON.stringify({showOnboardingStarter:false,multiDocWorkspace:false,aiFeaturesEnabled:false}));
      });
      const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());const pending=new Set();page.on('request',r=>pending.add(r.url()));page.on('requestfinished',r=>pending.delete(r.url()));page.on('requestfailed',r=>{pending.delete(r.url());console.log('Request failed:',r.url(),r.failure()?.errorText)});page.on('console',m=>{if(m.type()==='error')console.log('Browser console:',m.text())});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Page error:',e.message)});
      await page.goto(address);
      await page.getByRole('button',{name:/^New Flow/}).click();
      await page.getByRole('button',{name:'NPDA (parli)',exact:true}).click();
      const cell=page.locator('textarea.pmd-flow-cell[data-row="0"][data-col="0"]');
      await cell.fill('Synthetic iPad argument');await cell.press('Enter');
      assert.equal(await page.locator('textarea.pmd-flow-cell[data-row="1"][data-col="0"]').evaluate(el=>el===document.activeElement),true);
      assert.equal(await cell.inputValue(),'Synthetic iPad argument');
      const bounds=await page.evaluate(()=>{
        const app=document.querySelector('#app').getBoundingClientRect();const flow=document.querySelector('.pmd-flow-root').getBoundingClientRect();
        return {app:{x:app.x,y:app.y,width:app.width,height:app.height},flow:{x:flow.x,y:flow.y,width:flow.width,height:flow.height},tablet:document.body.classList.contains('pmd-tablet-editing')};
      });
      assert.equal(bounds.tablet,true);assert.ok(Math.abs(bounds.app.width-bounds.flow.width)<4,JSON.stringify(bounds));assert.ok(bounds.flow.height>250,JSON.stringify(bounds));
      await page.getByRole('button',{name:'Menu',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Join co-editing',exact:true}).isVisible(),true);
      await page.getByRole('button',{name:'Menu',exact:true}).click();
      await page.screenshot({path:path.join(output,`flow-${width}.png`)});
      if(width===1024) {
        await page.getByRole('button',{name:'Download a document copy',exact:true}).click();
        const downloadPromise=page.waitForEvent('download');
        await page.locator('.pmd-save-as-dialog').getByRole('button',{name:'As-Is',exact:true}).click();
        const download=await downloadPromise;assert.ok(download.suggestedFilename().endsWith('.cmir'));
        const copy=path.join(output,'synthetic-flow.cmir');await download.saveAs(copy);assert.ok(fs.statSync(copy).size>0);
        await page.getByRole('button',{name:'Menu',exact:true}).click();
        const chooserPromise=page.waitForEvent('filechooser');await page.locator('.pmd-mobile-sheet').getByRole('button',{name:'Open…',exact:true}).click();
        const chooser=await chooserPromise;await chooser.setFiles(copy);
        await page.waitForFunction(()=>document.querySelector('textarea.pmd-flow-cell[data-row="0"][data-col="0"]')?.value==='Synthetic iPad argument');
        console.log('WebKit save/download/reopen round trip passed.');

      }
      assert.deepEqual(errors,[]);console.log(`WebKit tablet ${width}px: typing, immediate row navigation, Flow bounds and collaboration controls passed.`);
      await context.close();
    }
    // Two real browser contexts, an encrypted session and a local synthetic relay.
    const relayUrl = address + 'relay';
    const peer = async (host) => {
      const context = await browser.newContext({...devices['iPad Pro 11'], viewport:{width:1024,height:768}});
      await context.route('**/registerSW.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* Service-worker tests run separately in Chromium. */'}));
      await context.addInitScript(({url, token}) => {
        localStorage.setItem('pmd-settings',JSON.stringify({showOnboardingStarter:false,multiDocWorkspace:false,aiFeaturesEnabled:false,pairingRelayUrl:url,pairingRelayToken:token}));
        Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.syntheticClipboard=text;}}});
      },{url:relayUrl,token:host?relayMock.token:''});
      const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());page.on('pageerror',e=>console.log('Peer error:',e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('Peer console:',m.text().slice(0,300))});page.on('response',r=>{if(!r.ok())console.log('Peer HTTP:',r.status(),new URL(r.url()).pathname)});await page.addInitScript(()=>{window.syntheticToasts=[];document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{for(const el of document.querySelectorAll('.pmd-toast'))if(!window.syntheticToasts.includes(el.textContent))window.syntheticToasts.push(el.textContent)}).observe(document.body,{subtree:true,childList:true,characterData:true}));});return {context,page};
    };
    const host = await peer(true), guest = await peer(false);
    await host.page.goto(address);await host.page.getByRole('button',{name:/^New Flow/}).click();await host.page.getByRole('button',{name:'NPDA (parli)',exact:true}).click();
    await host.page.locator('textarea.pmd-flow-cell[data-row="0"][data-col="0"]').fill('Synthetic shared Flow');
    await host.page.getByRole('button',{name:'Menu',exact:true}).click();await host.page.getByRole('button',{name:'Start co-editing',exact:true}).click();
    await host.page.locator('.pmd-text-prompt-dialog').getByRole('button',{name:'Start Session',exact:true}).click();
    await host.page.waitForFunction(()=>window.syntheticClipboard?.includes('#join='),undefined,{timeout:15000});
    const invitation = await host.page.evaluate(()=>window.syntheticClipboard);
    await guest.page.goto(address + '#' + invitation.split('#')[1]);
    await guest.page.locator('.pmd-text-prompt-dialog').getByRole('button',{name:'Join Session',exact:true}).click();
    await guest.page.waitForFunction(()=>document.querySelector('textarea.pmd-flow-cell[data-row="0"][data-col="0"]')?.value==='Synthetic shared Flow',undefined,{timeout:15000}).catch(async error=>{console.log('Guest page diagnostic:',(await guest.page.locator('body').innerText()).slice(-1800),await guest.page.evaluate(()=>window.syntheticToasts));throw error});
    await guest.page.locator('textarea.pmd-flow-cell[data-row="1"][data-col="1"]').fill('Synthetic partner edit');
    await host.page.waitForFunction(()=>document.querySelector('textarea.pmd-flow-cell[data-row="1"][data-col="1"]')?.value==='Synthetic partner edit',undefined,{timeout:15000});
    await host.page.locator('textarea.pmd-flow-cell[data-row="2"][data-col="2"]').fill('Synthetic host reply');
    await guest.page.waitForFunction(()=>document.querySelector('textarea.pmd-flow-cell[data-row="2"][data-col="2"]')?.value==='Synthetic host reply',undefined,{timeout:15000});
    console.log('WebKit encrypted Flow co-editing passed in both directions, including account-less invitation join.');
    await host.context.close();await guest.context.close();
    const context=await browser.newContext({...devices['iPad Pro 11'],viewport:{width:1024,height:768}});
    await context.route('**/registerSW.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* Service-worker tests run separately in Chromium. */'}));
      await context.addInitScript(()=>localStorage.setItem('pmd-settings',JSON.stringify({showOnboardingStarter:false,multiDocWorkspace:false,aiFeaturesEnabled:false})));
    const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto(address);await page.getByRole('button',{name:/^New document/}).click();
    const editor=page.locator('#editor .ProseMirror');await editor.fill('Synthetic tablet document');
    await page.locator('.pmd-mobile-mode-read').click();assert.equal(await editor.getAttribute('contenteditable'),'false');
    await page.locator('.pmd-mobile-mode-edit').click();assert.equal(await editor.getAttribute('contenteditable'),'true');
    await page.locator('.pmd-mobile-mode-move').click();assert.equal(await editor.getAttribute('contenteditable'),'false');
    console.log('WebKit ordinary document Edit/Read/Move behavior passed.');await context.close();
  } finally { await browser.close();await relayMock?.close();server.close(); }
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
