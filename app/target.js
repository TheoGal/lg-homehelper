'use strict';
// Which app the Home button opens.
// Order: choice made on the TV (state/target.json), then the default packaged
// on a PC before install (target.json next to this file). With neither,
// the result is null and the Home button keeps going to LG Home.
var fs = require('fs');
// Never route Home to LG Home (loop) or to the Helper itself.
var RESERVED = [
  'com.webos.app.home',
  'io.github.theogal.homehelper',
  'com.webos.app.cpcover'
];
function valid(id) {
  return (
    typeof id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) &&
    RESERVED.indexOf(id) < 0
  );
}
// Choosing LG Home explicitly is saved as its id; it means "do not redirect"
// and also overrides a packaged default.
var LG_HOME = 'com.webos.app.home';
function readId(path) {
  try {
    var value = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (value && value.id === LG_HOME) return LG_HOME;
    return value && valid(value.id) ? value.id : null;
  } catch (e) {
    return null;
  }
}
function resolve(directory) {
  var dir = directory || __dirname,
    tv = readId(dir + '/state/target.json');
  if (tv) return { id: tv === LG_HOME ? null : tv, source: 'tv' };
  var packaged = readId(dir + '/target.json');
  if (packaged && packaged !== LG_HOME)
    return { id: packaged, source: 'packaged' };
  return { id: null, source: 'none' };
}
var cached,
  checkedAt = 0;
// Cheap enough to call per event: re-read at most once per second.
function get() {
  var now = Date.now();
  if (cached === undefined || now - checkedAt > 1000 || now < checkedAt) {
    cached = resolve().id;
    checkedAt = now;
  }
  return cached;
}
get.valid = valid;
get.LG_HOME = LG_HOME;
get.resolve = resolve;
get.refresh = function () {
  cached = undefined;
  return get();
};
module.exports = get;
