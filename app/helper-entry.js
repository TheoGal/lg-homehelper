'use strict';
// The tile is informational. Only boot callbacks and an explicit UI action start
// the controller; opening Helper must never clear an emergency-stop latch.
var root = '/media/developer/apps/usr/palm/applications/io.github.theogal.homehelper';
var SETTINGS = 'io.github.theogal.homehelper.settings';
var fs = require('fs'),
  target = require('./target');
var params;
try {
  params = JSON.parse(process.argv[2] || '{}');
} catch (_) {
  params = {};
}
// Save the Home target chosen on the TV. "com.webos.app.home" means LG Home
// (no redirect). "" or "default" clears the TV choice, falling back to the
// packaged default if any, else LG Home. The running controller re-reads it.
function saveTarget(id) {
  var path = root + '/state/target.json';
  if (id === '' || id === 'default') {
    try {
      fs.unlinkSync(path);
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }
    return true;
  }
  if (!target.valid(id) && id !== target.LG_HOME) return false;
  var staging = path + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(staging, JSON.stringify({ id: id }), { mode: 420 });
    fs.chmodSync(staging, 420); // 0644: the Helper service reads it for status.
    fs.renameSync(staging, path);
    return true;
  } catch (e) {
    try {
      fs.unlinkSync(staging);
    } catch (ignore) {}
    return false;
  }
}
function launchApp(id, launchParams, done) {
  // Anonymous public-bus caller: the controller already owns the app LS2 name.
  require('child_process').execFile(
    '/usr/bin/luna-send-pub',
    [
      '-n',
      '1',
      'luna://com.webos.applicationManager/launch',
      JSON.stringify(
        launchParams ? { id: id, params: launchParams } : { id: id }
      )
    ],
    { timeout: 5000 },
    function (error, stdout) {
      done(!error && /"returnValue"\s*:\s*true/.test(String(stdout)));
    }
  );
}
var saved = null;
if (typeof params.nativeHomeTarget === 'string')
  saved = saveTarget(params.nativeHomeTarget);
var starting =
  params.nativeHomeAuto === true ||
  params.nativeHomeStart === true ||
  (typeof params.nativeHomeSetup === 'string' &&
    /^[IS][a-f0-9]{32}$/.test(params.nativeHomeSetup));
if (params.nativeHomePair === true) {
  // Pairing waits for "Allow" on the TV; detach already runs us in our own session.
  require('./pair')(root + '/state', function (ok) {
    process.exit(ok ? 0 : 1);
  });
} else if (starting) {
  var start = { nativeHomeAuto: params.nativeHomeAuto === true };
  if (typeof params.nativeHomeSetup === 'string')
    start.nativeHomeSetup = params.nativeHomeSetup;
  var child = require('child_process').spawn(
    root + '/detach',
    [JSON.stringify(start), '--controller'],
    { detached: true, stdio: 'ignore' }
  );
  child.on('error', function () {
    process.exit(1);
  });
  child.unref();
} else if (saved !== null) {
  process.exit(saved ? 0 : 1);
} else {
  // Opening the Home Helper tile shows its settings.
  launchApp(SETTINGS, null, function (ok) {
    process.exit(ok ? 0 : 1);
  });
}
