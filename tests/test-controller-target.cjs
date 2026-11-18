// Real controller/policies with virtual time; only TV hardware, filesystem and Luna are substituted.
// End-to-end controller scenarios on the real native.js (harness from Clean
// Your TV's controller tests, MIT): choosing, changing and clearing the Home
// app while the helper runs, the triple-Home emergency stop, and the stop
// after the TV rejects the pairing.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  E = require('node:events'),
  path = require('node:path');
const source = path.join(__dirname, '../app');
const dir =
  '/media/developer/apps/usr/palm/applications/io.github.theogal.homehelper/state/';
const targetNow = { id: null };
// The folder the helper publishes into for the settings app (see app/shared.js).
const sharedDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'helper-shared-'));
const sharedFile = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(sharedDir, name), 'utf8')); } catch (e) { return null; }
};
function controller({
  blocked = false,
  watchdog = false,
  automatic = true,
  setupGeneration,
  retainedGeneration = setupGeneration,
  homeInitiallyOff = false,
  deferStart = false,
  inputQuery,
  appsConfig = '[]',
  luna,
  foreground
} = {}) {
  let now = 1000,
    seq = 0,
    watch,
    exit,
    stopReads = 0;
  const timers = new Map(),
    files = new Map(),
    workers = [],
    cleanups = [],
    logs = [],
    launches = [];
  files.set(dir + 'apps.json', appsConfig);
  if (blocked) files.set(dir + 'blocked', 'stopped');
  if (watchdog) files.set(dir + 'watchdog', 'stopped');
  if (retainedGeneration)
    files.set(dir + 'stop-generation', retainedGeneration);
  if (homeInitiallyOff)
    files.set(dir + 'home-control.json', '{"enabled":false}');
  const schedule = (fn, ms, repeat = 0) => {
    const id = ++seq;
    timers.set(id, { fn, at: now + ms, repeat });
    return id;
  };
  function advance(ms) {
    const end = now + ms;
    while (true) {
      let next;
      for (const x of timers)
        if (x[1].at <= end && (!next || x[1].at < next[1].at)) next = x;
      if (!next) break;
      const [id, t] = next;
      now = t.at;
      if (t.repeat) t.at += t.repeat;
      else timers.delete(id);
      t.fn();
    }
    now = end;
  }
  const fakefs = {
    existsSync: (p) => files.has(p),
    writeFileSync: (p, s) => files.set(p, s),
    unlinkSync: (p) => files.delete(p),
    chmodSync() {},
    renameSync: (a, b) => {
      files.set(b, files.get(a));
      files.delete(a);
    },
    appendFileSync: (p, s) => logs.push(JSON.parse(s)),
    readFileSync(p) {
      if (p === dir + 'control.json') stopReads++;
      if (files.has(p)) return files.get(p);
      throw Object.assign(Error('absent'), { code: 'ENOENT' });
    }
  };
  function Service() {
    this.activityManager = { create() {} };
    this.call = (uri, p, cb) => {
      if (uri.endsWith('/launch')) launches.push(p.id);
      if (luna && luna(uri, p, cb)) return;
      cb({
        payload: { returnValue: true, state: { enabled: true, schema: 3 } }
      });
    };
  }
  const cp = {
    spawn(file, args) {
      assert(file.endsWith('/relay'));
      const c = new E();
      c.stdout = new E();
      c.stderr = new E();
      c.stdin = new E();
      c.writes = [];
      c.kills = [];
      c.ack = true;
      c.args = args;
      c.stdin.write = (b) => {
        c.writes.push(b);
        if (b === 'P' && c.ack) c.stdout.emit('data', Buffer.from('P\n'));
      };
      c.stdin.end = () => {};
      c.kill = (s) => {
        c.kills.push(s);
        return true;
      };
      (args[0] === 'cleanup' ? cleanups : workers).push(c);
      return c;
    }
  };
  const exitSignal = {};
  let loading = true;
  const context = {
    Buffer,
    console,
    Date: { now: () => now },
    require(n) {
      if (n === 'fs') return fakefs;
      if (n === 'child_process') return cp;
      if (n === '/usr/lib/node_modules/webos-service') return Service;
      if (n === './home-control')
        return require('./storage-fixture.cjs').homeControl(fakefs);
      if (n === './state-permissions') {
        const storage = require('./storage-fixture.cjs').create(fakefs, (d, l, init) => {
          if (init) files.set(dir + 'control.json', '{}');
          return true;
        });
        // Same three steps as the real requestStop in state-permissions.js.
        storage.requestStop = (d) => {
          storage.publishStopGeneration(d);
          storage.retainStop(d);
          files.set(d + '/control.json', '{"cmd":"stop"}');
          return true;
        };
        return storage;
      }
      if (n === './icon-cache')
        // Icon downloads have their own test; here every listed icon is "kept".
        return (dir, apps, done) => {
          const names = {};
          apps.forEach((a) => { if (typeof a.iconUrl === 'string') names[a.id] = 'icon-' + a.id; });
          done(names);
        };
      if (n === './shared') {
        const real = require(path.join(source, 'shared.js'));
        return {
          DIR: sharedDir,
          write: (name, value) => real.write(name, value, sharedDir),
          read: (name) => real.read(name, sharedDir),
          remove: (name) => real.remove(name, sharedDir)
        };
      }
      if (n === './target') {
        const get = () => targetNow.id;
        get.valid = (id) => typeof id === 'string' && id !== 'com.webos.app.home';
        get.LG_HOME = 'com.webos.app.home';
        get.resolve = () => ({ id: targetNow.id, source: targetNow.id ? 'tv' : 'none' });
        get.refresh = get;
        get.packaged = () => null;
        return get;
      }
      if (n === './app-inventory')
        return (
          inputQuery ||
          (() => {
            throw Error('unexpected inventory query');
          })
        );
      if (n === './screen-watch')
        return (d, l, fg, reset, power, revoked) => {
          watch = { fg, reset, power, revoked };
          return {
            close: reset,
            foreground:
              foreground ||
              function (done) {
                done(null);
              }
          };
        };
      return require(path.join(source, n));
    },
    process: {
      argv: [
        'node',
        'native.js',
        JSON.stringify({
          nativeHomeAuto: automatic,
          nativeHomeSetup: setupGeneration
        })
      ],
      pid: 1,
      getuid: () => 5431,
      hrtime: () => [Math.floor(now / 1000), (now % 1000) * 1e6],
      on() {},
      exit(c) {
        exit = c;
        if (loading) throw exitSignal;
      }
    },
    setTimeout: (f, ms) => schedule(f, ms),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (f, ms) => schedule(f, ms, ms),
    clearInterval: (id) => timers.delete(id)
  };
  try {
    vm.runInNewContext(
      fs.readFileSync(path.join(source, 'native.js'), 'utf8'),
      context
    );
  } catch (error) {
    if (error !== exitSignal) throw error;
  } finally {
    loading = false;
  }
  if (exit === undefined && !deferStart) {
    advance(automatic && !setupGeneration ? 0 : 1000);
    workers[0].stdout.emit('data', Buffer.from('READY\n'));
  }
  function close(
    code = 20,
    signal = null,
    worker = workers.at(-1),
    reason = code
  ) {
    if (reason !== null)
      worker.stdout.emit('data', Buffer.from('EXIT ' + reason + '\n'));
    if (code === 20) files.set(dir + 'watchdog', 'stopped');
    worker.emit('exit', code, signal);
    worker.emit('close', code, signal);
  }
  function command(cmd) {
    files.set(dir + 'control.json', JSON.stringify({ cmd }));
  }
  function cleanup(code = 0, signal = null) {
    const c = cleanups.at(-1);
    assert(c, 'cleanup must precede recovery');
    c.emit('exit', code, signal);
    c.emit('close', code, signal);
  }
  return {
    advance,
    files,
    workers,
    cleanups,
    logs,
    launches,
    close,
    cleanup,
    command,
    foreground: (id) => watch.fg(id),
    reset: () => watch.reset(),
    power: (p) => watch.power(p),
    revoked: () => watch.revoked(),
    get exit() {
      return exit;
    },
    get stopReads() {
      return stopReads;
    }
  };
}
const blocked = (c) => c.files.has(dir + 'blocked');
// The relay is told 'E' (catch Home) or 'D' (pass Home to LG); last one wins.
const mode = (c) => c.workers[0].writes.filter((w) => w === 'E' || w === 'D').at(-1);
const relayLine = (c, line) => c.workers[0].stdout.emit('data', Buffer.from(line + '\n'));

