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
  // The list shows one of: the Home button choice ('home'), the app buttons
  // ('buttons'), waiting for a button press ('learning'), or the app for one
  // button ('assign'), what to do with a mapped button ('button'), or a name
  // for one button ('rename').
  var mode = 'home', buttonList = [], buttonNames = {}, assignCode = null;
  // Pointer: moving it selects what it points at (a list scrolling under a
  // pointer that stays still does not count), clicking acts on it; arrows and OK
  // take over again. A click and an OK key that arrive together act once.
  var pointerMoved = false, keepTop = false, listTop = 0, lastAct = 0;
  function once(action) {
    var now = Date.now();
    if (now - lastAct < 400) return;
    lastAct = now;
    action();
  }
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
  // Results fade after 5 seconds. Progress ("Saving...") and instructions that
  // still apply (keep) stay until the next message replaces them.
  var msgTimer = null, msgKeep = false;
  function message(text, keep) {
    $('msg').textContent = text || '';
    msgKeep = !!(text && keep);
    if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
    if (text && !keep && !/\.\.\.$/.test(text))
      msgTimer = setTimeout(function () { msgTimer = null; $('msg').textContent = ''; }, 5000);
  }
  // Leaving a screen takes away its instruction, but never a result that is
  // still being read: that one fades on its own.
  function clearInstruction() {
    if (msgKeep) message('');
  }
  function titleOf(id) {
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i].title;
    return id;
  }

  function refreshTarget() {
    call('luna://' + HELPER + '.settings.service/target', {}, function (r) {
      if (!r || !r.returnValue || !r.target) {
        $('currentTitle').textContent = 'Unknown';
        $('currentMeta').textContent = 'Home Helper service did not answer' +
          (r && r.errorText ? ' (' + r.errorText + ')' : r ? '' : ' (no reply)') + '. Is Home Helper installed?';
        $('helperState').textContent = '';
        $('reset').style.display = 'none';
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

  // Icons are kept by the helper (the page cannot load them from the TV's icon
  // server) and handed over one at a time by this page's service.
  var iconData = {}, iconWaiting = {}, iconQueue = [], iconBusy = false;
  function loadIcon(name, img) {
    if (iconData[name]) { img.src = iconData[name]; return; }
    if (iconWaiting[name]) { iconWaiting[name].push(img); return; }
    iconWaiting[name] = [img];
    iconQueue.push(name);
    nextIcon();
  }
  function nextIcon() {
    if (iconBusy || !iconQueue.length) return;
    var name = iconQueue.shift();
    iconBusy = true;
    call('luna://' + HELPER + '.settings.service/icon', { name: name }, function (r) {
      iconBusy = false;
      var imgs = iconWaiting[name] || [];
      delete iconWaiting[name];
      if (r && r.returnValue && typeof r.data === 'string' && r.data.indexOf('data:image/') === 0) {
        iconData[name] = r.data;
        for (var i = 0; i < imgs.length; i++) imgs[i].src = r.data;
      }
      nextIcon();
    });
  }
  function addApps(list) {
    var seen = {};
    apps = [];
    (list || []).forEach(function (a) {
      if (!a || typeof a.id !== 'string' || seen[a.id] || HIDDEN.indexOf(a.id) >= 0) return;
      seen[a.id] = true;
      apps.push({ id: a.id, title: a.title || a.id, icon: typeof a.icon === 'string' ? a.icon : '' });
    });
    apps.sort(function (x, y) { return x.title.toLowerCase() < y.title.toLowerCase() ? -1 : 1; });
    // Always first: going back to LG's own Home.
    apps.unshift({ id: LG_HOME, title: 'LG Home', note: 'no redirect', glyph: 'home' });
  }

  // Sideloaded web apps cannot list the TV's apps themselves, so the running
  // helper publishes the list over the TV's pairing connection and this page's
  // service hands it over. Right after Start that takes a few seconds, so keep
  // asking for up to 30 s.
  // The helper reads a fresh list each time this page opens, which takes a few
  // seconds: the list saved last time is shown at once, and replaced when the
  // fresh one (made after this page opened) arrives, so new apps show up.
  var appsLoaded = false, listTries = 0, lastListError = '', openedAt = Date.now(), freshTries = 0;
  function loadApps() {
    call('luna://' + HELPER + '.settings.service/listApps', {}, function (r) {
      if (r && r.returnValue && r.apps && r.apps.length) {
        listTries = 0;
        if (!(typeof r.time === 'number' && r.time >= openedAt - 1000) && ++freshTries <= 10)
          setTimeout(loadFresh, 2000);
        return done(r.apps);
      }
      lastListError = r ? (r.errorText || '') : 'no reply';
      if (++listTries < 15) {
        note('Finding your apps...');
        setTimeout(loadApps, 2000);
        return;
      }
      listTries = 0;
      appsLoaded = false;
      done([]);
      note('Could not read your apps right now' + (lastListError ? ' (' + lastListError + ')' : '') +
        '. Close this screen and open it again to retry.');
    });
    function done(list) {
      if (list.length) { appsLoaded = true; note(''); }
      addApps(list);
      render();
      refreshTarget();
    }
  }
  function loadFresh() {
    call('luna://' + HELPER + '.settings.service/listApps', {}, function (r) {
      if (r && r.returnValue && r.apps && r.apps.length && typeof r.time === 'number' && r.time >= openedAt - 1000) {
        var focused = apps[listIndex] && apps[listIndex].id;
        addApps(r.apps);
        for (var i = 0; i < apps.length; i++) if (apps[i].id === focused) listIndex = i;
        render();
        return;
      }
      if (++freshTries <= 10) setTimeout(loadFresh, 2000);
    });
  }

  // Built-in line icons (our own), for LG Home and the button actions.
  var GLYPHS = {
    home: 'M3 11.5 12 4l9 7.5M5.5 10v10h4.5v-6h4v6h4.5V10',
    learn: 'M12 5v14M5 12h14',
    rename: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
    remap: 'M4 8h14l-3.5-3.5M20 16H6l3.5 3.5',
    forget: 'M4 7h16M9.5 7V4h5v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5'
  };
  function glyph(name) {
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 36 36" fill="none" stroke="#efe6dc" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + GLYPHS[name] + '"/></svg>');
  }
  function iconOf(id) {
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i].icon;
    return '';
  }
  // A button is called by the name it was given, or else by the number it sends.
  // Names are kept even for forgotten buttons, so learning one again brings
  // its name back.
  function buttonName(code) {
    if (typeof buttonNames[code] === 'string' && buttonNames[code]) return buttonNames[code];
    for (var i = 0; i < buttonList.length; i++)
      if (buttonList[i].code === code && buttonList[i].name) return buttonList[i].name;
    return 'Button ' + code;
  }
  function mappedApp(code) {
    for (var i = 0; i < buttonList.length; i++) if (buttonList[i].code === code) return buttonList[i].app;
    return null;
  }
  // What the list shows in each mode: { title, note, icon or glyph, selected, pick }.
  function rowsFor() {
    if (mode === 'buttons') {
      var out = [{ title: 'Learn a new button', note: 'press OK to start, then the button', glyph: 'learn', pick: startLearn }];
      buttonList.forEach(function (b) {
        out.push({ code: b.code, title: buttonName(b.code), note: 'opens ' + titleOf(b.app),
          icon: iconOf(b.app), glyph: b.app === LG_HOME ? 'home' : '',
          pick: function () { openButton(b.code); } });
      });
      return out;
    }
    if (mode === 'learning' || mode === 'rename') return [];
    if (mode === 'button') {
      var app = mappedApp(assignCode);
      return [
        { title: 'Rename this button', note: 'so you know which one it is', glyph: 'rename', pick: startRename },
        { title: 'Remap this button', note: 'now opens ' + titleOf(app), glyph: 'remap', pick: function () { assign(assignCode); } },
        { title: 'Forget this button', note: 'LG\'s own action again', glyph: 'forget', pick: function () { saveButton(''); } }
      ];
    }
    if (mode === 'assign') {
      var mapped = mappedApp(assignCode), list = [];
      apps.forEach(function (a) {
        list.push({ title: a.title, note: a.id === LG_HOME ? LG_HOME : a.id, icon: a.icon, glyph: a.glyph, selected: a.id === mapped,
          pick: function () { saveButton(a.id); } });
      });
      return list;
    }
    return apps.map(function (a) {
      return { title: a.title, note: a.note || a.id, icon: a.icon, glyph: a.glyph, selected: a.id === current,
        pick: function () { setTarget(a.id); } };
    });
  }

  var shown = [];
  function render() {
    var rows = $('rows');
    rows.innerHTML = '';
    shown = rowsFor();
    listIndex = Math.max(0, Math.min(listIndex, shown.length - 1));
    $('listLabel').textContent = { home: 'Installed apps', buttons: 'App buttons',
      learning: 'App buttons', assign: buttonName(assignCode) + ' opens', button: buttonName(assignCode),
      rename: 'Rename ' + buttonName(assignCode) }[mode];
    $('renameBox').style.display = mode === 'rename' ? '' : 'none';
    $('buttonsNav').textContent = mode === 'home' ? 'App buttons' : 'Back to the Home button';
    shown.forEach(function (a, i) {
      var row = document.createElement('div');
      row.className = 'app' + (a.selected ? ' selected' : '') +
        (zone === 'list' && i === listIndex ? ' focus' : '');
      var pic = document.createElement('span');
      pic.className = 'pic';
      if (a.glyph) {
        var g = document.createElement('img');
        g.src = glyph(a.glyph);
        pic.appendChild(g);
      } else if (a.icon) {
        var img = document.createElement('img');
        img.onerror = function () { if (img.parentNode) pic.removeChild(img); };
        pic.appendChild(img);
        loadIcon(a.icon, img);
      }
      row.appendChild(pic);
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.title;
      row.appendChild(name);
      var id = document.createElement('span');
      id.className = 'id';
      id.textContent = a.note || '';
      row.appendChild(id);
      row.onclick = function () { once(function () { listIndex = i; zone = 'list'; render(); a.pick(); }); };
      row.onmousemove = function () {
        if (!pointerMoved || (zone === 'list' && listIndex === i)) return;
        zone = 'list';
        listIndex = i;
        keepTop = true; // selecting with the pointer never scrolls the list under it
        render();
      };
      rows.appendChild(row);
    });
    // Show whole rows only: trim the list to a multiple of the row height.
    // Measured every time: the note above the list changes its height.
    var list = $('list');
    var space = $('main').getBoundingClientRect().bottom - list.getBoundingClientRect().top;
    list.style.flex = 'none';
    list.style.height = Math.max(ROW, Math.floor(space / ROW) * ROW) + 'px';
    var visible = Math.max(1, Math.floor(list.clientHeight / ROW));
    var top = keepTop ? listTop : listIndex - Math.floor(visible / 2);
    if (listIndex < top) top = listIndex;
    if (listIndex > top + visible - 1) top = listIndex - visible + 1;
    top = Math.max(0, Math.min(top, shown.length - visible));
    keepTop = false;
    listTop = top;
    rows.style.top = (-top * ROW) + 'px';
    var side = sideItems();
    sideIndex = Math.min(sideIndex, side.length - 1);
    for (var s = 0; s < side.length; s++)
      side[s].className = side[s].className.replace(/\s*focus/g, '') +
        (zone === 'side' && s === sideIndex ? ' focus' : '');
    if (mode === 'rename') return; // the name field keeps the keyboard
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  // App buttons. The helper learns and keeps them; this page asks it by
  // launching it with parameters and reads the result from its own service.
  function loadButtons(cb) {
    call('luna://' + HELPER + '.settings.service/buttons', {}, function (r) {
      if (r && r.returnValue && r.buttons) {
        buttonList = r.buttons;
        buttonNames = r.names && typeof r.names === 'object' ? r.names : {};
      }
      if (cb) cb(r);
      else render();
    });
  }
  function setMode(next) {
    mode = next;
    listIndex = 0;
    zone = 'list';
    if (next !== 'learning') stopLearnPoll();
    if (next === 'home') note(appsLoaded ? '' : $('listNote').textContent);
    else if (next !== 'learning') note('');
    render();
  }
  var learnPoll = null, learnStarted = 0, learnGiveUp = null;
  function stopLearnPoll() {
    if (learnPoll) { clearInterval(learnPoll); learnPoll = null; }
    if (learnGiveUp) { clearTimeout(learnGiveUp); learnGiveUp = null; } // never a stale one later
  }
  function startLearn() {
    if (!running) { message('Start Home Helper first: it does the listening.'); return; }
    clearInstruction();
    setMode('learning');
    note('Press the app button you want to change. Back cancels.');
    learnStarted = Date.now();
    launch(HELPER, { nativeHomeLearn: true }, function (ok) {
      if (!ok) { message('Could not reach Home Helper.'); setMode('buttons'); return; }
      stopLearnPoll();
      learnPoll = setInterval(checkLearn, 500);
      learnGiveUp = setTimeout(function () {
        learnGiveUp = null;
        if (mode === 'learning') { message('No button press arrived.'); setMode('buttons'); }
      }, 25000);
    });
  }
  function checkLearn() {
    loadButtons(function (r) {
      var l = r && r.learn;
      if (mode !== 'learning' || !l || l.time < learnStarted - 2000) return;
      if (l.state === 'learned' && typeof l.code === 'number') {
        assignCode = l.code;
        if (mappedApp(l.code)) { // already set up: its actions, not a new mapping
          message('This button is already set up.');
          openButton(l.code);
          return;
        }
        message('Button learned. Now choose the app it opens.', true);
        setMode('assign');
      } else if (l.state === 'timeout') {
        message('No button press arrived. Some buttons, like Voice, cannot be learned.');
        setMode('buttons');
      } else if (l.state === 'unavailable') {
        message('Home Helper is not running. Start it first.');
        setMode('buttons');
      }
    });
  }
  function cancelLearn() {
    launch(HELPER, { nativeHomeLearn: false });
    clearInstruction();
    setMode('buttons');
  }
  // A mapped button: rename, remap or forget it.
  function openButton(code) {
    assignCode = code;
    setMode('button');
  }
  // Back from choosing an app: a mapped button keeps its app.
  function leaveAssign() {
    clearInstruction();
    if (mappedApp(assignCode)) { setMode('button'); listIndex = 1; render(); } // back on Remap
    else setMode('buttons');
  }
  function assign(code) {
    assignCode = code;
    setMode('assign');
    for (var i = 0; i < shown.length; i++) if (shown[i].selected) listIndex = i;
    render();
  }
  function saveButton(id) {
    message('Saving...');
    launch(HELPER, { nativeHomeButton: { code: assignCode, app: id } }, function (ok) {
      message(!ok ? 'Could not reach Home Helper.' : id ?
        buttonName(assignCode) + ' now opens ' + titleOf(id) + '.' :
        buttonName(assignCode) + ' does LG\'s own action again.');
      setTimeout(function () { loadButtons(); }, 600);
      setMode('buttons');
    });
  }

  // Renaming: the TV's own keyboard types into the name field. OK on it saves,
  // Back cancels. An empty name gives the button back its number.
  function startRename() {
    clearInstruction();
    var input = $('nameInput'), named = buttonName(assignCode);
    setMode('rename');
    note('Type a name, like the logo on the button. Then press OK.');
    input.value = named === 'Button ' + assignCode ? '' : named;
    input.placeholder = 'Button ' + assignCode;
    setTimeout(function () { input.focus(); }, 50);
  }
  function saveName() {
    var name = $('nameInput').value.replace(/^\s+|\s+$/g, '').slice(0, 40), code = assignCode;
    $('nameInput').blur();
    message('Saving...');
    launch(HELPER, { nativeHomeButton: { code: code, name: name } }, function (ok) {
      if (ok) { if (name) buttonNames[code] = name; else delete buttonNames[code]; }
      message(!ok ? 'Could not reach Home Helper.' : name ? 'Saved. This button is now called ' + name + '.' :
        'Saved. This button is called Button ' + code + ' again.');
      setTimeout(function () { loadButtons(); }, 600);
    });
    setMode('buttons');
  }
  function cancelRename() {
    $('nameInput').blur();
    setMode('button');
  }
  $('nameSave').addEventListener('click', function (e) { e.preventDefault(); once(saveName); });
  $('nameCancel').addEventListener('click', function (e) { e.preventDefault(); once(cancelRename); });

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
      // No "Starting..." flash: the button and status change is the answer.
      launch(HELPER, { nativeHomeStart: true }, function (ok) {
        if (!ok) message('Could not start Home Helper.');
        if (ok) { watchPairing(); refreshTarget(); }
        setTimeout(refreshTarget, 1500);
        setTimeout(refreshTarget, 4000);
      });
    } else if (el.id === 'lghome') {
      // A one-off visit: the Home button keeps opening the chosen app. The
      // helper opens it, so it knows not to send you back.
      launch(HELPER, { nativeHomeVisitLG: true }, function (ok) {
        if (!ok) message('Could not open LG Home.');
      });
    } else if (el.id === 'reset') {
      setTarget('');
    } else if (el.id === 'buttonsNav') {
      if (mode === 'home') { loadButtons(); setMode('buttons'); }
      else {
        if (mode === 'learning') launch(HELPER, { nativeHomeLearn: false });
        if (mode === 'rename') $('nameInput').blur();
        if (mode === 'assign' || mode === 'button') clearInstruction();
        setMode('home');
      }
      zone = 'side';
    }
  }

  document.addEventListener('mousemove', function () { pointerMoved = true; }, true);
  document.addEventListener('mousedown', function () { pointerMoved = true; }, true);
  // The left-hand buttons follow the pointer and act on a click.
  function bindSide(el) {
    el.addEventListener('mousemove', function () {
      var side = sideItems(), i = side.indexOf(el);
      if (!pointerMoved || i < 0 || (zone === 'side' && sideIndex === i)) return;
      zone = 'side';
      sideIndex = i;
      render();
    });
    el.addEventListener('click', function (e) {
      e.preventDefault();
      el.blur();
      once(function () {
        var i = sideItems().indexOf(el);
        if (i < 0) return;
        zone = 'side';
        sideIndex = i;
        render();
        activateSide();
      });
    });
  }
  ['power', 'lghome', 'reset', 'buttonsNav'].forEach(function (id) { if ($(id)) bindSide($(id)); });
  // The wheel scrolls the list.
  document.addEventListener('wheel', function (e) {
    if (!shown.length || !e.deltaY) return;
    e.preventDefault();
    zone = 'list';
    listIndex = Math.max(0, Math.min(shown.length - 1, listIndex + (e.deltaY > 0 ? 1 : -1)));
    render();
  }, { passive: false });
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, sideCount = sideItems().length;
    if (mode === 'rename') { // keys type into the name field, except OK and Back
      if (k === 13) { e.preventDefault(); if (!e.repeat) once(saveName); }
      else if (k === 461 || k === 27) { e.preventDefault(); cancelRename(); }
      return;
    }
    if ([13, 27, 37, 38, 39, 40, 461].indexOf(k) >= 0) pointerMoved = false;
    if (k === 461 || k === 27) { // Back: one step back, then close
      e.preventDefault();
      if (mode === 'learning') { cancelLearn(); return; }
      if (mode === 'assign') { leaveAssign(); return; }
      if (mode === 'button') {
        var code = assignCode;
        clearInstruction();
        setMode('buttons');
        for (var i = 0; i < shown.length; i++) if (shown[i].code === code) listIndex = i;
        render();
        return;
      }
      if (mode === 'buttons') { setMode('home'); return; }
      if (window.webOSSystem && webOSSystem.platformBack) webOSSystem.platformBack();
      else if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack();
      else window.close();
      e.preventDefault();
      return;
    }
    if (k === 37 && zone === 'list') zone = 'side';
    else if (k === 39 && zone === 'side' && shown.length) zone = 'list';
    else if (k === 38) {
      if (zone === 'list') listIndex = Math.max(0, listIndex - 1);
      else sideIndex = Math.max(0, sideIndex - 1);
    } else if (k === 40) {
      if (zone === 'list') listIndex = Math.min(shown.length - 1, listIndex + 1);
      else sideIndex = Math.min(sideCount - 1, sideIndex + 1);
    } else if (k === 13) {
      if (!e.repeat)
        once(function () {
          if (zone === 'list' && shown[listIndex]) shown[listIndex].pick();
          else if (zone === 'side') activateSide();
        });
    } else return;
    e.preventDefault();
    render();
  });
  // Opening the settings app again usually brings this page back instead of
  // loading it anew. That is a new visit: the helper reads a fresh list now,
  // so wait for it as on first open (new and removed apps show up).
  var lastVisit = Date.now();
  function newVisit() {
    var now = Date.now();
    refreshTarget();
    if (now - lastVisit < 1000) return; // relaunch and visibility arrive together
    lastVisit = now;
    openedAt = now;
    freshTries = 0;
    setTimeout(loadFresh, 2000);
  }
  document.addEventListener('webOSRelaunch', newVisit);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) newVisit();
  });

  // Show the LG Home entry at once; the status check loads the app list when
  // the helper is paired, or explains what to do.
  addApps([]);
  render();
  refreshTarget();
})();
