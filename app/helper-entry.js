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
  var shared = require('./shared');
  if (id === '' || id === 'default') return shared.remove('target.json');
  if (!target.valid(id) && id !== target.LG_HOME) return false;
  return shared.write('target.json', { id: id });
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
function hasKey() {
  try {
    var key = JSON.parse(fs.readFileSync(root + '/state/ssap-key.json', 'utf8'));
    return !!(key && typeof key.key === 'string' && key.key);
  } catch (e) {
    return false;
  }
}
var saved = null;
if (typeof params.nativeHomeTarget === 'string')
  saved = saveTarget(params.nativeHomeTarget);
// App buttons (see buttons.js). Learning: true asks the running controller to
// catch the next button press, false cancels. A button: { code, app }, where
// app "" forgets the button, or { code, name } to rename it ("" gives it back
// its number). The running controller picks these up.
if (typeof params.nativeHomeLearn === 'boolean')
  saved = require('./buttons').setLearn(params.nativeHomeLearn ? 'requested' : 'cancelled');
if (params.nativeHomeButton && typeof params.nativeHomeButton === 'object')
  saved =
    typeof params.nativeHomeButton.name === 'string'
      ? require('./buttons').setName(params.nativeHomeButton.code, params.nativeHomeButton.name)
      : require('./buttons').set(params.nativeHomeButton.code, params.nativeHomeButton.app);
var starting =
  params.nativeHomeAuto === true ||
  params.nativeHomeStart === true ||
  (typeof params.nativeHomeSetup === 'string' &&
    /^[IS][a-f0-9]{32}$/.test(params.nativeHomeSetup));
if (params.nativeHomeStop === true) {
  // Same stop as the triple-Home emergency stop: latch it so boot does not
  // restart the helper, and tell a running controller to release the remote.
  try {
    require('./state-permissions').requestStop(root + '/state');
  } catch (e) {
    process.exit(1);
  }
  // Then remove the boot task, so "Stop, then uninstall" leaves nothing behind.
  // The stop above already holds even if this call fails.
  require('child_process').execFile(
    '/usr/bin/luna-send-pub',
    ['-n', '1', 'luna://io.github.theogal.homehelper.service/disable', '{}'],
    { timeout: 5000 },
    function () {
      process.exit(0);
    }
  );
} else if (starting) {
  // No pairing, no helper: it needs the pairing to see which app is in front.
  // A start someone asked for pairs first (the TV asks once) and only starts
  // after Allow. A boot start without a key does nothing: nobody can answer.
  var spawnController = function () {
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
  };
  if (hasKey()) spawnController();
  else if (params.nativeHomeAuto === true) process.exit(0);
  else
    require('./pair')(root + '/state', function (ok) {
      if (ok) spawnController();
      // Give the spawn a moment before this short-lived process exits.
      setTimeout(function () {
        process.exit(ok ? 0 : 1);
      }, ok ? 200 : 0);
    });
} else if (saved !== null) {
  process.exit(saved ? 0 : 1);
} else {
  // Opening the Home Helper tile shows its settings.
  launchApp(SETTINGS, null, function (ok) {
    process.exit(ok ? 0 : 1);
  });
}