test('no app chosen: Home passes through to LG Home', () => {
  targetNow.id = null;
  const c = controller();
  assert.equal(mode(c), 'D', 'relay must pass Home through');
  assert(!c.launches.some((id) => id !== 'com.webos.app.home'), 'nothing launched');
});

test('picking an app while running: Home opens it; picking LG Home turns it off', () => {
  targetNow.id = null;
  const c = controller();
  assert.equal(mode(c), 'D');
  targetNow.id = 'tld.my.customlauncher';          // chosen in Home Helper Settings
  c.advance(1500);
  assert.equal(mode(c), 'E', 'relay must start catching Home');
  relayLine(c, 'HOME');
  c.advance(200);
  assert.equal(c.launches.filter((id) => id === 'tld.my.customlauncher').length, 1, 'Home opens the chosen app');
  targetNow.id = 'org.jellyfin.webos';             // a different app
  c.advance(1500);
  relayLine(c, 'HOME');
  c.advance(200);
  assert.equal(c.launches.at(-1), 'org.jellyfin.webos', 'Home follows the new choice');
  targetNow.id = null;                              // LG Home picked again
  c.advance(1500);
  assert.equal(mode(c), 'D', 'relay passes Home through again');
  assert.equal(c.exit, undefined, 'helper keeps running');
});

