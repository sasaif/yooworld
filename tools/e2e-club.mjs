import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Yoo Games Club end-to-end on a phone-landscape TOUCH viewport, real localStorage:
// home → Lieux → "Yoo Games Club" (fade) → tap the domino table → setup sheet → sit → play a FULL game of Dominoes
// against bots with real taps on the hand tiles / Piocher / Passer → results screen → leave the table.
// Also checks: "Mode local · contre des bots" badge, never "multijoueur", no Gold earned, club never saved as location,
// draw calls / triangles in the club (budget ≤ 40 calls, < 100k triangles), avatar size, 0 console errors.
// usage: DEV=iphone15|se [SHOTS=dir] [BOTMS=120] node tools/e2e-club.mjs http://127.0.0.1:5391/
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5391'}/`;
const DEVS = { iphone15: { w: 852, h: 393 }, se: { w: 667, h: 375 } };
const dev = DEVS[process.env.DEV ?? 'iphone15']; const innerHeightGuess = dev.h - 60; const SHOTS = process.env.SHOTS; const BOTMS = process.env.BOTMS ?? '150';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errs = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${process.env.DEV ?? 'iphone15'}_${name}.png` }); };
const q = (u) => u + (u.includes('?') ? '&' : '?') + `botms=${BOTMS}`;
await p.goto(q(url)); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(2500);
ok(await p.evaluate(() => window.game.s.location) === 'home', 'starts at home');
const gold0 = await p.evaluate(() => window.economy.goldBalance());
const homePx = await p.evaluate(() => window.__metrics?.()[window.game.s.activeChar]?.screenH ?? 0);
await p.tap('.dock button:first-child'); await p.waitForTimeout(500);
const card = p.locator('.sheet .card', { hasText: 'Yoo Games Club' }); ok(await card.count() === 1 && await card.isEnabled(), 'Lieux lists "Yoo Games Club" (enabled)');
await card.tap();
await p.waitForFunction(() => window.game.s.location === 'club' && !window.game.s.transition, null, { timeout: 30000 }).then(() => ok(true, 'arrived at the Games Club after the fade'), () => ok(false, 'arrived at the Games Club'));
await p.waitForTimeout(4500);
const perf = await p.evaluate(() => ({ info: window.__info, perf: window.__perf?.() ?? null, m: window.__metrics?.() }));
const calls = perf.perf?.calls || perf.info?.calls, tris = perf.perf?.triangles || perf.info?.triangles;
console.log('PERF club', JSON.stringify({ calls, tris, geometries: perf.info?.geometries, textures: perf.info?.textures, programs: perf.info?.programs, fps: perf.perf?.fps ?? null, avatarPx: perf.m?.[await p.evaluate(() => window.game.s.activeChar)]?.screenH }));
ok(calls > 0 && calls <= 40, `club draw calls ≤ 40 (${calls})`); ok(tris > 0 && tris < 100000, `club triangles < 100k (${tris})`);
const av = perf.m?.[await p.evaluate(() => window.game.s.activeChar)]?.screenH ?? 0; ok(Math.abs(av - homePx) <= 3 && (process.env.DEV !== undefined && process.env.DEV !== 'iphone15' || Math.abs(av - 93) <= 4), `avatar size unchanged vs the apartment (club ${av} px, home ${homePx} px; ~93 px on iPhone 15)`);
ok(await p.locator('.dock', { hasText: 'Décorer' }).count() === 0, 'apartment-only buttons hidden in the club');
await shot('1_club');
// tap the domino table in the 3D view (menu), fall back to the dock "Jeux" button if the table is off-screen
await p.evaluate(() => window.game.store.set({ menuItem: 't_dominoes' })); await p.waitForTimeout(600);
const playBtn = p.locator('.imenu button[data-act="play"]'); ok(await playBtn.count() === 1, 'table menu offers "Jouer aux dominos"');
ok(await p.locator('.imenu', { hasText: 'Mode local · contre des bots' }).count() === 1, 'table menu shows the local badge');
await playBtn.dispatchEvent('click'); await p.waitForTimeout(400);
ok(await p.locator('[data-club="setup"]').count() === 1, 'setup sheet opens');
const nPlayers = Number(process.env.PLAYERS ?? 4);
await p.tap(`[data-players="${nPlayers}"]`); await p.tap(`[data-mode="${process.env.MODE ?? 'single'}"]`); await shot('2_setup');
await p.tap('[data-club="start"]');
await p.waitForFunction(() => window.club.s.session?.phase === 'playing', null, { timeout: 60000 }).then(() => ok(true, 'avatar walks to the table, sits, game starts'), () => ok(false, 'avatar sits and the game starts'));
const me = await p.evaluate(() => { const c = window.__world.chars[window.game.s.activeChar]; return { mode: c.mode, seat: c.sitOn?.id }; });
ok(me.mode === 'sitting' && /^t_dominoes_.:0$/.test(me.seat ?? ''), 'seated on a domino-table chair ' + me.seat);
ok(await p.locator('[data-club="badge"]', { hasText: 'Mode local · contre des bots' }).count() === 1, 'table overlay shows "Mode local · contre des bots"');
ok(await p.locator('.dock').count() === 0 && await p.locator('.joy:not(.joy-hidden)').count() === 0, 'dock and joystick hidden while seated at the table');
ok(!(await p.evaluate(() => document.body.innerText)).match(/multijoueur|multiplayer/i), 'never says multiplayer');
const bots = await p.locator('.bot-tag').count(); ok(bots === nPlayers - 1, `${nPlayers - 1} bot tags over the chairs (${bots})`);
// play the whole game with real taps
let moves = 0, draws = 0, passes = 0, shotMid = false; const t0 = Date.now();
while (Date.now() - t0 < 480000) {
  const st = await p.evaluate(() => { const s = window.club.s.session; if (!s) return { gone: true }; const st = s.host.state; return { phase: s.phase, turn: st.phase === 'playing' ? st.turn : null, gp: st.phase, legal: s.host.legal(0).length }; });
  if (st.gone || st.phase === 'results') break;
  if (st.gp === 'roundOver') { await p.tap('[data-club="next"]'); continue; }
  if (st.turn !== 0 || !st.legal) { await p.waitForTimeout(80); continue; }
  const tile = p.locator('.dom-tile.ok').first();
  if (await tile.count()) {
    await tile.tap(); await p.waitForTimeout(60);
    const end = p.locator('.dom-end').first(); if (await end.count()) await end.tap();
    moves++; if (!shotMid && moves >= 3) {
      shotMid = true; await p.waitForTimeout(700); await shot('3_playing');
      const i = await p.evaluate(() => window.__info); console.log('PERF club-playing', JSON.stringify(i));
      ok(i.calls <= 40 && i.triangles < 100000, `draw calls ≤ 40 / triangles < 100k while playing (${i.calls} / ${i.triangles})`);
      const m = await p.evaluate(() => window.__metrics?.()[window.game.s.activeChar]); ok(!!m && m.bboxPx[1] > 60 && m.bboxPx[3] < innerHeightGuess, `seated avatar visible between the overlay strips ${JSON.stringify(m?.bboxPx)}`);
    }
  } else if (await p.locator('[data-club="draw"]').count()) { await p.tap('[data-club="draw"]'); draws++; }
  else if (await p.locator('[data-club="pass"]').count()) { await p.tap('[data-club="pass"]'); passes++; }
  await p.waitForTimeout(120);
}
const res = await p.evaluate(() => window.club.s.session?.host.result ?? null);
ok(!!res && res.endedBy === 'normal', `full game reaches the end (${moves} tiles laid, ${draws} draws, ${passes} passes, ${res?.moves} moves in log)`);
ok(await p.locator('[data-club="results"]').isVisible().catch(() => false), 'results screen visible');
ok(JSON.stringify(res ?? {}).match(/gold|xp|reward|stake/i) === null, 'result carries no Gold / XP / reward / stake');
await p.waitForTimeout(300); await shot('4_results');
console.log('RESULT', JSON.stringify(res && { scores: res.scores, ranking: res.ranking, winners: res.winners, moves: res.moves }));
ok(await p.evaluate(() => window.__world.chars[window.game.s.activeChar].mode) === 'sitting', 'avatar still seated on the results screen');
await p.tap('[data-club="leave"]'); await p.waitForTimeout(1500);
ok(await p.evaluate(() => !window.club.s.session), 'left the table');
ok(await p.locator('.dock').count() === 1, 'dock back after leaving');
const gold1 = await p.evaluate(() => window.economy.goldBalance()); ok(gold1 === gold0, `no Gold earned in the club (${gold0} → ${gold1})`);
await p.waitForTimeout(600);
const prof = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /profile/i.test(x)); return k ? localStorage.getItem(k) : ''; });
ok(!/"location":"club"/.test(prof ?? ''), 'club never written as the saved location');
await p.reload(); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
ok(await p.evaluate(() => window.game.s.location) !== 'club', 'reload → back to a remembered place (not the club)');
ok(errs.length === 0, 'no console/page errors ' + errs.join(' | ')); ok(bad.length === 0, 'no HTTP errors ' + bad.join(' '));
console.log(`SUMMARY ${fails ? 'FAIL' : 'PASS'} (${fails} failed)`);
await b.close();
