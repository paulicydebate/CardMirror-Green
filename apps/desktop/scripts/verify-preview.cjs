// Fail CI before upload if packaging omitted a required runtime resource.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const release = path.join(__dirname, '..', 'release');
const arch = process.argv[2];
const config = require('../package.json').build;
assert.equal(config.appId, 'com.paulicydebate.cardmirror.green');
assert.equal(config.productName, 'CardMirror Green');
assert.equal(config.publish.owner, 'paulicydebate');
assert.equal(process.arch, arch, 'Preview must be built on its native architecture');
const mac = process.platform === 'darwin';
const app = mac ? path.join(release, 'mac-arm64', 'cardmirror-green.app') : path.join(release, 'win-unpacked');
const resources = mac ? path.join(app, 'Contents', 'Resources') : path.join(app, 'resources');
for (const file of ['app.asar', 'renderer/index.html', 'new-template.cmir']) {
  assert.ok(fs.statSync(path.join(resources, file)).size > 0, `Missing ${file}`);
}
const native = path.join(resources, 'app.asar.unpacked', 'node_modules', '@koromix', `koffi-${process.platform}-${arch}`, `${process.platform}_${arch}`, 'koffi.node');
assert.ok(fs.statSync(native).size > 0, 'Missing native Koffi module');
const asar = require('@electron/asar');
const packagedIcon = asar.extractFile(path.join(resources, 'app.asar'), 'build/green.png');
const digest = data => createHash('sha256').update(data).digest('hex');
assert.equal(digest(packagedIcon), digest(fs.readFileSync(path.join(__dirname, '..', 'build', 'green.png'))));
if (mac) {
  const bundleId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
  assert.equal(bundleId, config.appId);
  const executable = path.join(app, 'Contents', 'MacOS', 'cardmirror-green');
  const arches = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim();
  assert.equal(arches, 'arm64');
  assert.ok(fs.statSync(path.join(resources, 'native', 'ax-suppress.dylib')).size > 0);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
} else {
  const exe = fs.readFileSync(path.join(app, 'cardmirror-green.exe'));
  const pe = exe.readUInt32LE(0x3c);
  assert.equal(exe.readUInt16LE(pe + 4), 0x8664, 'Expected Windows x64 executable');
}
for (const ext of mac ? ['.dmg', '.zip'] : ['.exe']) {
  assert.ok(fs.readdirSync(release).some(file => file.endsWith(ext) && fs.statSync(path.join(release, file)).size > 0), `Missing ${ext} installer`);
}
console.log(`Verified ${process.platform} ${arch} preview resources, native module and installers`);
