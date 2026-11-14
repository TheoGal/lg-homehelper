'use strict';
var fs = require('fs'),
  Service = require('webos-service'),
  claim = require('./boot-state').claim;
var service = new Service('io.github.theogal.homehelper.service');
var secureState = require('./state-permissions');
secureState(__dirname + '/state', function (x) {
  console.error(JSON.stringify(x));
});
var statePath = __dirname + '/state/startup-state.json',
  name = 'io.github.theogal.homehelper.boot';
function read() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    return { enabled: false };
  }
}
function save(state) {
  secureState.atomicRecord(
    __dirname + '/state',
    'startup-state',
    JSON.stringify(state)
  );
}
function boot() {
  return require('./boot-state').identity(
    fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    fs.readFileSync('/proc/stat', 'utf8')
  );
}
function call(uri, args, cb) {
  service.call(uri, args, function (m) {
    cb(m.payload);
  });
}
function complete(message, result) {
  fs.writeFileSync(
    '/tmp/homehelper-boot-callback.json',
    JSON.stringify({
      time: Date.now(),
      result: result,
      activity: message.payload.$activity
    })
  );
  if (message.payload.$activity && message.activity)
    service.activityManager.complete(
      message.activity,
      { restart: true },
      function (a) {
        fs.writeFileSync(
          '/tmp/homehelper-boot-complete.json',
          JSON.stringify({ time: Date.now(), activity: a })
        );
        message.respond({ returnValue: true, result: result });
      }
    );
  else message.respond({ returnValue: true, result: result });
}
// On newer webOS this service's sandbox cannot see the app's folder, only its
// own. The app side (not sandboxed) writes what the settings app needs into
// this folder (see app/shared.js): the TV's choice, the helper's status, the
// pairing status and the app list. Nothing secret: the key stays with the app.
var SHARED = __dirname + '/state';
var LG_HOME = 'com.webos.app.home';
function readShared(name) {
  try {
    return JSON.parse(fs.readFileSync(SHARED + '/' + name, 'utf8'));
  } catch (e) {
    return null;
  }
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
service.register('status', function (m) {
  try {
    m.respond({
      returnValue: true,
      target: homeTarget(),
      state: read(),
      boot: boot(),
      blocked: blocked(),
      running: running(),
      callback: readDebug('/tmp/homehelper-boot-callback.json'),
      complete: readDebug('/tmp/homehelper-boot-complete.json')
    });
  } catch (e) {
    m.respond({ returnValue: false, errorText: String(e) });
  }
});
service.register('disable', function (m) {
  try {
    save({ enabled: false });
    call(
      'luna://com.palm.activitymanager/cancel',
      { activityName: name },
      function (r) {
        m.respond({ returnValue: true, cancel: r });
      }
    );
  } catch (e) {
    m.respond({ returnValue: false, errorText: String(e) });
  }
});
// The service creates the boot task itself: webOS only lets a task's creator
// cancel it, so this keeps disable able to remove it again.
service.register('enable', function (m) {
  try {
    save({ enabled: true, boot: boot(), schema: 3 });
  } catch (e) {
    m.respond({ returnValue: false, errorText: String(e) });
    return;
  }
  call(
    'luna://com.palm.activitymanager/create',
    {
      activity: {
        name: name,
        description: 'Start Home Helper once per boot',
        type: { foreground: true, persist: true },
        schedule: { interval: '10s', precise: true },
        callback: {
          method: 'luna://io.github.theogal.homehelper.service/tick',
          params: {}
        }
      },
      start: true,
      replace: true,
      subscribe: false
    },
    function (r) {
      m.respond({ returnValue: true, create: r });
    }
  );
});
service.register('tick', function (m) {
  try {
    if (blocked()) {
      complete(m, { blocked: true });
      return;
    }
    var next = claim(read(), boot(), blocked());
    if (!next) {
      complete(m, { skipped: true });
      return;
    }
    // Persist before launching: a crash or watchdog exit must never create a restart loop.
    next.schema = 3;
    next.claimedAt = Date.now();
    save(next);
    call(
      'luna://com.webos.applicationManager/launch',
      { id: 'io.github.theogal.homehelper', params: { nativeHomeAuto: true } },
      function (r) {
        next.launch = r;
        save(next);
        complete(m, r);
      }
    );
  } catch (e) {
    complete(m, { returnValue: false, errorText: String(e) });
  }
});

function readDebug(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// A shortcut only: the helper itself refuses an automatic start while its
// stop latch is set. This service's sandbox usually cannot see the app's
// folder at all, so any error counts as "not stopped" rather than blocking
// every boot start.
function blocked() {
  return ['blocked', 'watchdog'].some(function (name) {
    try {
      fs.statSync(
        '/media/developer/apps/usr/palm/applications/io.github.theogal.homehelper/state/' +
          name
      );
      return true;
    } catch (e) {
      return false;
    }
  });
}

service.register('listApps', function (message) {
  var list = readShared('app-list.json');
  if (list && Array.isArray(list.apps) && list.apps.length)
    message.respond({ returnValue: true, apps: list.apps, time: list.time });
  else message.respond({ returnValue: false, errorText: 'App list not ready yet' });
});
