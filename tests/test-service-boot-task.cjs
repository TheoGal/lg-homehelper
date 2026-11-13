'use strict';
// The boot task must be created and cancelled by the same bus client: webOS
// only lets a task's creator cancel it ("name/creator pair not found").
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const methods = {};
const calls = [];
let saved = null;
const fakefs = {
  readFileSync(p) {
    if (p === '/proc/sys/kernel/random/boot_id') return 'test-boot';
    if (p === '/proc/stat') return 'btime 1';
    throw Object.assign(Error('missing'), { code: 'ENOENT' });
  },
  statSync() {
    throw Object.assign(Error('missing'), { code: 'ENOENT' });
  },
  writeFileSync() {}
};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../service/service.js'), 'utf8'),
  {
    console,
    __dirname: '/service',
    require(n) {
      if (n === 'fs') return fakefs;
      if (n === 'webos-service')
        return class {
          constructor(name) {
            this.name = name;
            this.register = (m, f) => (methods[m] = f);
            this.call = (uri, args, cb) => {
              calls.push({ caller: this.name, uri, args });
              const ok = uri.endsWith('/create') || uri.endsWith('/cancel');
              setImmediate(() => cb({ payload: { returnValue: ok } }));
            };
          }
        };
      if (n === './boot-state') return { identity: () => 'boot', claim() {} };
      if (n === './state-permissions') {
        const secure = () => true;
        secure.atomicRecord = (dir, kind, text) => (saved = JSON.parse(text));
        return secure;
      }
      throw Error(n);
    }
  }
);

function invoke(method) {
  return new Promise((resolve) => methods[method]({ respond: resolve }));
}

(async () => {
  const enabled = await invoke('enable');
  assert.equal(enabled.returnValue, true);
  assert.equal(saved.enabled, true, 'enable saves the enabled state');
  const create = calls.find((c) => c.uri === 'luna://com.palm.activitymanager/create');
  assert.ok(create, 'enable creates the boot task');
  assert.equal(create.args.activity.name, 'io.github.theogal.homehelper.boot');
  assert.equal(
    create.args.activity.callback.method,
    'luna://io.github.theogal.homehelper.service/tick'
  );
  assert.equal(create.args.activity.type.persist, true);

  const disabled = await invoke('disable');
  assert.equal(disabled.returnValue, true);
  assert.equal(saved.enabled, false, 'disable saves the disabled state');
  const cancel = calls.find((c) => c.uri === 'luna://com.palm.activitymanager/cancel');
  assert.ok(cancel, 'disable cancels the boot task');
  assert.equal(cancel.args.activityName, create.args.activity.name);
  assert.equal(cancel.caller, create.caller, 'same bus client creates and cancels');
  assert.equal(create.caller, 'io.github.theogal.homehelper.service');
  console.log('service boot task ok');
})();