test('triple-Home emergency with an app chosen: LG Home, stays stopped', () => {
  targetNow.id = 'tld.my.customlauncher';
  const c = controller();
  assert.equal(mode(c), 'E');
  c.close(27);
  c.cleanup();
  c.advance(300);
  assert.equal(c.launches.at(-1), 'com.webos.app.home', 'returns to LG Home');
  assert(blocked(c), 'stop latch survives restarts');
  assert.equal(c.exit, 27);
});

test('pairing rejected while running: stops like Stop does', () => {
  targetNow.id = 'tld.my.customlauncher';
  const c = controller();
  c.revoked();
  assert(blocked(c), 'stop latch set right away');
  c.advance(400);
  assert(c.workers[0].writes.includes('Q'), 'controller itself tells the relay to quit');
  c.close(0);           // the relay exits after Q
  c.cleanup();
  c.advance(300);
  assert.equal(c.launches.at(-1), 'com.webos.app.home', 'returns to LG Home');
  assert.equal(c.exit, 0);
});

test('publishes status and app list for the settings app', async () => {
  for (const f of fs.readdirSync(sharedDir)) fs.unlinkSync(path.join(sharedDir, f));
  targetNow.id = 'tld.my.customlauncher';
  let reads = 0;
  const c = controller({
    inputQuery: () => (reads++, Promise.resolve([
      { id: 'tld.my.customlauncher', title: 'Hearth', iconUrl: 'http://192.168.1.5:3000/resources/ab/icon.png' },
      { id: 'netflix', title: 'Netflix', icon: '/ignored/raw/field.png' },
      { id: 'odd', title: 'Odd', iconUrl: 42 }
    ]))
  });
  let h = sharedFile('helper.json');
  assert.equal(h.running, true, 'running published at start');
  assert.equal(h.paired, false, 'no key yet');
  assert.equal(h.target.id, 'tld.my.customlauncher');
  assert.equal(sharedFile('app-list.json'), null, 'no app list without a pairing');
  c.files.set(dir + 'ssap-key.json', '{"key":"k"}');      // paired
  c.foreground('netflix');
  c.advance(60000);
  await new Promise((r) => setImmediate(r));
  assert.equal(sharedFile('helper.json').paired, true, 'pairing published');
  assert.equal(reads, 0, 'app list not read while the settings app is closed');
  c.foreground('io.github.theogal.homehelper.settings');
  c.advance(500);
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 1, 'read when the settings app opens');
  assert.deepEqual(
    sharedFile('app-list.json').apps,
    [
      { id: 'tld.my.customlauncher', title: 'Hearth', icon: 'icon-tld.my.customlauncher' },
      { id: 'netflix', title: 'Netflix' },
      { id: 'odd', title: 'Odd' }
    ],
    'app list published, naming the kept icon files'
  );
  c.advance(60000);
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 1, 'read once per visit');
  c.foreground('netflix');
  c.foreground('io.github.theogal.homehelper.settings');
  c.advance(500);
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 2, 'read again on the next visit');
  const before = sharedFile('helper.json').time;
  c.advance(31000);
  assert.ok(sharedFile('helper.json').time > before, 'refreshed at least every 30 s');
  c.command('stop');
  c.advance(400);
  c.close(0);
  c.cleanup();
  c.advance(300);
  assert.equal(sharedFile('helper.json').running, false, 'stopped published on exit');
});

// Power-on: the TV may be set to open its last input. Only LG Home is replaced.
const opened = (c, id) => c.launches.filter((x) => x === id).length;
test('boot into the last input: the chosen app is not opened', () => {
  targetNow.id = 'tld.my.customlauncher';
  const c = controller();
  c.foreground('com.webos.app.hdmi4');
  c.advance(10000);
  assert.equal(opened(c, 'tld.my.customlauncher'), 0, 'input stays on screen');
});

