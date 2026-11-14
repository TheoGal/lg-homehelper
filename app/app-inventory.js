'use strict';
// Uses the existing pairing key and only the TV's own LAN address. Never pairs.
module.exports = function (options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    var socket,
      done = false,
      timer,
      attemptTimer,
      launchPoints = null;
    function finish(error, apps) {
      if (done) return;
      if (error && launchPoints) {
        error = null;
        apps = launchPoints;
      }
      done = true;
      clearTimeout(timer);
      clearTimeout(attemptTimer);
      if (socket)
        try {
          socket.terminate();
        } catch (_) {}
      if (error) reject(Error(error));
      else {
        var host = hosts[index - 1];
        resolve(
          apps.map(function (a) {
            var icon = iconAddress(a, host);
            if (!icon) return a;
            var copy = {};
            Object.keys(a).forEach(function (k) {
              copy[k] = a[k];
            });
            copy.iconUrl = icon;
            return copy;
          })
        );
      }
    }
    function send(message) {
      try {
        socket.send(JSON.stringify(message));
      } catch (_) {
        finish('inventory-unavailable');
      }
    }
    try {
      var base =
        '/media/developer/apps/usr/palm/applications/io.github.theogal.homehelper';
      if (
        !options.readKey &&
        !require(base + '/state-permissions')(base + '/state')
      ) {
        finish('state-permissions');
        return;
      }
      var key = (
        options.readKey ||
        function () {
          return JSON.parse(
            require('fs').readFileSync(base + '/state/ssap-key.json', 'utf8')
          );
        }
      )();
      if (!key || typeof key.key !== 'string' || !key.key) {
        finish('missing-pairing');
        return;
      }
      var interfaces = (
          options.interfaces || require('os').networkInterfaces
        )(),
        hosts = [];
      Object.keys(interfaces).forEach(function (name) {
        interfaces[name].forEach(function (a) {
          if (
            !a.internal &&
            (a.family === 'IPv4' || a.family === 4) &&
            a.address.indexOf('169.254.') !== 0
          )
            hosts.push(a.address);
        });
      });
      if (!hosts.length) {
        finish('network-unavailable');
        return;
      }
      var WebSocket = options.WebSocket || require(base + '/websocket');
      var index = 0;
      timer = setTimeout(function () {
        finish('inventory-timeout');
      }, options.timeout || 8000);
      function connect() {
        if (done) return;
        if (index >= hosts.length) {
          finish('network-unavailable');
          return;
        }
        var current;
        try {
          current = new WebSocket('wss://' + hosts[index++] + ':3001', {
            rejectUnauthorized: false,
            handshakeTimeout: 2000,
            maxPayload: 1024 * 1024,
            perMessageDeflate: false
          });
        } catch (_) {
          connect();
          return;
        }
        socket = current;
        function retry() {
          if (done || socket !== current) return;
          if (launchPoints) {
            finish(null, launchPoints);
            return;
          }
          clearTimeout(attemptTimer);
          socket = null;
          try {
            current.terminate();
          } catch (_) {}
          connect();
        }
        attemptTimer = setTimeout(
          retry,
          Math.max(500, Math.floor((options.timeout || 8000) / hosts.length))
        );

        // Same full manifest as screen-watch.js: webOS 3.x stores the LAST registered
        // permission set per key, so a smaller request revokes the others.
        current.on('open', function () {
          if (done || socket !== current) return;
          send({
            type: 'register',
            id: 'register',
            payload: {
              forcePairing: false,
              pairingType: 'PROMPT',
              'client-key': key.key,
              manifest: {
                manifestVersion: 1,
                appVersion: '1.1',
                permissions: [
                  'READ_APP_STATUS',
                  'READ_RUNNING_APPS',
                  'READ_POWER_STATE',
                  'CONTROL_POWER',
                  'READ_INSTALLED_APPS',
                  'READ_INPUT_DEVICE_LIST'
                ]
              }
            }
          });
        });
        current.on('message', function (raw) {
          if (done || socket !== current) return;
          var message;
          try {
            message = JSON.parse(String(raw));
          } catch (_) {
            finish('invalid-response');
            return;
          }
          if (
            !message ||
            typeof message !== 'object' ||
            Array.isArray(message)
          ) {
            finish('invalid-response');
            return;
          }
          if (message.type === 'registered')
            send({
              type: 'request',
              id: 'apps',
              uri: 'ssap://com.webos.applicationManager/listLaunchPoints',
              payload: {}
            });
          else if (message.payload && message.payload.pairingType)
            finish('pairing-required');
          else if (message.type === 'error') finish('inventory-denied');
          else if (message.id === 'tuner' && launchPoints) {
            var installed = message.payload;
            var tuner =
              installed &&
              installed.returnValue === true &&
              Array.isArray(installed.apps)
                ? installed.apps.filter(function (a) {
                    return (
                      a &&
                      a.id === 'com.webos.app.livetv' &&
                      typeof a.title === 'string' &&
                      a.title.length > 0 &&
                      a.title.length <= 256
                    );
                  })[0]
                : null;
            if (tuner) {
              // LG can omit its installed tuner from launch points and mark it invisible.
              // Only this discovered app is selectable; never synthesize a system ID.
              var entry = {};
              Object.keys(tuner).forEach(function (key) {
                entry[key] = tuner[key];
              });
              entry.hidden = false;
              finish(
                null,
                [entry].concat(
                  launchPoints.filter(function (a) {
                    return !a || a.id !== entry.id;
                  })
                )
              );
            } else finish(null, launchPoints);
          } else if (
            message.id === 'apps' &&
            !launchPoints
          ) {
            var result = message.payload;
            if (
              !result ||
              result.returnValue === false ||
              !Array.isArray(result.launchPoints)
            )
              finish('invalid-inventory');
            else {
              launchPoints = result.launchPoints.slice(0, 200);
              if (
                launchPoints.some(function (a) {
                  return a && a.id === 'com.webos.app.livetv' && !a.hidden;
                })
              )
                finish(null, launchPoints);
              else {
                // Live TV can be missing from the launch points: ask for the
                // installed apps once (the timeout still returns launchPoints).
                send({
                  type: 'request',
                  id: 'tuner',
                  uri: 'ssap://com.webos.applicationManager/listApps',
                  payload: {}
                });
              }
            }
          }
        });
        current.on('error', retry);
        current.on('close', retry);
      }
      connect();
    } catch (_) {
      finish('inventory-unavailable');
    }
  });
};

