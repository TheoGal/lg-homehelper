'use strict';
// No pairing, no helper: the entry point only starts the controller when a
// pairing key is saved. A requested start without a key pairs first (here the
// TV cannot be reached, so it fails and nothing starts); a boot start without
// a key does nothing at all.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const app = path.join(__dirname, '../app');
const ROOT = '/media/developer/apps/usr/palm/applications/io.github.theogal.homehelper';
const SHARED = '/media/developer/apps/usr/palm/services/io.github.theogal.homehelper.settings.service/state';

function run(withKey, params) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-entry-'));
  for (const name of fs.readdirSync(app)) {
    if (name.endsWith('.js')) {
      fs.writeFileSync(path.join(dir, name), fs.readFileSync(path.join(app, name), 'utf8').split(ROOT).join(dir).split(SHARED).join(dir + '/shared'));
    }
  }
  fs.cpSync(path.join(app, 'vendor'), path.join(dir, 'vendor'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state'));
  fs.mkdirSync(path.join(dir, 'shared'));
  // Fake controller launcher: records that it was started.
  fs.writeFileSync(path.join(dir, 'detach'), '#!/bin/sh\ntouch "$(dirname "$0")/started"\n', { mode: 0o755 });
  if (withKey) fs.writeFileSync(path.join(dir, 'state/ssap-key.json'), '{"key":"saved"}');
  // Point the pairing attempt at a port nothing listens on, so it fails fast.
  const pair = path.join(dir, 'pair.js');
  fs.writeFileSync(pair, fs.readFileSync(pair, 'utf8').replace("':3001'", "':9'"));
  const r = spawnSync(process.execPath, [path.join(dir, 'helper-entry.js'), JSON.stringify(params)], { timeout: 20000 });
  spawnSync('sleep', ['0.3']);
  const sharedJson = (n) => (fs.existsSync(path.join(dir, 'shared', n)) ? JSON.parse(fs.readFileSync(path.join(dir, 'shared', n), 'utf8')) : null);
  const result = {
    exit: r.status,
    buttons: sharedJson('buttons.json'),
    learn: sharedJson('learn.json'),
    started: fs.existsSync(path.join(dir, 'started')),
    pairStatus: fs.existsSync(path.join(dir, 'shared/pair-status.json'))
      ? JSON.parse(fs.readFileSync(path.join(dir, 'shared/pair-status.json'), 'utf8')).state
      : null
  };
  fs.rmSync(dir, { recursive: true });
  return result;
}

let r = run(false, { nativeHomeAuto: true });
assert.equal(r.started, false, 'boot without a key: not started');
assert.equal(r.pairStatus, null, 'boot without a key: no pairing attempt');

r = run(false, { nativeHomeStart: true });
assert.equal(r.started, false, 'Start, pairing failed: not started');
assert.equal(r.pairStatus, 'failed', 'Start without a key: asks the TV first');
assert.equal(r.exit, 1);

r = run(true, { nativeHomeStart: true });
assert.equal(r.started, true, 'Start with a saved key: started');
assert.equal(r.pairStatus, null, 'Start with a saved key: no prompt');

r = run(true, { nativeHomeAuto: true });
assert.equal(r.started, true, 'boot with a saved key: started');

// Remote buttons from the settings app: saved for the running controller, and
// nothing is started.
r = run(true, { nativeHomeLearn: true });
assert.equal(r.learn.state, 'requested');
assert.equal(r.exit, 0);
assert.equal(r.started, false, 'learning does not start anything');
r = run(true, { nativeHomeButton: { code: 1300, app: 'netflix' } });
assert.deepEqual(r.buttons, { 1300: 'netflix' });
assert.equal(r.started, false);
r = run(true, { nativeHomeButton: { code: 773, app: 'netflix' } });
assert.equal(r.buttons, null, 'Home is never saved as a button');
assert.equal(r.exit, 1);
console.log('entry start rule ok');
