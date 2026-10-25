// Fail CI before upload if packaging omitted a required runtime resource.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const release = path.join(__dirname, '..', 'release');
const arch = process.argv[2];
assert.equal(process.arch, arch, 'Preview must be built on its native architecture');
const mac = process.platform === 'darwin';
const app = mac ? path.join(release, 'mac-arm64', 'cardmirror.app') : path.join(release, 'win-unpacked');
const resources = mac ? path.join(app, 'Contents', 'Resources') : path.join(app, 'resources');
for (const file of ['app.asar', 'renderer/index.html', 'new-template.cmir']) {
  assert.ok(fs.statSync(path.join(resources, file)).size > 0, `Missing ${file}`);
}
const native = path.join(resources, 'app.asar.unpacked', 'node_modules', '@koromix', `koffi-${process.platform}-${arch}`, `${process.platform}_${arch}`, 'koffi.node');
assert.ok(fs.statSync(native).size > 0, 'Missing native Koffi module');
if (mac) {
  const executable = path.join(app, 'Contents', 'MacOS', 'cardmirror');
  const arches = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim();
  assert.equal(arches, 'arm64');
  assert.ok(fs.statSync(path.join(resources, 'native', 'ax-suppress.dylib')).size > 0);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
} else {
  const exe = fs.readFileSync(path.join(app, 'cardmirror.exe'));
  const pe = exe.readUInt32LE(0x3c);
  assert.equal(exe.readUInt16LE(pe + 4), 0x8664, 'Expected Windows x64 executable');
}
for (const ext of mac ? ['.dmg', '.zip'] : ['.exe']) {
  assert.ok(fs.readdirSync(release).some(file => file.endsWith(ext) && fs.statSync(path.join(release, file)).size > 0), `Missing ${ext} installer`);
}
console.log(`Verified ${process.platform} ${arch} preview resources, native module and installers`);
