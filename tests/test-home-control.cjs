'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-control-'));
let chosen = null;
const relay = [];
const control = require('../app/home-control.js')(
  fs, dir, (on) => relay.push(on ? 'E' : 'D'), () => {}, () => chosen !== null
);
// No app chosen: relay gets D, so Home goes to LG Home.
assert.strictEqual(control.enabled(), false);
control.sync();
assert.deepStrictEqual(relay, []); // already off, nothing to send
chosen = 'com.plexapp.plex';
assert.strictEqual(control.sync(), true);
assert.deepStrictEqual(relay, ['E']);
control.sync();
assert.deepStrictEqual(relay, ['E']); // no repeats
chosen = null; // picked LG Home again
assert.strictEqual(control.sync(), false);
assert.deepStrictEqual(relay, ['E', 'D']);
// A stored "off" preference wins even with an app chosen.
fs.writeFileSync(path.join(dir, 'home-control.json'), '{"enabled":false}');
chosen = 'com.plexapp.plex';
const off = require('../app/home-control.js')(fs, dir, () => {}, () => {}, () => true);
assert.strictEqual(off.enabled(), false);
fs.rmSync(dir, { recursive: true });
console.log('home control ok');
