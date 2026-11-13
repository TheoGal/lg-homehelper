'use strict';
// The routing preference is separate from the emergency-stop latch and profile.
// Home is only redirected while the preference is on AND an app is chosen;
// otherwise the relay passes Home through to LG Home.
module.exports = function (fs, data, apply, visit, hasTarget) {
  var path = data + '/home-control.json',
    preference = true,
    applied;
  try {
    preference = JSON.parse(fs.readFileSync(path, 'utf8')).enabled !== false;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  function effective() {
    return preference && (!hasTarget || hasTarget());
  }
  applied = effective();
  // Push a change to the relay when it differs from what it last received.
  function sync() {
    var now = effective();
    if (now !== applied) {
      applied = now;
      apply(now);
    }
    return now;
  }
  return {
    enabled: effective,
    sync: sync,
    set: function (value) {
      if (typeof value !== 'boolean') throw Error('Expected enabled boolean');
      require('./state-permissions').atomicRecord(
        data,
        'home-preference',
        JSON.stringify({ enabled: value })
      );
      preference = value;
      applied = effective();
      apply(applied);
      return { enabled: applied };
    },
    visit: function () {
      return visit();
    }
  };
};
