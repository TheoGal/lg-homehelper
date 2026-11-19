'use strict';
// LG Home after a watched app means "that app was closed": go back to the
// chosen app. Never when the app left behind is the chosen app itself or Home
// Helper's own, even if the watch list was made for an older choice.
const assert = require('node:assert/strict');
const path = require('node:path');

let chosen = 'tld.hearth';
const targetPath = require.resolve('../app/target');
require.cache[targetPath] = { id: targetPath, filename: targetPath, loaded: true, exports: () => chosen };
const policy = require('../app/screen-policy');

// Made while "netflix" was chosen, so Hearth is still on the list.
const watched = ['tld.hearth', 'youtube', 'io.github.theogal.homehelper.settings'];
const p = policy(watched);
const HOME = 'com.webos.app.home';
let t = 1000;
function from(app) {
  p.next(app, (t += 100));
  return p.next(HOME, (t += 100));
}

assert.equal(from('youtube'), true, 'closing a watched app returns to the chosen one');
assert.equal(from('tld.hearth'), false, 'leaving the chosen app for LG Home stays there');
assert.equal(from('io.github.theogal.homehelper.settings'), false, 'Open LG Home from settings stays there');
chosen = 'youtube';
assert.equal(from('youtube'), false, 'the newly chosen app counts too');
assert.equal(from('tld.hearth'), true, 'the old choice is an ordinary app again');
console.log('ok screen policy');
