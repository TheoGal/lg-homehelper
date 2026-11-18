'use strict';
// Home Helper Settings' own service. webOS 26 only lets a web app call services
// from its own package, so the settings page cannot ask the helper's service.
// This one only reads what the helper publishes into its folder (see
// app/shared.js); it changes nothing. The page changes things by launching the
// helper with parameters.
var fs = require('fs'),
  Service = require('webos-service');
var service = new Service('io.github.theogal.homehelper.settings.service');
// The sandbox only sees this service's own folder. The helper (not sandboxed)
// writes here: the TV's choice, its status, the pairing status and the app
// list. Nothing secret: the pairing key stays with the helper.
var SHARED = __dirname + '/state';
var LG_HOME = 'com.webos.app.home';
function readShared(name) {
  try {
    return JSON.parse(fs.readFileSync(SHARED + '/' + name, 'utf8'));
  } catch (e) {
    return null;
  }
}
function validName(n) {
  return !!n && n.length <= 40 && !/[\u0000-\u001f\u007f]/.test(n);
}
function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);
}
// The running helper refreshes helper.json at least every 30 s.
function helperStatus() {
  var h = readShared('helper.json');
  return h && typeof h.time === 'number' ? h : null;
}
function running() {
  var h = helperStatus(),
    age = h ? Date.now() - h.time : Infinity;
  return !!(h && h.running === true && age >= -5000 && age < 75000);
}
// Mirrors app/target.js: the TV choice, then the default packaged on a PC
// (reported by the helper), then nothing (Home goes to LG Home).
function homeTarget() {
  var choice = readShared('target.json'),
    tv = choice && validId(choice.id) ? choice.id : null,
    h = helperStatus(),
    packaged = h && validId(h.packaged) && h.packaged !== LG_HOME ? h.packaged : null;
  if (tv) return { id: tv === LG_HOME ? null : tv, source: 'tv', packaged: packaged };
  return { id: packaged, source: packaged ? 'packaged' : 'none', packaged: packaged };
}
// Paired: as last reported by the helper, or a pairing that just finished.
function pairing() {
  var h = helperStatus(),
    status = readShared('pair-status.json'),
    justPaired =
      !!status &&
      (status.state === 'paired' || status.state === 'already-paired') &&
      (!h || status.time >= h.time);
  return { paired: !!(h && h.paired) || justPaired, status: status };
}
service.register('target', function (m) {
  m.respond({
    returnValue: true,
    target: homeTarget(),
    running: running(),
    pairing: pairing()
  });
});
service.register('listApps', function (message) {
  var list = readShared('app-list.json');
  if (list && Array.isArray(list.apps) && list.apps.length)
    message.respond({ returnValue: true, apps: list.apps, time: list.time });
  else message.respond({ returnValue: false, errorText: 'App list not ready yet' });
});

// One kept icon (see app/icon-cache.js), as a picture the page can show.
service.register('icon', function (message) {
  var name = message.payload && message.payload.name;
  if (typeof name !== 'string' || !/^icon-[0-9a-f]{40}$/.test(name))
    return message.respond({ returnValue: false, errorText: 'Unknown icon' });
  fs.readFile(SHARED + '/' + name, function (error, data) {
    var type = '';
    if (!error && data.length >= 12) {
      if (data.slice(0, 8).toString('hex') === '89504e470d0a1a0a') type = 'png';
      else if (data[0] === 255 && data[1] === 216) type = 'jpeg';
      else if (data.slice(0, 4).toString() === 'RIFF' && data.slice(8, 12).toString() === 'WEBP') type = 'webp';
    }
    if (!type) return message.respond({ returnValue: false, errorText: 'Icon not available' });
    message.respond({ returnValue: true, data: 'data:image/' + type + ';base64,' + data.toString('base64') });
  });
});

// App buttons the helper keeps (app/buttons.js) and the learning state.
service.register('buttons', function (message) {
  var raw = readShared('buttons.json'),
    names = readShared('button-names.json') || {},
    named = {},
    list = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    Object.keys(raw).forEach(function (k) {
      if (!/^[0-9]{1,4}$/.test(k) || !validId(raw[k])) return;
      var b = { code: Number(k), app: raw[k] },
        n = typeof names[k] === 'string' ? names[k].trim() : '';
      if (validName(n)) b.name = n;
      list.push(b);
    });
  // Every name, mapped or not: a button learned again keeps its name.
  if (names && typeof names === 'object' && !Array.isArray(names))
    Object.keys(names).forEach(function (k) {
      var n = typeof names[k] === 'string' ? names[k].trim() : '';
      if (/^[0-9]{1,4}$/.test(k) && validName(n)) named[k] = n;
    });
  var learn = readShared('learn.json');
  message.respond({
    returnValue: true,
    buttons: list,
    names: named,
    learn:
      learn && typeof learn.state === 'string'
        ? { state: learn.state, time: learn.time, code: typeof learn.code === 'number' ? learn.code : undefined }
        : null,
    running: running()
  });
});
