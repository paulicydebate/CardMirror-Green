const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const config = require('../package.json');
const release = path.join(root, 'release');
const feed = yaml.load(fs.readFileSync(path.join(release, 'latest-mac.yml'), 'utf8'));
assert.equal(feed.version, config.version);
for (const ext of ['zip', 'dmg']) {
  const expected = `CardMirror-Green-${config.version}-arm64.${ext}`;
  const file = feed.files.find(f => f.url === expected);
  assert.ok(file, `Missing ${ext} in Mac update metadata`);
  const bytes = fs.readFileSync(path.join(release, expected));
  assert.equal(file.sha512, createHash('sha512').update(bytes).digest('base64'));
  assert.equal(file.size, bytes.length);
}
const resources = path.join(release, 'mac-arm64', 'cardmirror-green.app', 'Contents', 'Resources');
const provider = yaml.load(fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8'));
assert.equal(provider.provider, 'github');
assert.equal(provider.owner, 'paulicydebate');
assert.equal(provider.repo, 'CardMirror-Green');
const app = path.dirname(resources);
const plist = path.join(app, 'Info.plist');
assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], {encoding:'utf8'}).trim(), config.version);
execFileSync('codesign', ['--verify', '--deep', '--strict', path.dirname(app)], {stdio:'inherit'});
console.log('Verified Mac Green provider, version, ZIP/DMG hashes and code signature integrity.');
