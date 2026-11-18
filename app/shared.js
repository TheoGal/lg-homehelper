'use strict';
// Files the settings app needs, written into the settings package's service
// folder. webOS 26 only lets the settings page call services from its own
// package, and that service's sandbox only sees its own folder; the helper is
// not sandboxed and writes there. Nothing secret goes here: the pairing key stays in the app's folder.
var fs = require('fs');
var DIR =
  '/media/developer/apps/usr/palm/services/io.github.theogal.homehelper.settings.service/state';

function write(name, value, directory) {
  var path = (directory || DIR) + '/' + name,
    staging = path + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(staging, JSON.stringify(value), { mode: 420 });
    fs.chmodSync(staging, 420); // 0644: the service only reads these
    fs.renameSync(staging, path);
    return true;
  } catch (e) {
    try {
      fs.unlinkSync(staging);
    } catch (ignore) {}
    return false;
  }
}

function read(name, directory) {
  try {
    return JSON.parse(fs.readFileSync((directory || DIR) + '/' + name, 'utf8'));
  } catch (e) {
    return null;
  }
}

function remove(name, directory) {
  try {
    fs.unlinkSync((directory || DIR) + '/' + name);
    return true;
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

module.exports = { DIR: DIR, write: write, read: read, remove: remove };
