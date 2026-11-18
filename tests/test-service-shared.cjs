'use strict';
// The service only reads its own folder (its sandbox cannot see the app's):
// the helper's status, the TV's choice, the pairing status and the app list.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const files = new Map();
let now = 1000000;
const methods = {};
const fakefs = {
  readFileSync(p) {
    if (p === '/proc/sys/kernel/random/boot_id') return 'boot';
    if (p === '/proc/stat') return 'btime 1';
    if (files.has(p)) return files.get(p);
    throw Object.assign(Error('missing'), { code: 'ENOENT' });
  },
  // The app's folder does not exist from inside the sandbox.
  statSync() {
    throw Object.assign(Error('missing'), { code: 'ENOENT' });
  },
  readFile(p, cb) {
    if (files.has(p)) cb(null, files.get(p));
    else cb(Object.assign(Error('missing'), { code: 'ENOENT' }));
  },
  writeFileSync() {}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../settings-service/service.js'), 'utf8'), {
  console,
  Date: { now: () => now },
  __dirname: '/service',
  require(n) {
    if (n === 'fs') return fakefs;
    if (n === 'webos-service')
      return class {
        constructor() {
          this.register = (m, f) => (methods[m] = f);
          this.call = (u, a, cb) => cb({ payload: { returnValue: true } });
        }
      };
    if (n === './boot-state') return { identity: () => 'boot', claim() {} };
    if (n === './state-permissions') return Object.assign(() => true, { atomicRecord() {} });
    throw Error(n);
  }
});
const shared = (name, value) => files.set('/service/state/' + name, JSON.stringify(value));
const ask = (method) => new Promise((resolve) => methods[method]({ respond: (r) => resolve(JSON.parse(JSON.stringify(r))) }));

(async () => {
  // Nothing published yet: not running, nothing chosen, not paired, no list.
  let r = await ask('target');
  assert.equal(r.running, false);
  assert.deepEqual(r.target, { id: null, source: 'none', packaged: null });
  assert.equal(r.pairing.paired, false);
  assert.equal((await ask('listApps')).returnValue, false);

  // A pairing that has just finished counts before the helper reports it.
  shared('pair-status.json', { state: 'paired', time: now });
  assert.equal((await ask('target')).pairing.paired, true);

  // The running helper's status.
  shared('helper.json', { time: now, running: true, paired: true, target: { id: null }, packaged: 'com.plexapp.plex' });
  shared('target.json', { id: 'tld.my.customlauncher' });
  shared('app-list.json', { time: now, apps: [{ id: 'tld.my.customlauncher', title: 'Hearth' }] });
  r = await ask('target');
  assert.equal(r.running, true);
  assert.equal(r.pairing.paired, true);
  assert.deepEqual(r.target, { id: 'tld.my.customlauncher', source: 'tv', packaged: 'com.plexapp.plex' });
  const list = await ask('listApps');
  assert.equal(list.returnValue, true);
  assert.equal(list.apps[0].title, 'Hearth');

  // LG Home chosen on the TV: no redirect, even with a packaged default.
  shared('target.json', { id: 'com.webos.app.home' });
  assert.deepEqual((await ask('target')).target, { id: null, source: 'tv', packaged: 'com.plexapp.plex' });

  // A crashed helper cannot clean up: an old status means not running.
  now += 80000;
  assert.equal((await ask('target')).running, false, 'stale status is not running');

  // Stopped cleanly: not running, still paired.
  shared('helper.json', { time: now, running: false, paired: true, target: { id: null }, packaged: null });
  r = await ask('target');
  assert.equal(r.running, false);
  assert.equal(r.pairing.paired, true);

  // Pairing rejected: the helper reports it gone, an old "paired" no longer counts.
  shared('pair-status.json', { state: 'paired', time: now - 5000 });
  shared('helper.json', { time: now, running: false, paired: false, target: { id: null }, packaged: null });
  assert.equal((await ask('target')).pairing.paired, false);
  console.log('service shared folder ok');
})();

(async () => {
  const askWith = (method, payload) => new Promise((resolve) => methods[method]({ payload, respond: (r) => resolve(JSON.parse(JSON.stringify(r))) }));
  const name = 'icon-' + 'a'.repeat(40);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(8, 1)]);
  files.set('/service/state/' + name, png);
  let r = await askWith('icon', { name });
  assert.equal(r.data, 'data:image/png;base64,' + png.toString('base64'), 'kept icon handed over');
  r = await askWith('icon', { name: '../../app-list.json' });
  assert.equal(r.returnValue, false, 'only icon files');
  files.set('/service/state/icon-' + 'b'.repeat(40), Buffer.from('<html>nope</html>'));
  r = await askWith('icon', { name: 'icon-' + 'b'.repeat(40) });
  assert.equal(r.returnValue, false, 'only pictures');
  console.log('ok icon method');
})();

(async () => {
  const askWith = (method) => new Promise((resolve) => methods[method]({ payload: {}, respond: (r) => resolve(JSON.parse(JSON.stringify(r))) }));
  files.set('/service/state/buttons.json', JSON.stringify({ 1300: 'netflix', abc: 'x', 1400: '../bad' }));
  files.set('/service/state/learn.json', JSON.stringify({ state: 'learned', time: 5, code: 1300 }));
  let r = await askWith('buttons');
  assert.deepEqual(r.buttons, [{ code: 1300, app: 'netflix' }], 'only valid buttons');
  files.set('/service/state/button-names.json', JSON.stringify({ 1300: 'Alexa', 1400: 'Bad' }));
  r = await askWith('buttons');
  assert.deepEqual(r.buttons, [{ code: 1300, app: 'netflix', name: 'Alexa' }], 'with its name');
  assert.deepEqual(r.learn, { state: 'learned', time: 5, code: 1300 });
  console.log('ok buttons method');
})();
