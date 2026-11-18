'use strict';
// The app list for the settings app: launch points over the TV's own SSAP port,
// plus Live TV when LG hides it from the launch points.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('node:events');
const inventory = require('../app/app-inventory');

function tv(answers) {
  const sent = [];
  class Socket extends E {
    constructor() {
      super();
      setImmediate(() => this.emit('open'));
    }
    send(raw) {
      const m = JSON.parse(raw);
      sent.push(m);
      const reply = m.type === 'register' ? { type: 'registered', id: 'register' } : answers[m.uri] && { id: m.id, payload: answers[m.uri] };
      if (reply) setImmediate(() => this.emit('message', JSON.stringify(reply)));
    }
    terminate() {}
  }
  return {
    sent,
    options: {
      timeout: 1000,
      readKey: () => ({ key: 'k' }),
      interfaces: () => ({ wlan0: [{ internal: false, family: 'IPv4', address: '192.168.1.5' }] }),
      WebSocket: Socket
    }
  };
}

test('launch points with Live TV visible', async () => {
  const t = tv({
    'ssap://com.webos.applicationManager/listLaunchPoints': {
      returnValue: true,
      launchPoints: [{ id: 'com.webos.app.livetv', title: 'Live TV' }, { id: 'netflix', title: 'Netflix' }]
    }
  });
  const apps = await inventory(t.options);
  assert.deepEqual(apps.map((a) => a.id), ['com.webos.app.livetv', 'netflix']);
  assert.equal(t.sent[0].payload['client-key'], 'k', 'uses the saved key');
});

test('Live TV hidden from launch points is added from the installed apps', async () => {
  const t = tv({
    'ssap://com.webos.applicationManager/listLaunchPoints': { returnValue: true, launchPoints: [{ id: 'netflix', title: 'Netflix' }] },
    'ssap://com.webos.applicationManager/listApps': {
      returnValue: true,
      apps: [{ id: 'com.webos.app.livetv', title: 'Live TV', visible: false }, { id: 'netflix', title: 'Netflix' }]
    }
  });
  const apps = await inventory(t.options);
  assert.deepEqual(apps.map((a) => a.id), ['com.webos.app.livetv', 'netflix']);
});

test('TV never answers listApps: launch points still come back', async () => {
  const t = tv({ 'ssap://com.webos.applicationManager/listLaunchPoints': { returnValue: true, launchPoints: [{ id: 'netflix', title: 'Netflix' }] } });
  const apps = await inventory(t.options);
  assert.deepEqual(apps.map((a) => a.id), ['netflix']);
});

test('no saved key: fails without pairing', async () => {
  const t = tv({});
  t.options.readKey = () => null;
  await assert.rejects(inventory(t.options), /missing-pairing/);
});

test('icons: the TV icon server address is made complete, others refused', async () => {
  const t = tv({
    'ssap://com.webos.applicationManager/listLaunchPoints': {
      returnValue: true,
      launchPoints: [
        { id: 'com.webos.app.livetv', title: 'Live TV', icon: '/resources/0123456789abcdef0123/icon.png' },
        { id: 'netflix', title: 'Netflix', largeIcon: 'http://192.168.1.5:3000/resources/aa/large.png' },
        { id: 'web', title: 'Web', icon: 'http://elsewhere.example/x.png' },
        { id: 'local', title: 'Local', icon: '/usr/palm/applications/local/icon.png' }
      ]
    }
  });
  const apps = await inventory(t.options);
  assert.deepEqual(apps.map((a) => a.iconUrl), [
    'http://192.168.1.5:3000/resources/0123456789abcdef0123/icon.png',
    'http://192.168.1.5:3000/resources/aa/large.png',
    undefined,
    '/usr/palm/applications/local/icon.png'
  ]);
});
