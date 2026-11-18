'use strict';
// App buttons: which app each learned button opens, and the learning state.
// Both live next to the app list (app/shared.js) so the settings page's
// service can read them:
//   buttons.json  { "<code>": "<app id>", ... }
//   button-names.json  { "<code>": "<name the user gave it>", ... }
//   learn.json    { state: requested|listening|learned|cancelled|timeout,
//                   time, code? }
// The relay never learns or maps Home, Back, OK, arrows, pointer, volume,
// channel, number keys, the coloured keys or power; the same list is kept here
// so nothing else can be saved either.
var shared = require('./shared');

var MAX = 16;
var BLOCKED = [0, 1, 773, 412, 1198, 1199, 28, 352, 103, 105, 106, 108, 113, 114, 115, 116, 402, 403];

function learnable(code) {
  return (
    typeof code === 'number' &&
    Math.floor(code) === code &&
    code > 0 &&
    code < 4096 &&
    !(code >= 2 && code <= 11) &&
    !(code >= 512 && code <= 521) &&
    !(code >= 398 && code <= 401) &&
    !(code >= 272 && code <= 287) &&
    BLOCKED.indexOf(code) < 0
  );
}
function validName(name) {
  return typeof name === 'string' && name.length <= 40 && !/[\u0000-\u001f\u007f]/.test(name);
}
function validApp(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);
}

function read(directory) {
  var raw = shared.read('buttons.json', directory),
    out = {},
    count = 0;
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    Object.keys(raw)
      .sort()
      .forEach(function (k) {
        var code = Number(k);
        if (count < MAX && /^[0-9]{1,4}$/.test(k) && learnable(code) && validApp(raw[k])) {
          out[code] = raw[k];
          count++;
        }
      });
  return out;
}

// Names outlive the mapping: a forgotten button that is learned again comes
// back with the name it was given.
var MAX_NAMES = 64;
function names(directory) {
  var raw = shared.read('button-names.json', directory),
    out = {},
    count = 0;
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    Object.keys(raw)
      .sort()
      .forEach(function (k) {
        var n = typeof raw[k] === 'string' ? raw[k].trim() : '';
        if (count < MAX_NAMES && /^[0-9]{1,4}$/.test(k) && learnable(Number(k)) && n && validName(n)) {
          out[k] = n;
          count++;
        }
      });
  return out;
}

// app '' removes the button (its name is kept).
function set(code, app, directory) {
  if (!learnable(code) || (app !== '' && !validApp(app))) return false;
  var map = read(directory);
  if (app === '') delete map[code];
  else {
    if (!map[code] && Object.keys(map).length >= MAX) return false;
    map[code] = app;
  }
  return shared.write('buttons.json', map, directory);
}

// Only a mapped button can have a name; '' gives it back its number.
function setName(code, name, directory) {
  if (typeof name !== 'string') return false;
  name = name.trim();
  if (!learnable(code) || !validName(name) || !read(directory)[code]) return false;
  var n = names(directory);
  if (name) {
    if (n[code] === undefined && Object.keys(n).length >= MAX_NAMES) return false;
    n[code] = name;
  } else delete n[code];
  return shared.write('button-names.json', n, directory);
}

// What the relay needs: C clears, then M and four digits per mapped code.
function relayCommands(map) {
  return (
    'C' +
    Object.keys(map)
      .map(function (k) {
        return 'M' + ('0000' + k).slice(-4);
      })
      .join('')
  );
}

function learnState(directory) {
  var s = shared.read('learn.json', directory);
  return s && typeof s === 'object' && typeof s.state === 'string' ? s : null;
}
function setLearn(state, directory, code) {
  var s = { state: state, time: Date.now() };
  if (code !== undefined) s.code = code;
  return shared.write('learn.json', s, directory);
}

module.exports = {
  MAX: MAX,
  learnable: learnable,
  read: read,
  set: set,
  names: names,
  setName: setName,
  relayCommands: relayCommands,
  learnState: learnState,
  setLearn: setLearn
};
