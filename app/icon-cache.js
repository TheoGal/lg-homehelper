'use strict';
// App icons for the settings page. The page cannot load pictures from the TV's
// icon server itself, so the helper downloads each icon once and keeps it as a
// small file next to the app list (icon-<hash>); the settings page's service
// hands them over one at a time. Only icons not kept yet are downloaded, and
// icons of apps no longer listed are deleted.
//
// Sources are only the TV's own icon server (the address app-inventory checked)
// or the TV's own icon files. No redirects; size, type and time are bounded.
var fs = require('fs'),
  crypto = require('crypto');

var MAX_ICON = 256 * 1024,
  MAX_TOTAL = 4 * 1024 * 1024,
  PER_ICON_MS = 3000,
  PARALLEL = 4;

function nameFor(address) {
  return 'icon-' + crypto.createHash('sha1').update(address).digest('hex');
}

function kind(data) {
  if (!data || data.length < 12) return '';
  if (data.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (data[0] === 255 && data[1] === 216) return 'jpeg';
  if (data.slice(0, 4).toString() === 'RIFF' && data.slice(8, 12).toString() === 'WEBP') return 'webp';
  return '';
}

function fetchHttp(address, get, done) {
  var finished = false,
    request,
    chunks = [],
    size = 0;
  function finish(data) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try {
      if (request) request.abort();
    } catch (_) {}
    done(data || null);
  }
  var timer = setTimeout(function () {
    finish(null);
  }, PER_ICON_MS);
  try {
    var parsed = require('url').parse(address);
    request = (get || require('http').get)(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.path, agent: false },
      function (r) {
        if (r.statusCode !== 200) {
          r.resume();
          return finish(null);
        }
        r.on('data', function (chunk) {
          size += chunk.length;
          if (size > MAX_ICON) finish(null);
          else chunks.push(chunk);
        });
        r.on('end', function () {
          finish(Buffer.concat(chunks));
        });
        r.on('error', function () {
          finish(null);
        });
      }
    );
    request.on('error', function () {
      finish(null);
    });
  } catch (_) {
    finish(null);
  }
}

function fetchFile(path, done) {
  fs.stat(path, function (error, st) {
    if (error || !st.isFile() || st.size > MAX_ICON) return done(null);
    fs.readFile(path, function (e, data) {
      done(e ? null : data);
    });
  });
}

function store(dir, name, data) {
  var path = dir + '/' + name,
    staging = path + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(staging, data, { mode: 420 });
    fs.chmodSync(staging, 420); // 0644: the settings service only reads it
    fs.renameSync(staging, path);
    return true;
  } catch (_) {
    try {
      fs.unlinkSync(staging);
    } catch (ignore) {}
    return false;
  }
}

// apps: [{ id, title, iconUrl }]; calls done(names) with { appId: iconFileName }.
module.exports = function (dir, apps, done, options) {
  options = options || {};
  var names = {},
    wanted = {},
    queue = [],
    budget = MAX_TOTAL,
    running = 0;
  apps.forEach(function (a) {
    if (!a || typeof a.iconUrl !== 'string') return;
    var name = nameFor(a.iconUrl);
    wanted[name] = true;
    if (fs.existsSync(dir + '/' + name)) names[a.id] = name;
    else queue.push({ id: a.id, address: a.iconUrl, name: name });
  });
  // Forget icons of apps that are gone.
  try {
    fs.readdirSync(dir).forEach(function (f) {
      if (/^icon-[0-9a-f]{40}$/.test(f) && !wanted[f])
        try {
          fs.unlinkSync(dir + '/' + f);
        } catch (_) {}
    });
  } catch (_) {}
  function next() {
    if (!queue.length && !running) return done(names);
    while (running < PARALLEL && queue.length) {
      var job = queue.shift();
      running++;
      (function (job) {
        function got(data) {
          running--;
          if (data && kind(data) && data.length <= budget && store(dir, job.name, data)) {
            budget -= data.length;
            names[job.id] = job.name;
          }
          next();
        }
        if (/^http:\/\//.test(job.address)) fetchHttp(job.address, options.get, got);
        else fetchFile(job.address, got);
      })(job);
    }
  }
  next();
};
module.exports.nameFor = nameFor;
module.exports.kind = kind;