test('boot into LG Home: the chosen app replaces it', () => {
  targetNow.id = 'tld.my.customlauncher';
  const c = controller();
  c.foreground('com.webos.app.home');
  c.advance(5000);
  assert.equal(opened(c, 'tld.my.customlauncher'), 1, 'chosen app opened once');
});

test('wake into the last input: the chosen app is not opened', () => {
  targetNow.id = 'tld.my.customlauncher';
  const c = controller();
  c.foreground('com.webos.app.home');
  c.advance(60000); // boot window over
  c.foreground('tld.my.customlauncher');
  const before = opened(c, 'tld.my.customlauncher');
  c.power({ state: 'Active Standby' });
  c.advance(2000);
  c.power({ state: 'Active' });
  c.advance(1000);
  c.foreground('com.webos.app.hdmi4');
  c.advance(10000);
  assert.equal(opened(c, 'tld.my.customlauncher'), before, 'input stays on screen');
});

test('wake into LG Home: the chosen app replaces it', () => {
  targetNow.id = 'tld.my.customlauncher';
  const c = controller();
  c.advance(60000);
  c.foreground('tld.my.customlauncher');
  const before = opened(c, 'tld.my.customlauncher');
  c.power({ state: 'Active Standby' });
  c.advance(2000);
  c.power({ state: 'Active' });
  c.advance(500);
  c.foreground('com.webos.app.home');
  c.advance(5000);
  assert.equal(opened(c, 'tld.my.customlauncher'), before + 1, 'chosen app opened once');
});

// Remote buttons: learning a button in the settings app and opening its app.
const buttons = require('../app/buttons');
const SETTINGS_APP = 'io.github.theogal.homehelper.settings';
const relayWrites = (c) => c.workers[0].writes.filter((w) => w !== 'P').join('');
function clearButtons() {
  for (const f of ['buttons.json', 'learn.json']) fs.rmSync(path.join(sharedDir, f), { force: true });
}

test('learning a button: requested, listening, learned', () => {
  targetNow.id = 'tld.my.customlauncher';
  clearButtons();
  const c = controller();
  assert.match(relayWrites(c), /C/, 'empty button list sent when the relay is ready');
  c.foreground(SETTINGS_APP);
  buttons.setLearn('requested', sharedDir);
  c.advance(500);
  assert.match(relayWrites(c), /L/, 'relay told to learn');
  assert.equal(buttons.learnState(sharedDir).state, 'listening');
  relayLine(c, 'LEARN 1300');
  const s = buttons.learnState(sharedDir);
  assert.equal(s.state, 'learned');
  assert.equal(s.code, 1300);
});

test('a mapped button opens its app; the list reaches the relay', () => {
  targetNow.id = 'tld.my.customlauncher';
  clearButtons();
  const c = controller();
  c.foreground(SETTINGS_APP);
  assert(buttons.set(1300, 'netflix', sharedDir));
  assert(!buttons.set(773, 'netflix', sharedDir), 'Home can never be mapped');
  for (const code of [2, 11, 398, 401, 512, 521])
    assert(!buttons.set(code, 'netflix', sharedDir), 'number and coloured keys can never be mapped');
  c.advance(500);
  assert.match(relayWrites(c), /CM1300/, 'relay told which button to catch');
  relayLine(c, 'KEY 1300');
  c.advance(200);
  assert.equal(c.launches.at(-1), 'netflix');
  relayLine(c, 'KEY 1400');                         // not mapped (relay would not send it)
  c.advance(200);
  assert.equal(c.launches.at(-1), 'netflix', 'unknown button opens nothing');
  assert(buttons.set(1300, '', sharedDir));         // forgotten
  c.advance(500);
  assert.match(relayWrites(c), /CM1300C$/, 'empty list sent again');
});

test('learning stops when the settings app leaves the screen or after 20 s', () => {
  targetNow.id = 'tld.my.customlauncher';
  clearButtons();
  const c = controller();
  c.foreground(SETTINGS_APP);
  buttons.setLearn('requested', sharedDir);
  c.advance(500);
  c.foreground('netflix');
  assert.match(relayWrites(c), /Ll/, 'relay told to stop learning');
  assert.equal(buttons.learnState(sharedDir).state, 'cancelled');
  c.foreground(SETTINGS_APP);
  const again = Date.now() + 1;
  while (Date.now() < again);                       // a newer request
  buttons.setLearn('requested', sharedDir);
  c.advance(500);
  c.advance(21000);
  assert.equal(buttons.learnState(sharedDir).state, 'timeout');
  assert.match(relayWrites(c), /Ll.*Ll/s);
});
