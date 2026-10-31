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
  const browser=await (process.env.PREP_CHROMIUM ? require('playwright').chromium : webkit).launch({headless:true});
  try {
    if (!process.env.PREP_ONLY) {
    for(const width of [1024,1366,600]) {
      const context=await browser.newContext({...devices['iPad Pro 11'], viewport:{width,height:768},acceptDownloads:true});
      await context.route('**/registerSW.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* Service-worker tests run separately in Chromium. */'}));
      await context.addInitScript(()=>{
        if(!localStorage.getItem('pmd-settings')) localStorage.setItem('pmd-settings',JSON.stringify({showOnboardingStarter:false,multiDocWorkspace:false,aiFeaturesEnabled:false,pairingPartners:[{name:'Alex',code:'cmk1.synthetic-alex'},{name:'Jordan',code:'cmk1.synthetic-jordan'}]}));
      });
      const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());const pending=new Set();page.on('request',r=>pending.add(r.url()));page.on('requestfinished',r=>pending.delete(r.url()));page.on('requestfailed',r=>{pending.delete(r.url());console.log('Request failed:',r.url(),r.failure()?.errorText)});page.on('console',m=>{if(m.type()==='error')console.log('Browser console:',m.text())});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Page error:',e.message)});
      await page.goto(address);
      await page.getByRole('button',{name:/^New Flow/}).click();
      await page.getByRole('button',{name:'NPDA (parli)',exact:true}).click();
      const cell=page.locator('textarea.pmd-flow-cell[data-row="0"][data-col="0"]');
      await cell.fill('Synthetic iPad argument');await cell.press('Enter');
      assert.equal(await page.locator('textarea.pmd-flow-cell[data-row="1"][data-col="0"]').evaluate(el=>el===document.activeElement),true);
      assert.equal(await cell.inputValue(),'Synthetic iPad argument');
      if(width===1366) {
        const flowCell=(row,col=0)=>page.locator(`textarea.pmd-flow-cell[data-row="${row}"][data-col="${col}"]`);
        for(let row=1;row<=3;row++)await flowCell(row).fill(`Clear argument ${row}`);
        await flowCell(2,1).fill('Keep adjacent argument');
        const first=await flowCell(1).boundingBox(),last=await flowCell(3).boundingBox();
        await page.mouse.move(first.x+12,first.y+10);await page.mouse.down();
        await page.mouse.move(last.x+12,last.y+10,{steps:12});await page.mouse.up();
        assert.equal(await page.locator('td[aria-selected="true"]').count(),3);
        await page.keyboard.press('Backspace');
        for(let row=1;row<=3;row++)assert.equal(await flowCell(row).inputValue(),'');
        assert.equal(await flowCell(2,1).inputValue(),'Keep adjacent argument');
        assert.equal(await cell.inputValue(),'Synthetic iPad argument');
        console.log('Mouse drag range and Backspace cleared only the selected cells.');
        const start=await cell.boundingBox(),grid=await page.locator('.pmd-flow-gridwrap').boundingBox();
        await page.mouse.move(start.x+12,start.y+10);await page.mouse.down();
        await page.mouse.move(start.x+12,grid.y+grid.height+20,{steps:12});
        await page.waitForFunction(()=>document.querySelector('.pmd-flow-gridwrap').scrollTop>40);
        await page.mouse.up();
        assert.ok(await page.locator('td[aria-selected="true"]').count()>5);
        await page.locator('.pmd-flow-gridwrap').evaluate(el=>{el.scrollTop=0;});
        await cell.click();
        console.log('Mouse range selection scrolls beyond the visible grid and stops on release.');
      }
      const bounds=await page.evaluate(()=>{
        const app=document.querySelector('#app').getBoundingClientRect();const flow=document.querySelector('.pmd-flow-root').getBoundingClientRect();
        return {app:{x:app.x,y:app.y,width:app.width,height:app.height},flow:{x:flow.x,y:flow.y,width:flow.width,height:flow.height},tablet:document.body.classList.contains('pmd-tablet-editing')};
      });
      assert.equal(bounds.tablet,true);assert.ok(Math.abs(bounds.app.width-bounds.flow.width)<4,JSON.stringify(bounds));assert.ok(bounds.flow.height>250,JSON.stringify(bounds));
      await page.getByRole('button',{name:'Menu',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Join co-editing',exact:true}).isVisible(),true);
      await page.getByRole('button',{name:'Collaboration…',exact:true}).click();
      const collaboration=page.locator('.pmd-collaboration-panel');
      await collaboration.getByRole('tab',{name:'People',exact:true}).waitFor();
      await collaboration.getByRole('button',{name:'Make Jordan your default partner',exact:true}).click();
      assert.equal(await collaboration.getByRole('button',{name:'Co-edit with Jordan',exact:true}).isVisible(),true);
      const dock=await page.evaluate(()=>{const app=document.querySelector('#app').getBoundingClientRect(),panel=document.querySelector('.pmd-collaboration-panel').getBoundingClientRect();return {app:{right:app.right,bottom:app.bottom},panel:{left:panel.left,top:panel.top},width:innerWidth};});
      if(width>760)assert.ok(Math.abs(dock.app.right-dock.panel.left)<3,JSON.stringify(dock));
      else assert.ok(dock.app.bottom<=dock.panel.top+3,JSON.stringify(dock));
      await collaboration.getByRole('tab',{name:'Invitations',exact:true}).click();
      assert.ok((await collaboration.innerText()).includes('No pending invitations'));
      await collaboration.getByRole('tab',{name:'Shared docs',exact:true}).click();
      await collaboration.getByRole('tab',{name:'People',exact:true}).click();
      await page.screenshot({path:path.join(output,`collaboration-panel-${width}.png`)});
      await collaboration.getByRole('button',{name:'Close',exact:true}).click();
      assert.equal(await cell.inputValue(),'Synthetic iPad argument');
      console.log(`WebKit collaboration panel ${width}px: real default-partner controls, tabs and document clearance passed.`);
      await page.getByRole('button',{name:'Menu',exact:true}).click();
      await page.getByRole('button',{name:'Menu',exact:true}).click();
      await page.screenshot({path:path.join(output,`flow-${width}.png`)});
      if(width===1024 && !process.env.PANEL_ONLY) {
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
    if(process.env.PANEL_ONLY) {
      const desktop=await browser.newContext({viewport:{width:1366,height:900}});
      await desktop.route('**/registerSW.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* Offline checked separately. */'}));
      await desktop.addInitScript(()=>localStorage.setItem('pmd-settings',JSON.stringify({showOnboardingStarter:false,multiDocWorkspace:false,aiFeaturesEnabled:false})));
      const page=await desktop.newPage();await page.goto(address);
      await page.getByRole('button',{name:/^New document/}).click();
      await page.locator('#editor .ProseMirror').fill('Synthetic desktop collaboration layout');
      await page.getByRole('button',{name:'Collaboration',exact:true}).click();
      await page.locator('.pmd-collaboration-panel').waitFor({state:'visible'});
      assert.equal(await page.locator('.pmd-collaboration-panel').isVisible(),true);
      for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:path.join(output,`collaboration-desktop-${theme}.png`)});}
      const bounds=await page.evaluate(()=>({editor:document.querySelector('#app').getBoundingClientRect().right,panel:document.querySelector('.pmd-collaboration-panel').getBoundingClientRect().left}));assert.ok(Math.abs(bounds.editor-bounds.panel)<3,JSON.stringify(bounds));
      console.log('WebKit desktop Collaboration launcher and dock clearance passed in both themes.');
      await desktop.close();return;
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
    }
    const prepContext = await browser.newContext({...devices['iPad Pro 11'],viewport:{width:1024,height:768},acceptDownloads:true});
    await prepContext.route('**/registerSW.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* Offline PWA tested separately. */'}));
    await prepContext.addInitScript(()=>{
      localStorage.setItem('pmd-settings',JSON.stringify({showOnboardingStarter:false,multiDocWorkspace:false,aiFeaturesEnabled:false}));
      // Exercise Safari's download/input path, including in Chromium's restart test.
      Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
      Object.defineProperty(window,'showOpenFilePicker',{configurable:true,value:undefined});
    });
    const prepPage=await prepContext.newPage();prepPage.on('dialog',dialog=>dialog.accept());
    prepPage.on('console',m=>console.log('Prep console:',m.text()));prepPage.on('pageerror',e=>console.log('Prep page error:',e.message));
    await prepPage.goto(address);
    await prepPage.getByRole('button',{name:/^New document/}).click();
    const menuAction=async name=>{await prepPage.getByRole('button',{name:'Menu',exact:true}).click();await prepPage.locator('.pmd-mobile-sheet').getByRole('button',{name,exact:true}).click();};
    await menuAction('Start Prep');await prepPage.getByRole('button',{name:'Start Prep',exact:true}).click();
    await menuAction('New prep flow');
    const prepCell=prepPage.locator('textarea.pmd-flow-cell[data-row="0"][data-col="0"]');
    await prepCell.pressSequentially('Typed on tablet');
    const blocked=await prepCell.evaluate(el=>{const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true});el.dispatchEvent(event);return event.defaultPrevented;});
    assert.equal(blocked,true);assert.equal(await prepCell.inputValue(),'Typed on tablet');
    console.log('Tablet Prep input/paste checks passed.');
    await prepPage.waitForTimeout(4500);
    // Windows Playwright WebKit also stalls on a blank-app reload with the
    // Prep owner disabled. Chromium checks restart; WebKit checks live UI.
    if (process.env.PREP_CHROMIUM) await prepPage.reload();
    await prepPage.waitForFunction(()=>document.querySelector('textarea.pmd-flow-cell[data-row="0"][data-col="0"]')?.value==='Typed on tablet');
    assert.equal(await prepPage.locator('.pmd-prep-bar').getAttribute('data-mode'),'prep');
    if (process.env.PREP_CHROMIUM) {
      const second=await prepContext.newPage();await second.goto(address);
      await second.waitForFunction(()=>document.body.classList.contains('pmd-prep-paused'));
      await second.close();
    }
    await menuAction('Round checklist…');
    assert.ok((await prepPage.locator('.pmd-text-prompt-dialog').innerText()).includes('Keep protected:'));
    await prepPage.getByRole('button',{name:'Start Round',exact:true}).click();
    await prepPage.waitForFunction(()=>document.body.classList.contains('pmd-round-mode'));
    let openedChooser=false;prepPage.on('filechooser',()=>{openedChooser=true;});
    await menuAction('Open…');await prepPage.waitForTimeout(200);assert.equal(openedChooser,false);
    await menuAction('Typing logs');await prepPage.getByRole('button',{name:'View',exact:true}).first().click();
    await prepPage.getByText('Paste blocked',{exact:true}).waitFor();
    const timelineText=await prepPage.locator('.pmd-prep-timeline').innerText();console.log('Tablet timeline:',timelineText.slice(0,1800));
    assert.ok(timelineText.includes('Typed on tablet'),timelineText);
    const logDownload=prepPage.waitForEvent('download');await prepPage.getByRole('button',{name:'Export readable',exact:true}).first().click();
    const reportDownload=await logDownload;const reportPath=path.join(output,'synthetic-prep-report.txt');await reportDownload.saveAs(reportPath);
    assert.ok(fs.readFileSync(reportPath,'utf8').includes('Paste blocked'));
    await prepPage.locator('.pmd-prep-log-panel').getByRole('button',{name:'Close',exact:true}).click();
    await menuAction('End Prep / Round session');await prepPage.getByRole('button',{name:'End Session',exact:true}).click();
    await prepPage.getByText(/Seal code:/).waitFor();
    if (process.env.PREP_CHROMIUM) {
      const code=(await prepPage.locator('.pmd-text-prompt-dialog').innerText()).match(/Seal code: ([A-F0-9-]+)/)[1];
      await prepPage.locator('.pmd-text-prompt-dialog').getByRole('button',{name:'OK',exact:true}).click();
      await prepPage.getByRole('button',{name:'Download a document copy',exact:true}).click();
      const saved=prepPage.waitForEvent('download');await prepPage.locator('.pmd-save-as-dialog').getByRole('button',{name:'As-Is',exact:true}).click();
      const file=path.join(output,'synthetic-sealed-prep.cmir');await (await saved).saveAs(file);
      await prepPage.getByRole('button',{name:'Menu',exact:true}).click();
      const chosen=prepPage.waitForEvent('filechooser');await prepPage.locator('.pmd-mobile-sheet').getByRole('button',{name:'Open…',exact:true}).click();await (await chosen).setFiles(file);
      await prepPage.waitForFunction(()=>document.querySelector('textarea.pmd-flow-cell[data-row="0"][data-col="0"]')?.value==='Typed on tablet');
      await menuAction('Check prep document');await prepPage.locator('.pmd-text-prompt-dialog input').fill(code);
      await prepPage.getByRole('button',{name:'Check',exact:true}).click();
      await prepPage.getByText('Unchanged since the round',{exact:true}).waitFor();
      console.log('Browser seal survived native download/reopen and Check Prep Document.');
    }
    console.log(`${process.env.PREP_CHROMIUM ? 'Chromium (including durable restart and single-workspace lock)' : 'WebKit'} tablet Prep: typing/paste guards, Round checklist/file refusal and readable log download passed.`);
    await prepContext.close();
  } finally { await browser.close();await relayMock?.close();server.close(); }
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
