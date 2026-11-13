'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const target = require('../app/target.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-target-'));
fs.mkdirSync(path.join(dir, 'state'));
const write = (name, value) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

// Nothing chosen: no target, Home stays with LG Home.
assert.deepStrictEqual(target.resolve(dir), { id: null, source: 'none' });
write('target.json', { id: 'com.plexapp.plex' });
assert.deepStrictEqual(target.resolve(dir), { id: 'com.plexapp.plex', source: 'packaged' });
write('state/target.json', { id: 'org.jellyfin.webos' });
assert.deepStrictEqual(target.resolve(dir), { id: 'org.jellyfin.webos', source: 'tv' });
// Choosing LG Home on the TV overrides the packaged default.
write('state/target.json', { id: 'com.webos.app.home' });
assert.deepStrictEqual(target.resolve(dir), { id: null, source: 'tv' });
// Malformed or reserved ids fall back to the packaged default.
for (const bad of ['io.github.theogal.homehelper', '../x', '', 42]) {
  write('state/target.json', { id: bad });
  assert.strictEqual(target.resolve(dir).source, 'packaged', String(bad));
}
fs.writeFileSync(path.join(dir, 'state/target.json'), 'not json');
assert.strictEqual(target.resolve(dir).id, 'com.plexapp.plex');
fs.unlinkSync(path.join(dir, 'state/target.json'));
fs.unlinkSync(path.join(dir, 'target.json'));
assert.strictEqual(target.resolve(dir).id, null);
assert.ok(target.valid('com.example.app-2_x'));
assert.ok(!target.valid('com.webos.app.home'));
fs.rmSync(dir, { recursive: true });
console.log('home target ok');
