'use strict';
// Activation generations: each launch of the chosen app gets a number, so a
// late reply from an older launch can be recognised and ignored.
module.exports = function (options) {
  options = options || {};
  var generation = options.seed,
    active = false,
    reason = null;
  if (generation === undefined) {
    var bytes = require('crypto').randomBytes(6);
    generation = 0;
    for (var i = 0; i < bytes.length; i++)
      generation = generation * 256 + bytes[i];
  }
  if (
    typeof generation !== 'number' ||
    !isFinite(generation) ||
    generation < 0 ||
    Math.floor(generation) !== generation ||
    generation > 9007199254740991
  )
    throw Error('Invalid presentation seed');
  function invalidate() {
    if (generation >= 9007199254740991)
      throw Error('Presentation generation exhausted');
    generation++;
    active = false;
    reason = null;
  }
  return {
    generation: function () {
      return generation;
    },
    active: function () {
      return active;
    },
    begin: function (next, retain) {
      if (retain && active && reason === 'home' && next === 'home')
        return generation;
      invalidate();
      active = true;
      reason = next;
      return generation;
    },
    invalidate: invalidate
  };
};
