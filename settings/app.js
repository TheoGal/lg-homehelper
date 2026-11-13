/* Home Helper Settings: choose which app the remote's Home button opens. ES5 for older webOS. */
(function () {
  'use strict';
  var HELPER = 'io.github.theogal.homehelper';
  var HIDDEN = [HELPER, 'io.github.theogal.homehelper.settings', 'com.webos.app.home',
    'com.webos.app.cpcover'];
  var ROW = 102; // .app height + gap
  var LG_HOME = 'com.webos.app.home';
  var apps = [], current = null, targetLoaded = false, packagedTarget = null, zone = 'list', listIndex = 0, sideIndex = 0;
  var $ = function (id) { return document.getElementById(id); };

  function call(uri, params, cb) {
    var done = false, bridge;
    var timer = setTimeout(function () { finish(null); }, 6000);
    function finish(r) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (bridge) bridge.cancel(); } catch (e) {}
      cb(r);
    }
    try {
      bridge = new PalmServiceBridge();
      bridge.onservicecallback = function (raw) {
        var r = null;
        try { r = JSON.parse(raw); } catch (e) {}
        finish(r);
      };
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      finish(null);
    }
  }
  function sideItems() {
    var all = document.querySelectorAll('#side .nav'), out = [];
    for (var i = 0; i < all.length; i++) if (all[i].style.display !== 'none') out.push(all[i]);
    return out;
  }
  function launch(id, params, cb) {
    call('luna://com.webos.applicationManager/launch',
      params ? { id: id, params: params } : { id: id },
      function (r) { if (cb) cb(!!(r && r.returnValue)); });
  }
  function message(text) { $('msg').textContent = text || ''; }
  function titleOf(id) {
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i].title;
    return id;
  }

  function refreshTarget() {
    call('luna://' + HELPER + '.service/target', {}, function (r) {
      if (!r || !r.returnValue || !r.target) {
        $('currentTitle').textContent = 'Unknown';
        $('currentMeta').textContent = 'Home Helper service did not answer. Is Home Helper installed?';
        $('helperState').textContent = '';
        return;
      }
      var first = !targetLoaded;
      targetLoaded = true;
      current = r.target.id || LG_HOME; // no target: Home goes to LG Home
      packagedTarget = r.target.packaged || null;
      if (first)
        for (var i = 0; i < apps.length; i++) if (apps[i].id === current) listIndex = i;
      var src = { tv: 'chosen on this TV', packaged: 'set before install' }[r.target.source] || '';
      $('currentTitle').textContent = current === LG_HOME ? 'LG Home' : titleOf(current);
      $('currentMeta').textContent = current === LG_HOME ?
        'Not redirected' + (r.target.source === 'tv' ? '  -  chosen on this TV' : '  -  no app chosen yet') :
        current + (src ? '  -  ' + src : '');
      // Going back to a packaged default only makes sense when there is one.
      var reset = $('reset');
      reset.style.display = packagedTarget && r.target.source === 'tv' ? '' : 'none';
      reset.textContent = 'Use packaged default (' + titleOf(packagedTarget || '') + ')';
      $('helperState').textContent = r.running ? 'Home Helper is running' :
        'Home Helper is stopped. Choose Start to enable the Home button.';
      $('helperState').style.color = r.running ? '#9fd59a' : '#f0b46c';
      showPairing(r.pairing);
      render();
    });
  }

  var pairPoll = null, pairStarted = 0;
  var PAIR_REASONS = { timeout: 'no answer in time', rejected: 'the TV refused',
    connect: 'could not reach the TV service', closed: 'connection closed',
    write: 'could not save the key', 'no-network': 'no network', 'no-key': 'no key received' };
  function showPairing(p) {
    var el = $('pairState'), s = p && p.status;
    if (p && p.paired) {
      el.textContent = 'Returns here when an app closes';
      el.style.color = '#9fd59a';
      $('pair').textContent = 'Return after apps close: on';
      stopPairPoll();
    } else if (s && s.state === 'waiting' && s.time >= pairStarted - 5000) {
      el.textContent = 'Waiting: choose Allow on the TV prompt';
      el.style.color = '#f0b46c';
    } else if (s && s.state === 'failed' && pairStarted && s.time >= pairStarted - 5000) {
      el.textContent = 'Pairing failed: ' + (PAIR_REASONS[s.reason] || s.reason || 'unknown') + '. Try again.';
      el.style.color = '#f08a6c';
      stopPairPoll();
    } else if (p) {
      el.textContent = 'Does not return here after an app closes (not paired)';
      el.style.color = '#b9aea4';
    }
  }
  function stopPairPoll() { if (pairPoll) { clearInterval(pairPoll); pairPoll = null; } }
  function startPairing() {
    pairStarted = Date.now();
    message('A prompt will appear on the TV. Choose Allow with the remote.');
    launch(HELPER, { nativeHomePair: true }, function (ok) {
      if (!ok) { message('Could not reach Home Helper. Is it installed?'); return; }
      stopPairPoll();
      pairPoll = setInterval(refreshTarget, 2000);
      setTimeout(stopPairPoll, 100000);
    });
  }

  function setTarget(id) {
    message('Saving...');
    launch(HELPER, { nativeHomeTarget: id }, function (ok) {
      message(ok ? (id === LG_HOME ? 'Saved. The Home button goes to LG Home again.' :
        'Saved. The Home button now opens ' + (id ? titleOf(id) : 'the packaged default') + '.') :
        'Could not reach Home Helper. Is it installed?');
      setTimeout(refreshTarget, 900);
    });
  }

  function addApps(list) {
    var seen = {};
    apps = [];
    (list || []).forEach(function (a) {
      if (!a || typeof a.id !== 'string' || seen[a.id] || HIDDEN.indexOf(a.id) >= 0) return;
      if (a.visible === false && a.id !== current) return;
      seen[a.id] = true;
      apps.push({ id: a.id, title: a.title || a.id, icon: a.icon || a.mediumIcon || '' });
    });
    apps.sort(function (x, y) { return x.title.toLowerCase() < y.title.toLowerCase() ? -1 : 1; });
    // Always first: going back to LG's own Home.
    apps.unshift({ id: LG_HOME, title: 'LG Home', icon: '', note: 'no redirect' });
  }

  // Try the platform's own lists first, then the Helper service's inventory.
  function loadApps() {
    call('luna://com.webos.applicationManager/listLaunchPoints', {}, function (r) {
      if (r && r.returnValue && r.launchPoints && r.launchPoints.length) return done(r.launchPoints);
      call('luna://com.webos.applicationManager/listApps', {}, function (r2) {
        if (r2 && r2.returnValue && r2.apps && r2.apps.length) return done(r2.apps);
        call('luna://' + HELPER + '.service/listApps', {}, function (r3) {
          if (r3 && r3.returnValue && r3.apps) return done(r3.apps);
          done([]);
          message('Could not read the app list. You can still type an app id.');
        });
      });
    });
    function done(list) {
      addApps(list);
      render();
      refreshTarget();
    }
  }

  function render() {
    var rows = $('rows');
    rows.innerHTML = '';
    apps.forEach(function (a, i) {
      var row = document.createElement('div');
      row.className = 'app' + (a.id === current ? ' selected' : '') +
        (zone === 'list' && i === listIndex ? ' focus' : '');
      if (a.icon) {
        var img = document.createElement('img');
        img.src = a.icon;
        img.onerror = function () { img.style.visibility = 'hidden'; };
        row.appendChild(img);
      }
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.title;
      row.appendChild(name);
      var id = document.createElement('span');
      id.className = 'id';
      id.textContent = a.note || a.id;
      row.appendChild(id);
      row.onclick = function () { listIndex = i; zone = 'list'; setTarget(a.id); };
      rows.appendChild(row);
    });
    // Show whole rows only: trim the list to a multiple of the row height.
    var list = $('list');
    if (!list.getAttribute('data-fit')) {
      var space = $('main').getBoundingClientRect().bottom - list.getBoundingClientRect().top;
      if (space >= ROW) {
        list.style.flex = 'none';
        list.style.height = Math.floor(space / ROW) * ROW + 'px';
        list.setAttribute('data-fit', '1');
      }
    }
    var visible = Math.floor(list.clientHeight / ROW);
    var top = Math.max(0, Math.min(listIndex - Math.floor(visible / 2), apps.length - visible));
    rows.style.top = (-top * ROW) + 'px';
    var side = sideItems();
    sideIndex = Math.min(sideIndex, side.length - 1);
    for (var s = 0; s < side.length; s++)
      side[s].className = side[s].className.replace(/\s*focus/g, '') +
        (zone === 'side' && s === sideIndex ? ' focus' : '');
    if (zone === 'side' && side[sideIndex].id === 'manual') side[sideIndex].focus();
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function activateSide() {
    var el = sideItems()[sideIndex];
    if (el.id === 'start') {
      message('Starting...');
      launch(HELPER, { nativeHomeStart: true }, function (ok) {
        message(ok ? 'Home Helper started.' : 'Could not start Home Helper.');
        setTimeout(refreshTarget, 1500);
      });
    } else if (el.id === 'lghome') {
      // A one-off visit: the Home button keeps opening the chosen app.
      launch(LG_HOME, null, function (ok) {
        if (!ok) message('Could not open LG Home.');
      });
    } else if (el.id === 'pair') {
      startPairing();
    } else if (el.id === 'reset') {
      setTarget('');
    } else if (el.id === 'manual') {
      var v = el.value.replace(/^\s+|\s+$/g, '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v)) { message('That does not look like an app id.'); return; }
      if (HIDDEN.indexOf(v) >= 0) { message('That app cannot be the Home target.'); return; }
      setTarget(v);
    }
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, sideCount = sideItems().length;
    if (k === 461 || k === 27) { // Back
      if (window.webOSSystem && webOSSystem.platformBack) webOSSystem.platformBack();
      else if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack();
      else window.close();
      e.preventDefault();
      return;
    }
    if (k === 37 && zone === 'list') zone = 'side';
    else if (k === 39 && zone === 'side' && apps.length) zone = 'list';
    else if (k === 38) {
      if (zone === 'list') listIndex = Math.max(0, listIndex - 1);
      else sideIndex = Math.max(0, sideIndex - 1);
    } else if (k === 40) {
      if (zone === 'list') listIndex = Math.min(apps.length - 1, listIndex + 1);
      else sideIndex = Math.min(sideCount - 1, sideIndex + 1);
    } else if (k === 13) {
      if (zone === 'list' && apps[listIndex]) setTarget(apps[listIndex].id);
      else if (zone === 'side') activateSide();
    } else return;
    e.preventDefault();
    render();
  });
  document.addEventListener('webOSRelaunch', refreshTarget);

  loadApps();
})();
