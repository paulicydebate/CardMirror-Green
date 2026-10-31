/* Chromium checks the real service worker; WebKit's CacheStorage reload tests hang.
 * Fresh headless context, loopback server, synthetic drafts only. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const root = path.resolve('dist');
const watchdog = setTimeout(() => { console.error('PWA check timed out.'); process.exit(1); }, 120000);
watchdog.unref();
const server = http.createServer((req, res) => {
  let relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/CardMirror-Green\//, '');
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404).end(); return; }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': bytes.length }); res.end(bytes);
  });
});
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...devices['iPad Pro 11'], defaultBrowserType: undefined });
    await context.addInitScript(() => {
      if (!localStorage.getItem('pmd-settings')) localStorage.setItem('pmd-settings', JSON.stringify({ showOnboardingStarter: false, multiDocWorkspace: false, aiFeaturesEnabled: false }));
    });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') console.log('PWA console:', message.text()); });
    page.on('response', response => { if (!response.ok()) console.log('PWA HTTP:', response.status(), response.url()); });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/CardMirror-Green/`);
    console.log('PWA online shell loaded.');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    console.log('PWA service worker ready.');
    await page.reload();
    console.log('PWA online controlled reload completed.');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    console.log('PWA offline shell loaded.');
    await page.getByRole('button', { name: /^New Flow/ }).click();
    await page.getByRole('button', { name: 'NPDA (parli)', exact: true }).click();
    await page.locator('textarea.pmd-flow-cell[data-row="0"][data-col="0"]').fill('Synthetic offline recovered Flow');
    // Flow creation may already have journaled the initial blank workbook.
    // Wait for the normal three-second edit journal before simulating a restart.
    await page.waitForTimeout(4500);
    await page.waitForFunction(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('cardmirror'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = db.transaction('journals').objectStore('journals').getAll(); request.onsuccess = () => resolve(request.result.length > 0); request.onerror = () => reject(request.error); }); }
      finally { db.close(); }
    });
    await page.reload();
    const recovered = page.locator('textarea.pmd-flow-cell[data-row="0"][data-col="0"]');
    if (!await recovered.count()) await page.locator('.pmd-recovery-sidebar-row-btn-open').first().click();
    await page.waitForFunction(() => document.querySelector('textarea.pmd-flow-cell[data-row="0"][data-col="0"]')?.value === 'Synthetic offline recovered Flow');
    assert.equal(await page.locator('textarea.pmd-flow-cell[data-row="0"][data-col="0"]').inputValue(), 'Synthetic offline recovered Flow');
    console.log('Chromium real PWA offline reload, Flow editing and unsaved draft recovery passed.');
    await context.close();
  } finally { await browser.close(); server.close(); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
