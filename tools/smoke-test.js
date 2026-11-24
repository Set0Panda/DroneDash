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
    ["let carNo = 7;", "let carNo = 7; window.__G = () => ({ state, level, lives, fuel, wallet, kills, coins, objects, drones, rockets, player, laneW, lookArea, streak });"],
    // translations table, for the language check
    ["const STR = {", "const STR = window.__STR = {"],
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
      o.y + o.h > g.player.y - 230 && o.y < g.player.y + g.player.h);
    if (!danger(g.player.lane)) return;
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
      ["fuel = Math.max(0, fuel - fuelDrain(level) * dt);", "fuel = Math.max(60, fuel - fuelDrain(level) * dt);"],
      ["if (lives <= 0) gameOver('crash');", "if (lives <= 0) lives = MAX_LIVES;"],
      ["function saveRun(run) {", "function saveRun(run) { return false;"]]);
    const seen = { areas: new Set(), skins: new Set(), holeSkins: new Set(), paths: new Set(), states: new Set() };
    $('playBtn').click(); if (!$('intro').classList.contains('hidden')) $('startBtn').click();
    let frames = 0, maxLevel = 1;
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
      maxLevel = Math.max(maxLevel, g.level);
    }
    const f = window.__floats || [];
    const count = s => f.filter(x => x.includes(s)).length;
    report.stats.longRun = {
      frames, reachedLevel: maxLevel, areasSeen: [...seen.areas].sort().join(','), obstacleLooks: [...seen.skins].sort().join(','),
      potholeLooks: [...seen.holeSkins].sort().join(','), dronePaths: [...seen.paths].sort().join(','),
      shotDown: count('SHOT DOWN'), missed: count('MISS'), smashed: count('SMASHED'), closeCalls: count('CLOSE'),
      dodged: count('DODGED'), heartsGrabbed: count('+1 ♥'), kills: __G().kills, coins: __G().coins,
    };
    if (window.__errs.length) report.errors.push(...window.__errs.map(m => 'long run: ' + m));
  } catch (e) { err('long run', e); }

  // ---------- 4. Normal run until game over, then game over and records ----------
  try {
    await load(common);
    $('playBtn').click(); if (!$('intro').classList.contains('hidden')) $('startBtn').click();
    let frames = 0;
    while (frames < 30000 && $('over').classList.contains('hidden')) { drive(); stepSafe(1); frames++; }
    report.stats.normalRun = { frames, endedWithGameOver: !$('over').classList.contains('hidden'),
      level: __G().level, journeyLine: $('overTrip').textContent, title: $('overTitle').textContent };
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
    report.checks.dailyGameOver = !$('over').classList.contains('hidden') && !$('overDaily').hidden;
    $('shareBtn').click(); await sleep(600);
    report.checks.shareCopiesText = !!(window.__copied && window.__copied.includes('Drone Dash'));
    $('homeBtn').click(); $('recordsBtn').click(); await sleep(200);
    report.checks.recordsRows = document.querySelectorAll('#recList li').length;
    $('recBack').click();
    if (window.__errs.length) report.errors.push(...window.__errs.map(m => 'normal run: ' + m));
  } catch (e) { err('normal run', e); }

  report.result = report.errors.length ? 'ERRORS FOUND: ' + report.errors.length : 'PASS: no errors';
  return JSON.stringify(report, null, 1);
})()
