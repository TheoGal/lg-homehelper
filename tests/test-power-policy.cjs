'use strict';
// Powering off opens a window that stays open until the TV is Active again:
// the remote can vanish hours into standby, and that is not a failure.
const assert = require('node:assert/strict');
const policy = require('../app/power-policy')();
const off = policy.observe({ state: 'Active Standby' }, 1000);
assert.equal(off.command, 'T');
assert(off.deadline >= 1000 + 24 * 3600 * 1000, 'open for hours, not 15 seconds');
const on = policy.observe({ state: 'Active' }, 2000);
assert.equal(on.command, 'R');
assert.equal(on.deadline, 0, 'closed once the TV is on');
console.log('ok power policy');
