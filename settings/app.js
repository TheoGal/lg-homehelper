/* Home Helper Settings: choose which app the remote's Home button opens. ES5 for older webOS. */
(function () {
  'use strict';
  var HELPER = 'io.github.theogal.homehelper';
  var HIDDEN = [HELPER, 'io.github.theogal.homehelper.settings', 'com.webos.app.home',
    'com.webos.app.cpcover'];
  var ROW = 102; // .app height + gap
  var LG_HOME = 'com.webos.app.home';
  var running = false; // unknown counts as stopped: starting is always safe
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
        running = false;
        $('power').textContent = 'Start Home Helper';
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
        'Home Helper is stopped. Start it to enable the Home button.';
      $('helperState').style.color = r.running ? '#9fd59a' : '#f0b46c';
      running = !!r.running;
      $('power').textContent = running ? 'Stop Home Helper' : 'Start Home Helper';
      showPairing(r.pairing);
      render();
    });
  }

  // No pairing, no helper: Start pairs first (the TV asks once) and only then
  // starts. Users only see what to do next, never the pairing itself.
  var pairPoll = null, pairStarted = 0;
  function note(text) {
    $('listNote').textContent = text || '';
    $('listNote').style.display = text ? '' : 'none';
  }
  function showPairing(p) {
    var s = p && p.status;
    var recent = s && pairStarted && s.time >= pairStarted - 5000;
    if (p && p.paired) {
      stopPairPoll();
      if (!appsLoaded) { appsLoaded = true; note(''); loadApps(); }
      return;
    }
    appsLoaded = false;
    if (recent && s.state === 'waiting') {
      note('Choose Allow on your TV to start Home Helper.');
    } else if (recent && s.state === 'failed') {
      stopPairPoll();
      note('Your TV did not allow Home Helper, so it was not started. Choose Start and Allow to try again.');
    } else {
      note('Start Home Helper to find your apps. Your TV will ask you to allow it once.');
    }
  }
  function stopPairPoll() { if (pairPoll) { clearInterval(pairPoll); pairPoll = null; } }
  // Check every 2 s until the TV's prompt is answered (it gives up after 90 s).
  function watchPairing() {
    pairStarted = Date.now();
    stopPairPoll();
    pairPoll = setInterval(refreshTarget, 2000);
    setTimeout(stopPairPoll, 100000);
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

  // Sideloaded web apps may not list apps themselves on newer webOS, so ask the
  // Helper service: the running helper publishes the list over the TV's pairing
  // connection. Right after Start that takes a few seconds, so keep asking for
  // up to 30 s. The platform's own lists are only a last resort.
  var appsLoaded = false, listTries = 0;
  function loadApps() {
    call('luna://' + HELPER + '.service/listApps', {}, function (r) {
      if (r && r.returnValue && r.apps && r.apps.length) { listTries = 0; return done(r.apps); }
      if (++listTries < 15) {
        note('Finding your apps...');
        setTimeout(loadApps, 2000);
        return;
      }
      listTries = 0;
      call('luna://com.webos.applicationManager/listLaunchPoints', {}, function (r2) {
        if (r2 && r2.returnValue && r2.launchPoints && r2.launchPoints.length) return done(r2.launchPoints);
        call('luna://com.webos.applicationManager/listApps', {}, function (r3) {
          if (r3 && r3.returnValue && r3.apps && r3.apps.length) return done(r3.apps);
          appsLoaded = false;
          done([]);
          note('Could not read your apps right now. Close this screen and open it again to retry.');
        });
      });
    });
    function done(list) {
      if (list.length) { appsLoaded = true; note(''); }
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
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function activateSide() {
    var el = sideItems()[sideIndex];
    if (el.id === 'power' && running) {
      message('Stopping...');
      launch(HELPER, { nativeHomeStop: true }, function (ok) {
        message(ok ? 'Home Helper stopped. The Home button goes to LG Home until you start it again.' :
          'Could not stop Home Helper.');
        setTimeout(refreshTarget, 1500);
        setTimeout(refreshTarget, 4000);
      });
    } else if (el.id === 'power') {
      message('Starting...');
      launch(HELPER, { nativeHomeStart: true }, function (ok) {
        message(ok ? '' : 'Could not start Home Helper.');
        if (ok) { watchPairing(); refreshTarget(); }
        setTimeout(refreshTarget, 1500);
        setTimeout(refreshTarget, 4000);
      });
    } else if (el.id === 'lghome') {
      // A one-off visit: the Home button keeps opening the chosen app.
      launch(LG_HOME, null, function (ok) {
        if (!ok) message('Could not open LG Home.');
      });
    } else if (el.id === 'reset') {
      setTarget('');
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

  // Show the LG Home entry at once; the status check loads the app list when
  // the helper is paired, or explains what to do.
  addApps([]);
  render();
  refreshTarget();
})();
