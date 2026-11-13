'use strict';
// Pair Home Helper with the TV's own remote-control service (wss://TV:3001)
// so it can see which app is in front, and save the key as state/ssap-key.json.
// The TV shows an "Allow" prompt; accept it with the remote. Writes state/pair-status.json so the settings app can follow.
var fs = require('fs'),
  os = require('os');
// Same full manifest as screen-watch.js and app-inventory.js: webOS 3.x keeps
// only the LAST registered permission set per key.
var PERMISSIONS = [
  'READ_APP_STATUS',
  'READ_RUNNING_APPS',
  'READ_POWER_STATE',
  'CONTROL_POWER',
  'READ_INSTALLED_APPS',
  'READ_INPUT_DEVICE_LIST'
];
function atomic(path, text, mode, gid) {
  var staging = path + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(staging, text, { mode: mode });
    if (gid !== undefined)
      try {
        fs.chownSync(staging, -1, gid);
      } catch (ignore) {}
    fs.chmodSync(staging, mode);
    fs.renameSync(staging, path);
  } catch (e) {
    try {
      fs.unlinkSync(staging);
    } catch (ignore) {}
    throw e;
  }
}
function addresses() {
  var list = [],
    interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(function (name) {
    interfaces[name].forEach(function (a) {
      if (
        !a.internal &&
        (a.family === 'IPv4' || a.family === 4) &&
        a.address.indexOf('169.254.') !== 0
      )
        list.push(a.address);
    });
  });
  return list;
}
module.exports = function (data, done) {
  var keyPath = data + '/ssap-key.json',
    statusPath = data + '/pair-status.json',
    gid,
    finished = false,
    socket = null,
    timer;
  function status(state, reason) {
    try {
      atomic(
        statusPath,
        JSON.stringify({ state: state, reason: reason || null, time: Date.now() }),
        420
      );
    } catch (ignore) {}
  }
  function finish(state, reason) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try {
      if (socket) socket.terminate();
    } catch (ignore) {}
    status(state, reason);
    done(state === 'paired' || state === 'already-paired');
  }
  try {
    gid = fs.statSync(data).gid;
    var existing = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    if (existing && typeof existing.key === 'string' && existing.key) {
      finish('already-paired');
      return;
    }
  } catch (ignore) {}
  var hosts = addresses();
  if (!hosts.length) {
    finish('failed', 'no-network');
    return;
  }
  status('waiting');
  // Leave time for someone to find the prompt and press Allow.
  timer = setTimeout(function () {
    finish('failed', 'timeout');
  }, 90000);
  var WebSocket = require('./websocket');
  try {
    socket = new WebSocket('wss://' + hosts[0] + ':3001', {
      rejectUnauthorized: false,
      handshakeTimeout: 5000,
      maxPayload: 65536,
      perMessageDeflate: false
    });
  } catch (e) {
    finish('failed', 'connect');
    return;
  }
  socket.on('error', function () {
    finish('failed', 'connect');
  });
  socket.on('close', function () {
    finish('failed', 'closed');
  });
  socket.on('open', function () {
    socket.send(
      JSON.stringify({
        type: 'register',
        id: 'register',
        payload: {
          forcePairing: false,
          pairingType: 'PROMPT',
          manifest: {
            manifestVersion: 1,
            appVersion: '1.1',
            permissions: PERMISSIONS
          }
        }
      })
    );
  });
  socket.on('message', function (raw) {
    var m;
    try {
      m = JSON.parse(String(raw));
    } catch (e) {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'error') {
      finish('failed', 'rejected');
      return;
    }
    if (m.type !== 'registered') return; // a PROMPT response means: waiting for Allow
    var key = m.payload && m.payload['client-key'];
    if (typeof key !== 'string' || !key || key.length > 4096) {
      finish('failed', 'no-key');
      return;
    }
    try {
      // 0640 in the state directory's group: what state-permissions expects.
      atomic(keyPath, JSON.stringify({ key: key }), 416, gid);
      finish('paired');
    } catch (e) {
      finish('failed', 'write');
    }
  });
};