// The TV lists icons as addresses on its own web server (/resources/<hash>/<file>,
// reachable at port 3000), sometimes as full addresses on that server, and on
// some firmware as file paths. Only those three forms are passed on.
var ICON_KEYS = ['largeIcon', 'icon', 'mediumLargeIcon', 'extraLargeIcon'];
function iconAddress(app, host) {
  for (var i = 0; i < ICON_KEYS.length; i++) {
    var uri = app && app[ICON_KEYS[i]];
    if (typeof uri !== 'string' || !uri || uri.length > 1024) continue;
    if (/^\/resources\/[a-fA-F0-9]{16,128}\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(uri))
      return host ? 'http://' + host + ':3000' + uri : null;
    var m = /^https?:\/\/([^/:@]+)(:(\d+))?\/[^\s]*$/.exec(uri);
    if (m) {
      if (m[1] === host && (!m[3] || ['80', '443', '3000', '3001'].indexOf(m[3]) >= 0))
        return uri.replace(/^https:\/\/([^/]+):3001/, 'http://$1:3000');
      continue;
    }
    if (/^\/(usr|media)\/[A-Za-z0-9_.\/-]+$/.test(uri) && uri.indexOf('..') < 0)
      return uri;
  }
  return null;
}
module.exports.iconAddress = iconAddress;
