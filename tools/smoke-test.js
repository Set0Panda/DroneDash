// Drone Dash smoke test.
// Runs inside the game page (any copy: live site or local server) and returns a JSON report
// of every error thrown plus what was exercised. Run it with tools/run-smoke.ps1, or paste it
// into the browser console on the game page.
//
// What it does:
//   1. Menus on the real page: home, colour picker, records, how to play, language picker.
//   2. Translations: every text key of English is present in all 12 languages.
//   3. A long run (levels 1 to 26, all five areas) driven by a simple bot that dodges, fires,
//      pauses, opens How to Play mid-run and toggles auto-fire. Lives/fuel are topped up so the
//      run can reach the late levels; game frames are stepped as fast as possible.
//   4. A normal run with the real rules until game over, then the game-over screen and Records.
(async () => {
  const report = { url: location.href, errors: [], checks: {}, stats: {} };
  const err = (where, e) => report.errors.push(where + ': ' + (e && (e.stack || e.message) || String(e)).split('\n').slice(0, 3).join(' | '));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const folder = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');

  // ---------- 1. Menus on the real page ----------
  try {
    const $ = id => document.getElementById(id);
    const shown = id => $(id) && !$(id).classList.contains('hidden');
    report.checks.homeShown = shown('home');
    $('garageBtn').click(); await sleep(200); report.checks.garageOpens = shown('garage'); $('garageDone').click();
    $('recordsBtn').click(); await sleep(200); report.checks.recordsOpen = shown('records'); $('recBack').click();
    $('helpBtn').click(); await sleep(200); report.checks.helpOpens = shown('intro'); $('startBtn').click(); await sleep(200);
    report.checks.helpClosesToHome = shown('home');
    $('langBtn').click(); await sleep(150); report.checks.langMenuOpens = !$('langMenu').hidden;
    $('langBtn').click();
  } catch (e) { err('menus', e); }

  // ---------- load a test copy of the page we can drive frame by frame ----------
  const page = await fetch(folder + 'index.html?smoke=' + Date.now(), { cache: 'no-store' }).then(r => r.text());
  async function load(patches) {
    let src = page;
    for (const [a, b] of patches) {
      if (!src.includes(a)) { report.errors.push('test patch no longer matches the game code: ' + a.slice(0, 60)); continue; }
      src = src.replace(a, b);
    }
    src = src.replace('<head>', '<head><base href="' + folder + '">' +
      "<script>(()=>{let T=0,cbs=[];window.__errs=[];window.requestAnimationFrame=f=>{cbs.push(f)};" +
      "window.step=n=>{for(let i=0;i<n;i++){const c=cbs;cbs=[];T+=1000/30;c.forEach(f=>f(T))}};" +
      "window.addEventListener('error',e=>window.__errs.push(e.message));" +
      "window.addEventListener('unhandledrejection',e=>window.__errs.push('promise: '+(e.reason&&e.reason.message||e.reason)));})()<\/script>");
    document.open(); document.write(src); document.close();
    await sleep(400);
  }
  const common = [
    // a hook to read game state
    ["let carNo = 7;", "let carNo = 7; window.__end = () => gameOver('fuel'); window.__G = () => ({ state, level, lives, fuel, wallet, kills, coins, objects, drones, rockets, player, laneW, lookArea, combo, mult: comboMult(), odPhase, overdrives, bossesRun, bossLane: boss ? Math.max(0, Math.min(2, Math.round((boss.x - vergeW - laneW / 2) / laneW))) : -1, bossCharge: boss && boss.charge ? boss.charge.lanes : [] });"],
    // translations table, for the language check
    ["const STR = {", "const STR = window.__STR = {"],
    // a hook to drive the giant Shahed code directly
    ["const rocketPower = () =>", "window.__T = { down: () => bossDown(), setRun: n => { bossesRun = n; }, draw: tier => drawGiantShahed(0, 0, 0, tier), finale: () => raidFinale, power: () => rocketPower(), boss: () => !!boss }; const rocketPower = () =>"],
    // count what happened, by the floating texts the game shows
    ["function floatText(x, y, text, color) {", "function floatText(x, y, text, color) { (window.__floats = window.__floats || []).push(text);"],
    // a hidden test window must not pause itself
    ["if (document.hidden) { pauseGame(); sfx.suspend(); }", "if (document.hidden) { sfx.suspend(); }"],
  ];
  const $ = id => document.getElementById(id);
  const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const stepSafe = n => { for (let i = 0; i < n; i++) { try { step(1); } catch (e) { err('frame', e); } } };

  // simple bot: leave the lane if an obstacle is coming, prefer a free neighbour
  function drive() {
    const g = __G(); if (!g.player) return;
    const danger = lane => g.objects.some(o => (o.type === 'enemy' || o.type === 'hole') && !o.dead && !o.used && (o.fx !== undefined ? Math.abs(o.fx - lane) < 0.9 : o.lane === lane) &&
      o.y + o.h > g.player.y - 230 && o.y < g.player.y + g.player.h)
      || g.drones.some(d => d.bomb && !d.dead && d.lane === lane) || g.bossCharge.includes(lane);   // a giant Shahed's bombs and the lanes it's charging
    if (!danger(g.player.lane)) {
      // giant Shahed: slide under it when the way is clear, and fire once lined up
      if (g.bossLane >= 0) {
        let want = g.bossLane;                                                   // short of a rocket: go for the nearest coin
        if (g.wallet < 3) { const c = g.objects.filter(o => o.type === 'coin' && o.y < g.player.y && o.y > g.player.y - 400).sort((a, b) => b.y - a.y)[0]; if (c) want = c.lane; }
        if (want === g.player.lane) { if (want === g.bossLane && g.wallet >= 3) $('rocketBtn').click(); }
        else { const d = want < g.player.lane ? -1 : 1; if (!danger(g.player.lane + d)) key(d < 0 ? 'ArrowLeft' : 'ArrowRight'); }
      }
      return;
    }
    for (const d of [-1, 1, -2, 2]) {
      const l = g.player.lane + d;
      if (l >= 0 && l <= 2 && !danger(l)) { key(d < 0 ? 'ArrowLeft' : 'ArrowRight'); if (Math.abs(d) === 2) key(d < 0 ? 'ArrowLeft' : 'ArrowRight'); return; }
    }
  }

  // ---------- 2. Translations ----------
  try {
    await load(common);
    const STR = window.__STR, en = Object.keys(STR.en), missing = {};
    for (const [lang, table] of Object.entries(STR)) {
      const m = en.filter(k => !(k in table));
      if (m.length) missing[lang] = m;
    }
    report.checks.languages = Object.keys(STR).length;
    report.checks.missingTranslations = Object.keys(missing).length ? missing : 'none';
    for (const lang of Object.keys(STR)) { I18N.set(lang); }   // apply every language once
    I18N.set('auto');
    if (window.__errs.length) report.errors.push(...window.__errs.map(m => 'languages: ' + m));
  } catch (e) { err('languages', e); }

  // ---------- 3. Long run, levels 1 to 52 (every area, hazard and car upgrade) ----------
  try {
    await load([...common,
      ["fuel = Math.max(0, fuel - fuelDrain(level) * fuelEase * runDiff.speed * dt);", "fuel = Math.max(60, fuel - fuelDrain(level) * fuelEase * runDiff.speed * dt);"],
      ["if (lives <= 0) gameOver('crash');", "if (lives <= 0) lives = MAX_LIVES;"],
      ["function saveRun(run) {", "function saveRun(run) { return false;"]]);
    const seen = { areas: new Set(), skins: new Set(), holeSkins: new Set(), paths: new Set(), states: new Set() };
    $('playBtn').click(); if (!$('intro').classList.contains('hidden')) $('startBtn').click();
    let frames = 0, maxLevel = 1, maxMult = 1, odFrames = 0;
    while (frames < 60000 && __G().level < 52) {
      drive();
      const g = __G();
      if (g.wallet >= 3 && Math.random() < 0.02) $('rocketBtn').click();
      if (frames % 900 === 450) {                         // pause, read How to Play, resume
        $('pauseBtn').click(); stepSafe(3);
        $('pauseHelp').click(); stepSafe(3); $('startBtn').click(); stepSafe(2);
        $('resumeBtn').click();
      }
      if (frames % 1700 === 850) $('autoChip').click();   // toggle auto-fire mid-run
      stepSafe(1); frames++;
      seen.areas.add(g.lookArea); seen.states.add(g.state);
      for (const o of g.objects) { if (o.type === 'enemy') seen.skins.add(o.skin); if (o.type === 'hole') seen.holeSkins.add(o.skin); }
      for (const d of g.drones) seen.paths.add(d.path);
      maxLevel = Math.max(maxLevel, g.level); maxMult = Math.max(maxMult, g.mult); if (g.odPhase) odFrames++;
    }
    const f = window.__floats || [];
    const count = s => f.filter(x => x.includes(s)).length;
    report.stats.longRun = {
      frames, reachedLevel: maxLevel, areasSeen: [...seen.areas].sort().join(','), obstacleLooks: [...seen.skins].sort().join(','),
      potholeLooks: [...seen.holeSkins].sort().join(','), dronePaths: [...seen.paths].sort().join(','),
      shotDown: count('SHOT DOWN'), missed: count('MISS'), smashed: count('SMASHED'), closeCalls: count('CLOSE'),
      dodged: count('DODGED'), heartsGrabbed: count('+1 ♥'), kills: __G().kills, coins: __G().coins,
      maxCombo: 'x' + maxMult, overdrives: __G().overdrives, overdriveFrames: odFrames, giantShahedsDown: __G().bossesRun,
    };
    // the long run passes every area: all ten landmarks collected, all nine big Shaheds met
    { const lm = JSON.parse(localStorage.getItem('ddLandmarks') || '[]'), met = JSON.parse(localStorage.getItem('ddShahedsMet') || '[]');
      report.stats.longRun.landmarksSeen = lm.length; report.stats.longRun.shahedsMet = met.length;
      if (lm.length < 9) report.errors.push('long run: only ' + lm.length + ' landmarks seen');
      if (met.length < 9) report.errors.push('long run: only ' + met.length + ' big Shaheds met'); }
    if (window.__errs.length) report.errors.push(...window.__errs.map(m => 'long run: ' + m));
  } catch (e) { err('long run', e); }

  // ---------- 4. Normal run until game over, then game over and records ----------
  try {
    await load(common);
    const starsBefore = (() => { try { return JSON.parse(localStorage.getItem('ddMissions') || '{}').stars || 0; } catch { return 0; } })();
    $('playBtn').click(); if (!$('intro').classList.contains('hidden')) $('startBtn').click();
    let frames = 0;
    while (frames < 30000 && $('over').classList.contains('hidden')) { drive(); stepSafe(1); frames++; }
    const survived = $('over').classList.contains('hidden');   // the bot can outlast the frame budget: end the run here
    if (survived) { window.__end(); stepSafe(5); }
    report.stats.normalRun = { frames, survived, endedWithGameOver: !$('over').classList.contains('hidden'),
      level: __G().level, journeyLine: $('overTrip').textContent, title: $('overTitle').textContent };
    // Missions: the runs so far should have finished some and shown them on game over
    try { const m = JSON.parse(localStorage.getItem('ddMissions') || '{}'); report.checks.missionStars = m.stars || 0; report.checks.missionsActive = (m.active || []).length; } catch (e) { err('missions', e); }
    // the game-over missions box shows exactly when a mission was finished in this run
    { const after = (() => { try { return JSON.parse(localStorage.getItem('ddMissions') || '{}').stars || 0; } catch { return 0; } })();
      const shown = !$('overMissions').hidden, finished = after > starsBefore;
      report.checks.missionsOnGameOver = shown === finished ? (finished ? 'shown, ' + (after - starsBefore) + ' finished' : 'none finished, box hidden') : 'WRONG';
      if (shown !== finished) report.errors.push('game-over missions box ' + (shown ? 'shown with nothing finished' : 'hidden after finishing a mission')); }
    // Share: no share sheet in a hidden test window, so it copies the text instead
    try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); } catch (e) {}
    try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); } catch (e) {}
    HTMLAnchorElement.prototype.click = function () {};          // don't download the picture
    $('over').classList.contains('hidden') || $('shareBtn').click();
    $('retryBtn').click(); stepSafe(60);
    report.checks.retryStartsPlaying = __G().state === 'play';
    $('pauseBtn').click(); $('pauseHome').click(); stepSafe(5);
    // Daily challenge: starts with its banner, plays, ends on its own game over line
    $('dailyBtn').click();
    if (!$('intro').classList.contains('hidden')) $('startBtn').click();
    const dailyText = $('banner').textContent;
    report.checks.dailyBanner = dailyText.includes('\u{1F4C5}') || dailyText;
    stepSafe(5);
    let df = 0; while (df < 30000 && $('over').classList.contains('hidden')) { drive(); stepSafe(1); df++; }
    if ($('over').classList.contains('hidden')) { window.__end(); stepSafe(5); }   // outlasted the budget: end it here
    report.checks.dailyGameOver = !$('over').classList.contains('hidden') && !$('overDaily').hidden;
    $('shareBtn').click(); await sleep(600);
    report.checks.shareCopiesText = !!(window.__copied && window.__copied.includes('Drone Dash'));
    // Shahed Raid: straight into the giant Shaheds, one after another
    $('homeBtn').click(); $('raidBtn').click();
    report.checks.raidBriefing = !$('raidHelp').classList.contains('hidden');
    $('raidGo').click(); stepSafe(100);
    $('pauseBtn').click(); $('pauseHelp').click(); report.checks.raidHelpFromPause = !$('raidHelp').classList.contains('hidden');
    $('raidGo').click(); $('resumeBtn').click();
    let rf = 0; while (rf < 20000 && $('over').classList.contains('hidden')) { drive(); stepSafe(1); rf++; }
    report.checks.raid = { frames: rf, giantShahedsDown: __G().bossesRun, title: $('overTitle').textContent, line: $('overDaily').textContent };
    $('homeBtn').click(); $('recordsBtn').click(); await sleep(200);
    report.checks.recordsRows = document.querySelectorAll('#recList li').length;
    // tabs: each shows its own content and the tab row doesn't move
    await sleep(450);                                                 // let the card finish sliding in first
    const tabTop = () => Math.round($('recTabs').getBoundingClientRect().top), top0 = tabTop(), tabs = {};
    for (const tb of ['raid', 'daily', 'runs']) {
      document.querySelector('#recTabs [data-tab=' + tb + ']').click(); await sleep(150);
      tabs[tb] = (tb === 'raid' ? document.querySelectorAll('#recRaidBox .recRow').length + ' rows'
        : tb === 'daily' ? document.querySelectorAll('#recDailyBox .recRow').length + ' rows'
        : document.querySelectorAll('#recList li').length + ' runs') + (Math.abs(tabTop() - top0) <= 2 ? '' : ' (tabs moved ' + top0 + ' to ' + tabTop() + ')');
    }
    report.checks.recordsTabs = tabs;
    if (Object.values(tabs).some(v => v.includes('moved'))) report.errors.push('records tabs moved when switching');
    $('recBack').click();
    if (window.__errs.length) report.errors.push(...window.__errs.map(m => 'normal run: ' + m));
  } catch (e) { err('normal run', e); }

  // ---------- 5. Touch controls: thumbstick, tap to fire, Controls setting ----------
  try {
    localStorage.setItem('ddCtrl', 'thumb');
    await load(common);
    const c = {}, G = () => __G();
    c.stickShown = $('eggBar').classList.contains('stick');
    $('playBtn').click(); if (!$('intro').classList.contains('hidden')) $('startBtn').click();
    const st = $('stick'); st.setPointerCapture = () => {};
    const r = st.getBoundingClientRect(), y = r.top + r.height / 2, cx = r.left + r.width / 2;
    const pe = (type, x) => st.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 5, pointerType: 'touch', bubbles: true, cancelable: true }));
    const slide = to => { pe('pointerdown', cx); for (let i = 1; i <= 10; i++) { pe('pointermove', cx + (to - cx) * i / 10); stepSafe(1); } pe('pointerup', to); stepSafe(2); };
    const lane0 = G().player.lane;
    slide(r.left + 4); c.noSteerInCountdown = G().player.lane === lane0;
    let n = 0; while (G().state !== 'play' && n < 400) { stepSafe(1); n++; }
    slide(r.left + 4); c.slideLeft = G().player.lane === 0;
    slide(r.right - 4); c.slideRight = G().player.lane === 2;
    c.knobOnLane = /translateX\((\d|[1-9])/.test($('stickKnob').style.transform);     // resting right of centre
    // tap with nothing to aim at: a straight shot for 1 coin
    n = 0; while (G().wallet < 3 && n < 4000) { drive(); stepSafe(1); n++; }
    const shahedUp = () => G().drones.some(d => !d.dead);
    n = 0; while (shahedUp() && n < 600) { stepSafe(1); n++; }
    if (!shahedUp()) { const w = G().wallet, k = G().rockets.length; pe('pointerdown', cx); stepSafe(1); pe('pointerup', cx); const rk = G().rockets[G().rockets.length - 1];
      c.emptyShot = G().rockets.length <= k ? 'did not fire' : (rk.straight ? 'straight' : 'at a barrier') + ', cost ' + (w - G().wallet); }
    // a Shahed up: touching the stick fires at once
    n = 0; while (!shahedUp() && G().state === 'play' && n < 6000) { drive(); stepSafe(1); n++; }
    if (shahedUp() && G().wallet >= 6) {
      await new Promise(r => setTimeout(r, 500));                      // the thumb has been resting a while
      const k = G().rockets.length; pe('pointerdown', cx); c.restNoFire = G().rockets.length === k;   // landing again: steers, no shot
      pe('pointerup', cx); c.restTapFires = G().rockets.length > k;                                     // ...but a quick tap still fires
      const k2 = G().rockets.length; pe('pointerdown', cx); c.fireOnTouch = G().rockets.length > k2; pe('pointerup', cx);   // tapping away: fires on press
    }
    // switching Controls back to Tap lane brings the FIRE button back
    $('ctrlBtn').click(); c.tapLaneSwitch = !$('eggBar').classList.contains('stick') && localStorage.getItem('ddCtrl') === 'lane';
    report.checks.controls = c;
    for (const [k, v] of Object.entries(c)) if (v === false || v === 'did not fire') report.errors.push('controls: ' + k);
    if (c.emptyShot && !['straight, cost 1', 'at a barrier, cost 3'].includes(c.emptyShot)) report.errors.push('controls: shot ' + c.emptyShot);
    if (window.__errs.length) report.errors.push(...window.__errs.map(m => 'controls: ' + m));
  } catch (e) { err('controls', e); }
  try { localStorage.removeItem('ddCtrl'); } catch {}

  // ---------- 6. Giant Shahed looks and the raid finale ----------
  try {
    await load(common);
    const f = {};
    // every look draws, and how long each takes (a rough guide to cost on slower phones)
    f.drawMs = {};
    for (let tier = 0; tier < 9; tier++) {
      const t0 = performance.now(); for (let i = 0; i < 300; i++) __T.draw(tier);
      f.drawMs[['shahed', 'desert', 'black', 'night', 'hunter', 'armoured', 'jet', 'carrier', 'mothership'].at(tier)] = +((performance.now() - t0) / 300).toFixed(3);
    }
    // the last giant Shahed of a raid: no Overdrive, the car drives off, then "Raid complete"
    $('raidBtn').click(); $('raidGo').click();
    let n = 0; while (!__T.boss() && n < 3000) { stepSafe(1); n++; }
    f.bossArrived = __T.boss();
    __T.setRun(8); __T.down();
    f.finaleStarts = __T.finale() > 0 && !G_od();
    f.power = __T.power();
    n = 0; while ($('over').classList.contains('hidden') && n < 300) { stepSafe(1); n++; }
    f.endsInResults = !$('over').classList.contains('hidden') && $('overTitle').textContent === __STR.en.raidDone;
    f.secondsToResults = +(n / 30).toFixed(1);
    report.checks.raidFinale = f;
    for (const k of ['bossArrived', 'finaleStarts', 'endsInResults']) if (!f[k]) report.errors.push('raid finale: ' + k);
    if (window.__errs.length) report.errors.push(...window.__errs.map(m => 'raid finale: ' + m));
  } catch (e) { err('raid finale', e); }

  function G_od() { try { return !!__G().odPhase; } catch { return false; } }
  report.result = report.errors.length ? 'ERRORS FOUND: ' + report.errors.length : 'PASS: no errors';
  return JSON.stringify(report, null, 1);
})()
