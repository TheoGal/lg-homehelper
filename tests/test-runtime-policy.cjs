'use strict';
// A relay that exits because the remote is provably gone (32) waits for it to
// come back, whatever the power state: no latch, no stop.
const assert = require('node:assert/strict');
const { classifyExit } = require('../app/runtime-policy');
const base = { code: 32, signal: null, reportedReason: 32, tracked: true, ready: true, now: 5000, retryCount: 0 };
let d = classifyExit(Object.assign({}, base, { powerOffUntil: 0 }));
assert.equal(d.action, 'wait-power', 'no power-off seen: still waits');
assert.equal(d.block, false);
d = classifyExit(Object.assign({}, base, { powerOffUntil: 1000 }));
assert.equal(d.action, 'wait-power', 'old window long closed: still waits');
d = classifyExit(Object.assign({}, base, { stop: true }));
assert.notEqual(d.action, 'wait-power', 'a Stop still stops');
d = classifyExit(Object.assign({}, base, { code: 31, reportedReason: 31 }));
assert.equal(d.block, true, 'a real cleanup failure still blocks');
console.log('ok runtime policy');
