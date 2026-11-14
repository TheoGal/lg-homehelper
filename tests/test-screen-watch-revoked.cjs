'use strict';
// When the TV rejects the saved key (e.g. after a reset) it answers with a new
// pairing prompt. The helper must delete the dead key, tell the controller to
// stop (no pairing, no helper), and not reconnect into an unattended prompt.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

let keyExists = true;
const unlinked = [];
const sockets = [];
const timers = [];
const logs = [];
let revoked = 0;

class WS extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    sockets.push(this);
  }
  send(v) {
    this.sent.push(JSON.parse(v));
  }
  terminate() {
    if (!this.ended) {
      this.ended = true;
      this.emit('close', 1006);
    }
  }
}

const sandbox = {
  module: { exports: {} },
  console,
  JSON,
  Date,
  setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  require(n) {
    if (n === './websocket') return WS;
    if (n === 'fs') return { unlinkSync: (p) => { unlinked.push(p); keyExists = false; } };
    if (n === 'os')
      return { networkInterfaces: () => ({ eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] }) };
    if (n === './state-permissions')
      return Object.assign(() => true, {
        readConfiguration() {
          if (!keyExists) throw Error('missing');
          return '{"key":"old-key"}';
        }
      });
    throw Error('unexpected require ' + n);
  }
};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../app/screen-watch.js'), 'utf8'),
  sandbox
);
const watcher = sandbox.module.exports('/state', (e) => logs.push(e), () => {}, () => {}, () => {}, () => revoked++);

assert.equal(sockets.length, 1, 'connects with the saved key');
const s = sockets[0];
s.emit('open');
assert.equal(s.sent[0].payload['client-key'], 'old-key');

// The TV no longer knows this key and starts a pairing prompt instead.
s.emit('message', JSON.stringify({ type: 'response', id: 'register', payload: { pairingType: 'PROMPT' } }));
assert.deepEqual(unlinked, ['/state/ssap-key.json'], 'the dead key is deleted');
assert.ok(s.ended, 'the prompting connection is closed');
assert.ok(logs.some((e) => e.reason === 'pairing-required'));
assert.equal(revoked, 1, 'the controller is told to stop');

// Run every scheduled retry: without a key it must never open a new connection.
for (let i = 0; i < 5 && timers.length; i++) timers.splice(0).forEach((t) => t.fn());
assert.equal(sockets.length, 1, 'no new connection (and so no unattended prompt) without a key');
assert.ok(logs.some((e) => e.reason === 'missing-pairing-key'), 'waits quietly for a new key');

// After "Pair again" saves a new key, the next retry connects again.
keyExists = true;
timers.splice(0).forEach((t) => t.fn());
assert.equal(sockets.length, 2, 'reconnects once a new key exists');
watcher.close();
console.log('screen watch revoked key ok');
