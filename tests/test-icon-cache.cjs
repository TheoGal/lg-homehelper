'use strict';
// Icons are downloaded once from the TV's icon server and kept next to the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cache = require('../app/icon-cache');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, 1)]);
function server() {
  let hits = 0;
  const s = http.createServer((req, res) => {
    hits++;
    if (req.url.endsWith('/icon.png')) { res.writeHead(200); res.end(PNG); }
    else if (req.url.endsWith('/text.png')) { res.writeHead(200); res.end('<html>not a picture</html>'); }
    else if (req.url.endsWith('/huge.png')) { res.writeHead(200); res.end(Buffer.concat([PNG, Buffer.alloc(300 * 1024)])); }
    else { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, port: s.address().port, hits: () => hits })));
}
const run = (dir, apps) => new Promise((r) => cache(dir, apps, r));

test('keeps pictures, refuses others, downloads once, forgets removed apps', async () => {
  const { s, port, hits } = await server();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const url = (f) => `http://127.0.0.1:${port}/resources/aa/${f}`;
  const apps = [
    { id: 'a', iconUrl: url('icon.png') },
    { id: 'b', iconUrl: url('text.png') },
    { id: 'c', iconUrl: url('huge.png') },
    { id: 'd', iconUrl: url('missing.png') },
    { id: 'e' }
  ];
  let names = await run(dir, apps);
  assert.deepEqual(Object.keys(names), ['a'], 'only the real, small picture is kept');
  assert.deepEqual(fs.readFileSync(path.join(dir, names.a)), PNG);
  assert.equal(fs.statSync(path.join(dir, names.a)).mode & 0o777, 0o644, 'readable by the settings service');
  const before = hits();
  names = await run(dir, [apps[0]]);
  assert.equal(names.a, cache.nameFor(url('icon.png')));
  assert.equal(hits(), before, 'kept icon is not downloaded again');
  await run(dir, [{ id: 'z' }]);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('icon-')), [], 'icons of removed apps deleted');
  s.close();
});

test('TV icon files are read directly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const file = path.join(dir, 'source.png');
  fs.writeFileSync(file, PNG);
  const names = await run(dir, [{ id: 'f', iconUrl: file }]);
  assert.ok(names.f);
});
