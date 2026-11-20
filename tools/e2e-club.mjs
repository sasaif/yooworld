import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Yoo Games Club end-to-end on a phone-landscape TOUCH viewport, real localStorage, real taps:
//  A. home → Carte → Centre-ville → Yoo Games Club → Visiter (fade) → table menu → setup → sit → FULL game vs bots → results
//     (bots = seated YooWorld avatars, no floating bot labels; active turn ring / chip / "À toi de jouer" / thinking dots)
//  B. "Rejouer": same table, same setup, the same bot avatars stay seated
//  C. leave during a bot turn: confirm dialog pauses the bots, "Rester" resumes, "Quitter" tears everything down
//  D. 3 players, match in 100 points: leave BETWEEN ROUNDS (confirm) → clean
//  E. "Changer de partie" from the results → setup sheet (still seated) → new game → leave FROM THE RESULTS (no confirm)
//  F. travel away mid-game (map fade) → table closed, bots gone; back to the club via the dock → a new game starts
//  G. long chain (fixed deal ?clubseed=2, 2 players → 27 tiles): readable tile size, snake rows, nothing clipped
// Also: badge, never "multijoueur", no Gold earned, club never saved, draw calls / triangles of the MAIN pass (≤ 40 / < 100k; window.__info.calls is the total incl. shadow pass, counted since UAT), avatar
// size, no table timer left after leaving, 0 console errors.
// usage: DEV=iphone15|se PLAYERS=2|3|4 [SHOTS=dir] [BOTMS=150] node tools/e2e-club.mjs http://127.0.0.1:5391/
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5391'}/`;
const DEVS = { iphone15: { w: 852, h: 393 }, se: { w: 667, h: 375 } };
const DEV = process.env.DEV ?? 'iphone15'; const dev = DEVS[DEV]; const SHOTS = process.env.SHOTS; const BOTMS = process.env.BOTMS ?? '150';
const N = Number(process.env.PLAYERS ?? 4);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errs = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
let fails = 0, passes = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } else passes++; };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${DEV}_${N}p_${name}.png` }); };
const q = (u, extra = '') => u + (u.includes('?') ? '&' : '?') + `botms=${BOTMS}` + extra;
const ready = () => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
const ev = (f, a) => p.evaluate(f, a);
const info = () => ev(() => window.__info);
const waitFresh = async () => { await p.waitForTimeout(1400); }; // __info refreshes every 500 ms of frames (slow software GL)
await p.goto(q(url)); await ready();
await ev(() => localStorage.clear()); await p.reload(); await ready(); await p.waitForTimeout(2500);
ok(await ev(() => window.game.s.location) === 'home', 'starts at home');
const gold0 = await ev(() => window.economy.goldBalance());
const homePx = await ev(() => window.__metrics?.()[window.game.s.activeChar]?.screenH ?? 0);
const perfRows = [];
async function gotoClubByDock() {
  await p.tap('.dock button[data-map="dock"]');
  await p.waitForSelector('[data-map="root"].visible', { timeout: 10000 });
  // two-level map: city → Centre-ville district → Yoo Games Club card → Visiter
  await p.tap('[data-map-district="center"]');
  await p.waitForSelector('[data-map="root"][data-map-level="2"] [data-map-card="club"]', { timeout: 5000 });
  ok(await p.locator('[data-map-card="club"]').innerText().then((t) => t.includes('Yoo Games Club') && t.includes('Ouvert')), 'Carte → Centre-ville lists Yoo Games Club as Ouvert');
  const go = p.locator('[data-map-go="club"]');
  ok(await go.isEnabled(), 'Visiter is enabled for the Games Club');
  await go.tap();
  await p.waitForFunction(() => window.game.s.location === 'club' && !window.game.s.transition, null, { timeout: 30000 }).then(() => ok(true, 'arrived at the Games Club after the fade'), () => ok(false, 'arrived at the Games Club'));
  await p.waitForTimeout(3500);
}
async function openSetup(players, mode) {
  await ev(() => window.game.store.set({ menuItem: 't_dominoes' })); await p.waitForTimeout(500);
  const playBtn = p.locator('.imenu button[data-act="play"]'); ok(await playBtn.count() === 1, 'table menu offers "Jouer aux dominos"');
  await playBtn.dispatchEvent('click'); await p.waitForTimeout(400);
  ok(await p.locator('[data-club="setup"]').count() === 1, 'setup sheet opens');
  await p.tap(`[data-players="${players}"]`); await p.tap(`[data-mode="${mode}"]`);
}
async function startFromSheet(players) {
  await p.tap('[data-club="start"]');
  const t0 = Date.now();
  await p.waitForFunction(() => window.club.s.session?.phase === 'playing', null, { timeout: 60000 }).then(() => ok(true, `avatar walks to the table, sits, game starts (${Date.now() - t0} ms)`), () => ok(false, 'avatar sits and the game starts'));
  await p.waitForTimeout(1800); // bots finish their sit-down transition
  const st = await ev(() => ({ me: (() => { const c = window.__world.chars[window.game.s.activeChar]; return { mode: c.mode, seat: c.sitOn?.id }; })(),
    bots: window.club.s.bots.map((b) => { const c = window.__world.chars[b.id]; return { id: b.id, mode: c?.mode, seat: c?.sitOn?.id, chair: b.chair }; }) }));
  ok(st.me.mode === 'sitting' && /^t_dominoes_.:0$/.test(st.me.seat ?? ''), 'player seated on a domino-table chair ' + st.me.seat);
  ok(st.bots.length === players - 1 && st.bots.every((x) => x.mode === 'sitting' && x.seat === `${x.chair}:0`), `${players - 1} bot avatars seated on their chairs ${JSON.stringify(st.bots.map((x) => x.mode + '@' + x.seat))}`);
  return st;
}
/** play with real taps until `stop(state)` is true or the game is over */
async function play(stop = () => false, onMove = async () => {}) {
  let moves = 0, draws = 0, passes = 0; const t0 = Date.now(); let sawThinking = false, sawCue = false, sawRing = false;
  while (Date.now() - t0 < 480000) {
    const st = await ev(() => { const s = window.club.s.session; if (!s) return { gone: true }; const st = s.host.state; return { phase: s.phase, turn: st.phase === 'playing' ? st.turn : null, gp: st.phase, legal: s.host.legal(0).length, line: st.line.length, thinking: s.host.thinking }; });
    if (st.gone || st.phase === 'results') break;
    if (await stop(st)) return { moves, draws, passes, stopped: true, sawThinking, sawCue, sawRing };
    if (st.gp === 'roundOver') { await p.tap('[data-club="next"]'); continue; }
    if (st.turn !== 0 || !st.legal) {
      if (!sawThinking && st.thinking > 0) sawThinking = await p.locator(`.dom-p.turn[data-seat="${st.thinking}"] [data-club="thinking"]`).count() === 1;
      await p.waitForTimeout(60); continue;
    }
    if (!sawCue) sawCue = await p.locator('[data-club="yourturn"]').count() === 1 && await p.locator('.dom-bottom.me').count() === 1 && await p.locator('.dom-p.me.turn').count() === 1;
    if (!sawRing) sawRing = await ev(() => { let r = window.__cam; while (r.parent) r = r.parent; let seat = null; r.traverse((o) => { if (o.userData?.clubTurnSeat !== undefined) seat = o.userData.clubTurnSeat; }); return seat === 0; });
    const tile = p.locator('.dom-tile.ok').first();
    if (await tile.count()) {
      await tile.tap(); await p.waitForTimeout(60);
      const end = p.locator('.dom-end').first(); if (await end.count()) await end.tap();
      moves++; await onMove(moves);
    } else if (await p.locator('[data-club="draw"]').count()) { await p.tap('[data-club="draw"]'); draws++; }
    else if (await p.locator('[data-club="pass"]').count()) { await p.tap('[data-club="pass"]'); passes++; }
    await p.waitForTimeout(100);
  }
  return { moves, draws, passes, stopped: false, sawThinking, sawCue, sawRing };
}
async function cleanAfterLeave(label) {
  await p.waitForTimeout(2600);
  const s = await ev(() => ({ ses: !!window.club.s.session, bots: window.club.s.bots.length, chars: Object.keys(window.__world.chars), t: window.club.debugTimers(), mode: window.__world.chars[window.game.s.activeChar].mode, confirm: window.club.s.confirmLeave }));
  ok(!s.ses && !s.confirm, `${label}: table closed`);
  ok(s.bots === 0 && s.chars.every((c) => !c.startsWith('bot_')), `${label}: bot avatars stood up and left (${s.chars.join(',')})`);
  ok(Object.values(s.t).every((x) => !x), `${label}: no table timer / subscription left ${JSON.stringify(s.t)}`);
  return s;
}

// ---------- A. full game ----------
await gotoClubByDock();
await waitFresh(); let i0 = await info(); const mainTri = (i) => i.triangles - (i.trianglesShadow ?? 0); const mainCalls = (i) => i.callsMain ?? i.calls;
perfRows.push(['club idle', i0.calls, i0.callsMain, i0.callsShadow, i0.triangles, i0.trianglesShadow]);
ok(mainCalls(i0) > 0 && mainCalls(i0) <= 40, `club idle main-pass draw calls ≤ 40 (${mainCalls(i0)} main + ${i0.callsShadow ?? 0} shadow = ${i0.calls} total)`); ok(mainTri(i0) < 100000, `club idle main-pass triangles < 100k (${mainTri(i0)}; ${i0.triangles} incl. shadow)`);
const av = await ev(() => window.__metrics?.()[window.game.s.activeChar]?.screenH ?? 0);
ok(Math.abs(av - homePx) <= 3 && (DEV !== 'iphone15' || Math.abs(av - 93) <= 4), `avatar size unchanged vs the apartment (club ${av} px, home ${homePx} px; ~93 px on iPhone 15)`);
ok(await p.locator('.dock', { hasText: 'Décorer' }).count() === 0, 'apartment-only buttons hidden in the club');
await shot('1_club');
await openSetup(N, 'single');
ok(await p.locator('.imenu', { hasText: 'Mode local · contre des bots' }).count() + await p.locator('[data-club="badge-setup"]', { hasText: 'Mode local · contre des bots' }).count() >= 1, 'local badge on the table menu / setup');
await shot('2_setup');
const A = await startFromSheet(N);
ok(await p.locator('[data-club="badge"]', { hasText: 'Mode local · contre des bots' }).count() === 1, 'table overlay shows "Mode local · contre des bots"');
ok(await p.locator('.dock').count() === 0 && await p.locator('.joy:not(.joy-hidden)').count() === 0, 'dock and joystick hidden while seated at the table');
ok(!(await ev(() => document.body.innerText)).match(/multijoueur|multiplayer/i), 'never says multiplayer');
ok(await p.locator('.bot-tag').count() === 0, 'no floating bot-only labels');
const tags = await ev(() => [...document.querySelectorAll('.nametag')].map((e) => e.textContent));
ok(tags.filter((t) => /^Bot \d🤖$/.test(t)).length === N - 1, `bots have a normal name tag with a 🤖 chip ${JSON.stringify(tags)}`);
let shotMid = false;
const rA = await play(undefined, async (m) => {
  if (shotMid || m < 2) return; shotMid = true; await p.waitForTimeout(500);
  await waitFresh(); const i = await info(); perfRows.push([`playing ${N}p`, i.calls, i.callsMain, i.callsShadow, i.triangles, i.trianglesShadow]);
  ok(mainCalls(i) <= 40 && mainTri(i) < 100000, `${N}p playing: main-pass draw calls ≤ 40 / triangles < 100k (${mainCalls(i)} + ${i.callsShadow ?? 0} shadow = ${i.calls} / ${mainTri(i)} tris, ${i.triangles} incl. shadow)`);
  const m2 = await ev(() => window.__metrics?.()); const me = m2[await ev(() => window.game.s.activeChar)];
  ok(!!me && me.bboxPx[1] > 60 && me.bboxPx[3] < dev.h - 60, `seated player visible between the overlay strips ${JSON.stringify(me?.bboxPx)}`);
  const bots = Object.entries(m2).filter(([k]) => k.startsWith('bot_')).map(([k, v]) => `${k}:${v.screenH}px`); console.log('BOTS', bots.join(' '));
  await shot('3_playing');
});
// a turn screenshot while a bot is thinking
ok(rA.sawThinking, 'bot turn: active chip glows with the thinking dots'); ok(rA.sawCue, 'my turn: "À toi de jouer !" cue, glowing hand panel and chip'); ok(rA.sawRing, 'my turn: gold turn ring under my chair');
const res = await ev(() => window.club.s.session?.host.result ?? null);
ok(!!res && res.endedBy === 'normal', `full game reaches the end (${rA.moves} tiles laid, ${rA.draws} draws, ${rA.passes} passes, ${res?.moves} moves in log)`);
ok(await p.locator('[data-club="results"]').isVisible().catch(() => false), 'results screen visible');
ok(await p.locator('[data-club="results"] tr[data-rank-seat]').count() === N && await p.locator('[data-club="recap"] tr').count() >= 1, 'results: full ranking + round recap');
ok(['replay', 'change', 'leave'].every(Boolean) && await p.locator('[data-club="replay"]').count() === 1 && await p.locator('[data-club="change"]').count() === 1 && await p.locator('[data-club="leave"]').count() === 1, 'results: Rejouer / Changer de partie / Quitter');
ok(JSON.stringify(res ?? {}).match(/gold|xp|reward|stake/i) === null, 'result carries no Gold / XP / reward / stake');
await p.waitForTimeout(300); await shot('4_results');
console.log('RESULT', JSON.stringify(res && { scores: res.scores, ranking: res.ranking, winners: res.winners, moves: res.moves }));
ok(await ev(() => window.__world.chars[window.game.s.activeChar].mode) === 'sitting', 'player still seated on the results screen');

// ---------- B. rematch ----------
const botsBefore = await ev(() => window.club.s.bots.map((b) => b.id + '@' + b.chair).join(','));
await p.tap('[data-club="replay"]');
await p.waitForFunction(() => window.club.s.session?.phase === 'playing', null, { timeout: 20000 }).then(() => ok(true, 'Rejouer: new deal starts at once'), () => ok(false, 'Rejouer starts'));
const B = await ev(() => ({ n: window.club.s.session.room.seats.length, mode: window.club.s.session.host.state.options.mode, bots: window.club.s.bots.map((b) => b.id + '@' + b.chair).join(','), seated: window.club.s.bots.every((b) => window.__world.chars[b.id]?.mode === 'sitting'), me: window.__world.chars[window.game.s.activeChar].mode }));
ok(B.n === N && B.mode === 'single' && B.bots === botsBefore && B.seated && B.me === 'sitting', `Rejouer keeps the same setup and the same seated bots ${JSON.stringify(B)}`);

// ---------- C. leave during a bot turn ----------
// slower bots for this scenario only, so that the taps land inside a bot's thinking time (test handle on the host)
const slowBots = (ms) => ev((ms) => { const h = window.club.s.session?.host; if (h) h.opts.botDelayMs = ms; }, ms);
async function untilBotThinking() {
  for (let k = 0; k < 4; k++) {
    // the slower delay only applies to bot timers started AFTER it is set: a bot already thinking with the normal delay
    // can play before the Quitter tap lands (CI run 44758982259: dialog opened on the player's own turn, "Bot 0").
    // Wait for a bot turn that began after at least one more move, i.e. one that runs the 1600 ms delay.
    await slowBots(1600); const seq0 = await ev(() => window.club.s.session?.host.engine.seq ?? 0);
    await play(async (st) => st.turn !== null && st.turn !== 0 && st.thinking !== null && (await ev(() => window.club.s.session?.host.engine.seq ?? 0)) > seq0);
    if (await ev(() => window.club.s.session?.host.thinking > 0)) return true;
    if (await ev(() => window.club.s.session?.phase === 'results')) { await p.tap('[data-club="replay"]'); await p.waitForFunction(() => window.club.s.session?.phase === 'playing', null, { timeout: 20000 }); }
  }
  return false;
}
ok(await untilBotThinking(), 'reached a bot turn');
// Race guard (test side only, bots NOT slowed further): on a slow runner the bot can finish its move between the bot-turn
// check and the Quitter tap, so the dialog opens on the player's turn. Right before the tap, wait (bounded) for a confirmed
// bot turn; after the tap, re-check. If the turn was back to the player when the dialog opened, close it, wait for the
// next bot turn and retry: at most 2 retries, each logged. Still on the player's turn after that = the check below FAILS.
const confirmedBotTurn = (ms = 15000) => p.waitForFunction(() => { const h = window.club.s.session?.host; return !!h && h.state.turn !== null && h.state.turn !== 0 && h.thinking > 0; }, null, { timeout: ms }).then(() => true, () => false);
let c0 = null;
for (let attempt = 0; attempt <= 2; attempt++) {
  if (!(await confirmedBotTurn()) && !(await untilBotThinking())) { console.log(`  quit-race: attempt ${attempt + 1}/3: no bot turn within the timeout`); continue; }
  await p.tap('[data-club="quit"]'); await p.waitForTimeout(300);
  c0 = await ev(() => ({ seq: window.club.s.session?.host.engine.seq, turn: window.club.s.session?.host.state.turn }));
  const dialog = await p.locator('[data-club="leave-confirm"]').isVisible();
  if (dialog && c0.turn !== 0) break;
  console.log(`  quit-race: attempt ${attempt + 1}/3: dialog ${dialog ? 'opened' : 'not open'} on turn ${c0.turn} (turn back to the player before the dialog)${attempt < 2 ? ' -> close, wait for the next bot turn, retry' : ' -> giving up'}`);
  if (attempt === 2) break;
  if (dialog) { await p.tap('[data-club="stay"]'); await p.waitForFunction(() => !window.club.s.confirmLeave, null, { timeout: 10000 }).catch(() => {}); }
  await untilBotThinking();
}
ok(await p.locator('[data-club="leave-confirm"]').isVisible() && c0 && c0.turn !== 0, `Quitter during a bot turn (Bot ${c0?.turn}): confirm dialog`); await shot('5_leave_confirm');
await p.waitForTimeout(2200);
ok(await ev(() => window.club.s.session?.host.engine.seq) === c0.seq && await ev(() => window.club.s.session?.host.isPaused && !window.club.s.session.host.hasTimer), 'bots are paused while the dialog is open (no move, no timer)');
await p.tap('[data-club="stay"]'); await p.waitForTimeout(2300);
ok(await ev(() => !window.club.s.confirmLeave && !window.club.s.session.host.isPaused) && await ev(() => window.club.s.session.host.engine.seq) > c0.seq, '"Rester": dialog closes and the bot plays on');
ok(await untilBotThinking(), 'reached another bot turn');
await p.tap('[data-club="quit"]'); await p.waitForTimeout(250); await p.tap('[data-club="leave-yes"]');
const C = await cleanAfterLeave('leave during a bot turn');
ok(C.mode !== 'sitting', `player stood up (${C.mode})`);
ok(await p.locator('.dock').count() === 1, 'dock back after leaving');

// ---------- D. leave between rounds (3 players, 100 points) ----------
await openSetup(3, 'points'); await startFromSheet(3);
await play((st) => st.gp === 'roundOver');
ok(await p.locator('[data-club="round"]').isVisible().catch(() => false), 'between rounds: round summary'); await shot('6_round');
await p.tap('[data-club="quit"]'); await p.waitForTimeout(250);
ok(await p.locator('[data-club="leave-confirm"]').isVisible(), 'Quitter between rounds: confirm dialog');
await p.tap('[data-club="leave-yes"]'); await cleanAfterLeave('leave between rounds');
const hist = await ev(() => window.club.s.history.map((h) => h.endedBy).join(','));
ok(/abandon/.test(hist), `abandoned games recorded as abandon in session memory only (${hist})`);

// ---------- E. change game from the results, then leave from the results ----------
await openSetup(2, 'single'); await startFromSheet(2);
await play(); ok(await p.locator('[data-club="results"]').isVisible().catch(() => false), '2 players: results');
await p.tap('[data-club="change"]'); await p.waitForTimeout(600);
ok(await p.locator('[data-club="setup"]').count() === 1 && await ev(() => !window.club.s.session && window.__world.chars[window.game.s.activeChar].mode === 'sitting'), 'Changer de partie: setup sheet, player still seated');
await p.tap(`[data-players="${N}"]`); await startFromSheet(N);
await play(); ok(await p.locator('[data-club="results"]').isVisible().catch(() => false), 'new game after "Changer de partie": results');
await p.tap('[data-club="leave"]');
ok(await p.locator('[data-club="leave-confirm"]').count() === 0, 'Quitter from the results: no confirm needed');
await cleanAfterLeave('leave from the results');

// ---------- F. travel away mid-game, then back via the dock ----------
await openSetup(N, 'single'); await startFromSheet(N);
await play((st) => st.line >= 2);
await ev(() => window.game.travelWithFade('home'));
await p.waitForFunction(() => window.game.s.location === 'home' && !window.game.s.transition, null, { timeout: 30000 });
const F = await cleanAfterLeave('travel away mid-game');
ok(await ev(() => !window.club.s.setup), 'travel: no setup sheet left open');
await gotoClubByDock();
await openSetup(N, 'single'); await startFromSheet(N);
const rF = await play((st) => st.line >= 3); ok(rF.stopped, 'after travelling back: a new game runs');
await p.tap('[data-club="quit"]'); await p.waitForTimeout(250); await p.tap('[data-club="leave-yes"]'); await cleanAfterLeave('leave after travelling back');

const gold1 = await ev(() => window.economy.goldBalance()); ok(gold1 === gold0, `no Gold earned in the club (${gold0} → ${gold1})`);
await p.waitForTimeout(600);
const prof = await ev(() => { const k = Object.keys(localStorage).find((x) => /profile/i.test(x)); return k ? localStorage.getItem(k) : ''; });
ok(!/"location":"club"/.test(prof ?? ''), 'club never written as the saved location');

// ---------- G. long chain (fixed deal) ----------
await p.goto(q(url, '&lieu=club&clubseed=2')); await ready();
await p.waitForFunction(() => window.game.s.location === 'club' && !window.game.s.transition, null, { timeout: 30000 }); await p.waitForTimeout(3000);
await openSetup(2, 'single'); await startFromSheet(2);
await waitFresh(); const i2 = await info(); perfRows.push(['playing 2p', i2.calls, i2.callsMain, i2.callsShadow, i2.triangles, i2.trianglesShadow]);
ok(mainCalls(i2) <= 40 && mainTri(i2) < 100000, `2p playing: main-pass draw calls ≤ 40 / triangles < 100k (${mainCalls(i2)} + ${i2.callsShadow ?? 0} shadow = ${i2.calls} / ${mainTri(i2)} tris, ${i2.triangles} incl. shadow)`);
let longShot = false; const chainChecks = [];
await play(async (st) => {
  if (st.line >= 20 && !longShot && st.turn === 0) {
    longShot = true; await p.waitForTimeout(300); await shot('7_long_chain');
    chainChecks.push(await ev(() => { const line = document.querySelector('[data-club="line"]'); const chain = line.querySelector('[data-club="chain"]'); const tiles = [...chain.querySelectorAll('svg.dtile')];
      const lr = line.getBoundingClientRect(); const out = tiles.filter((t) => { const r = t.getBoundingClientRect(); return r.left < lr.left || r.right > lr.right || r.top < lr.top - 1 || r.bottom > lr.bottom + 1; }).length;
      const minHalf = Math.min(...tiles.map((t) => Math.min(t.getBoundingClientRect().width, t.getBoundingClientRect().height)));
      return { len: Number(line.dataset.len), size: Number(line.dataset.size), rows: Number(line.dataset.rows), tiles: tiles.length, out, minHalf, lineBottom: Math.round(lr.bottom) }; }));
  }
  return false;
});
const longest = await ev(() => window.club.s.session?.host.state.line.length ?? 0);
console.log('CHAIN', JSON.stringify(chainChecks), 'final line', longest);
const cc = chainChecks[0];
ok(!!cc && cc.len >= 20 && cc.tiles === cc.len, `long chain shown in full (${cc?.len} tiles)`);
ok(!!cc && cc.size >= 16 && cc.minHalf >= 15.5, `long chain stays readable: half-tile ${cc?.size} px (min ${cc?.minHalf?.toFixed?.(1)} px ≥ 16), ${cc?.rows} row(s)`);
ok(!!cc && cc.out === 0, `no tile clipped outside the line strip (strip bottom ${cc?.lineBottom} px)`);
const mG = await ev(() => window.__metrics?.()[window.game.s.activeChar]);
ok(!!mG && mG.bboxPx[1] > (cc?.lineBottom ?? 0) - 40, `seated player still visible under the long line ${JSON.stringify(mG?.bboxPx)}`);
await p.waitForTimeout(300); await shot('8_results_long');
await p.tap('[data-club="leave"]'); await cleanAfterLeave('long chain: leave');

await p.goto(q(url)); await ready();
ok(await ev(() => window.game.s.location) !== 'club', 'reload → back to a remembered place (not the club)');
console.log('PERF', JSON.stringify(perfRows));
ok(errs.length === 0, 'no console/page errors ' + errs.join(' | ')); ok(bad.length === 0, 'no HTTP errors ' + bad.join(' '));
console.log(`SUMMARY ${DEV} ${N}p ${fails ? 'FAIL' : 'PASS'} (${passes} passed, ${fails} failed)`);
await b.close();
