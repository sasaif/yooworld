import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * Secondary hair motion (springs) on the real game, iPhone 15 landscape touch viewport, deterministic virtual time
 * (performance.now + rAF stepped exactly 1/60 s per frame, as e2e-walk-run.mjs). Reads window.__hair() (read-only).
 *  - spring bones exist for every supported style (buns, long, bob, pony, pigtails, braids, bun_high, manbun); short styles static
 *  - idle: no jitter; walk / run / turn: subtle swing, bounded by the clamps; stop → back to rest in < 1 s
 *  - hat: buns / bun_high / manbun static (rigid mesh); long + hat stiffer; headphones side clamp 4°; ties ride their chain bone
 *  - teleport (travel) and sitting: hair at rest, rigid mesh shown while seated
 *  - ?hairmotion=0 fallback: same avatar screen height (scale) and draw calls
 *  - saves: same keys and same looks after reload (real localStorage), rig rebuilt; no console errors
 * usage: node tools/e2e-hair-motion.mjs [url] ; OUT=dir (report json)
 */
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5794'}/`;
const OUT = process.env.OUT; if (OUT) fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m, extra }); if (!c) process.exitCode = 1; };
const errsAll = [];
async function open(q = 'fresh=1&lieu=appart', virt = true, beach = virt) {
  const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('yw.portrait', '1'); } catch { /* */ }
    let vt = 0, virt = false; const rp = performance.now.bind(performance); const rr = window.requestAnimationFrame.bind(window); let cbs = [];
    performance.now = () => (virt ? vt : rp());
    window.requestAnimationFrame = (cb) => { if (!virt) return rr(cb); cbs.push(cb); return 1e6 + cbs.length; };
    const rc = window.cancelAnimationFrame.bind(window); window.cancelAnimationFrame = (id) => { if (id < 1e6) rc(id); };
    window.__virt = () => { vt = rp(); virt = true; };
    window.__step = (ms) => { vt += ms; const c = cbs; cbs = []; c.forEach((f) => f(vt)); };
    window.__steps = (n) => { for (let i = 0; i < n; i++) window.__step(1000 / 60); };
    window.__setSlots = (body, slots) => { const L = window.fashion.s.looks; const s = { ...L[body].slots, ...slots }; for (const k of Object.keys(s)) if (s[k] === null) delete s[k]; window.fashion.store.set({ looks: { ...L, [body]: { ...L[body], slots: s } } }); };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(url + (url.includes('?') ? '&' : '?') + q, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__cam && window.__hair, null, { timeout: 180000 }); await p.waitForTimeout(2500);
  if (virt) await p.evaluate(() => window.__virt());
  // the start location ignores tap-to-move during its arrival; a travel (as e2e-walk-run.mjs) gives a free beach at once
  if (beach) { await p.evaluate(() => window.game.travel('beach')); await p.evaluate(() => window.__steps(150)); }
  return { p, ctx, errs };
}
const H = (p, id = 'f') => p.evaluate((id) => window.__hair().avatars[id], id);
const steps = (p, n) => p.evaluate((n) => window.__steps(n), n);
const peakMax = (a) => Math.max(0, ...a.chains.map((c) => c.peak));
const degMax = (a) => Math.max(0, ...a.chains.map((c) => c.deg));
/** largest deflection a rig's clamps allow (deg): a chain can combine two axes, so the bound is the vector sum of the two largest */
const bound = (a) => Math.max(...a.chains.map((c) => { const l = [c.lim.side, c.lim.back, c.lim.fwd, c.lim.up].sort((x, y) => y - x); return Math.hypot(l[0], l[1]); }));
/** walk (or run) the active avatar `dist` m along the free direction closest to `az` (rad), from where it stands */
const walk = (p, az, dist, run = false) => p.evaluate(({ az, dist, run }) => {
  const c = window.__world.chars[window.game.s.activeChar]; const V = window.__cam.position.constructor;
  for (let k = 0; k < 16; k++) { const a = az + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35; const t = new V(c.pos.x + Math.sin(a) * dist, 0, c.pos.z + Math.cos(a) * dist); if (window.game.walkTo(t, run)) return a; }
  return null; }, { az, dist, run });
const phase = async (p, frames) => { await p.evaluate(() => window.__hairResetPeaks()); await steps(p, frames); return H(p); };

// ---------- A: Juanita's twin buns on the beach (default look) ----------
{
  const { p, ctx, errs } = await open(); await steps(p, 120);
  let f = await H(p);
  ok(f && f.key === 'buns' && JSON.stringify(f.bones) === JSON.stringify(['hair_root', 'hair_bunL', 'hair_bunR']) && f.skinnedVisible && !f.rigidVisible, 'Juanita twin buns: 2 spring bones, skinned copy shown, rigid mesh kept hidden', f && { key: f.key, bones: f.bones });
  ok(f.state === 'updated' && f.pxPerM >= 40, 'player avatar updated at the default iso camera (screen-size LOD passes)', { state: f.state, pxPerM: f.pxPerM });
  const m = await H(p, 'm'); ok(m && m.state === 'static' && m.bones.length === 0, 'Juan default short hair: static (no rig)', m && { style: m.style, state: m.state });
  f = await phase(p, 120); ok(peakMax(f) < 0.5, 'idle 2 s: no jitter (peak < 0.5°)', { peak: peakMax(f) });
  const yaw0 = await p.evaluate(() => window.__world.chars.f.yaw);
  ok(await walk(p, yaw0, 6) !== null, 'walk path found');
  f = await phase(p, 90); const wPeak = peakMax(f); ok(wPeak > 0.5 && wPeak <= bound(f) + 0.5, 'walk: subtle swing, within the clamps', { peak: wPeak, bound: +bound(f).toFixed(2) });
  ok(await walk(p, yaw0 + Math.PI / 2, 5) !== null, 'turn path found');
  f = await phase(p, 60); const tPeak = peakMax(f); ok(tPeak > 0.5 && tPeak <= bound(f) + 0.5, 'turn 90°: swing within the clamps', { peak: tPeak });
  ok(await walk(p, yaw0 + Math.PI, 6, true) !== null, 'run path found');
  f = await phase(p, 90); const rPeak = peakMax(f); ok(rPeak > 0.5 && rPeak <= bound(f) + 0.5, 'run (U-turn start): swing within the clamps', { peak: rPeak });
  // stop: wait until the avatar is idle, then count frames to rest
  for (let i = 0; i < 40 && await p.evaluate(() => window.__world.chars.f.mode !== 'idle'); i++) await steps(p, 15);
  let rest = -1;
  for (let i = 0; i < 120; i++) { await steps(p, 1); const a = await H(p); if (degMax(a) < 0.5) { rest = i + 1; break; } }
  ok(rest >= 0 && rest <= 60, 'stop → back to rest (< 0.5°) in < 1 s', { frames: rest, s: +(rest / 60).toFixed(2) });
  await steps(p, 60); f = await H(p); ok(degMax(f) < 0.1, 'settled at rest after the stop (< 0.1°)', { deg: degMax(f) });
  // teleport: travel to the apartment while running → hair re-initialised at rest
  await walk(p, yaw0, 6, true); await steps(p, 30);
  const moved = await p.evaluate(() => window.game.travel('home')); await steps(p, 1); f = await H(p);
  ok(moved !== false && f && degMax(f) < 0.05, 'teleport (travel beach → home while running): hair at rest right after', f && { moved, loc: await p.evaluate(() => window.__world.location), deg: degMax(f), state: f.state });
  // sitting: chair in the apartment → frozen, rigid mesh shown; walking off → springs again
  await steps(p, 150);
  const chair = await p.evaluate(() => window.__itemPoints().find((i) => i.interaction && JSON.stringify(i.interaction).includes('sit')));
  if (chair) {
    await p.evaluate((uid) => window.game.interact(uid, 'sit'), chair.uid); let seen = false;
    for (let i = 0; i < 80 && !seen; i++) { await steps(p, 10); const a = await H(p); if (a.state === 'frozen') seen = a.rigidVisible && !a.skinnedVisible && degMax(a) === 0; }
    ok(seen, 'seated: hair frozen at rest, rigid mesh shown (old rendering, old seat contact)', { chair: chair.defId });
    await steps(p, 60); await walk(p, 0, 1.5);
    let back = false; for (let i = 0; i < 80 && !back; i++) { await steps(p, 10); const a = await H(p); back = a.state === 'updated' && a.skinnedVisible; }
    ok(back, 'standing up and walking: springs active again');
  } else ok(false, 'no chair found in the apartment');
  ok(errs.length === 0, 'A: no console errors', errs.slice(0, 3)); errsAll.push(...errs);
  await ctx.close();
}

// ---------- B: every style, hats, headphones, ties ----------
{
  const { p, ctx, errs } = await open(); await steps(p, 60);
  const want = { buns: ['bunL', 'bunR'], long: ['longL', 'longB', 'longR'], bob: ['longL', 'longB', 'longR'], pony: ['pony'], pigtails: ['tailL', 'tailR'], braids: ['braidL', 'braidR'], bun_high: ['bunTop'], manbun: ['manbun'] };
  const peaks = {};
  for (const [st, ch] of Object.entries(want)) {
    await p.evaluate((st) => window.__setSlots('f', { hair: 'hair_' + st, 'acc.hat': null, 'acc.head2': null }), st); await steps(p, 20);
    let a = await H(p); ok(a.key === st && JSON.stringify(a.chains.map((c) => c.name)) === JSON.stringify(ch) && a.bones.length === ch.length + 1, `${st}: spring bones ${ch.join(',')}`, { key: a.key, bones: a.bones });
    const yaw = await p.evaluate(() => window.__world.chars.f.yaw); await walk(p, yaw + 0.8, 5, true);
    a = await phase(p, 75); peaks[st] = +peakMax(a).toFixed(2); ok(peakMax(a) > 0.3 && peakMax(a) <= bound(a) + 0.5, `${st}: run + turn swing bounded`, { peak: peaks[st], bound: +bound(a).toFixed(2) });
    await steps(p, 90);
  }
  for (const st of ['quiff', 'afro', 'mohawk', 'buzz']) { await p.evaluate((st) => window.__setSlots('f', { hair: 'hair_' + st }), st); await steps(p, 10); const a = await H(p); ok(a.state === 'static' && a.bones.length === 0, `${st}: short style stays static`); }
  // ties follow their chain bone
  await p.evaluate(() => window.__setSlots('f', { hair: 'hair_pony' })); await steps(p, 10); ok(JSON.stringify((await H(p)).ties) === JSON.stringify(['hair_pony']), 'pony: hair tie carried by the pony bone', (await H(p)).ties);
  await p.evaluate(() => window.__setSlots('f', { hair: 'hair_pigtails' })); await steps(p, 10); ok(JSON.stringify((await H(p)).ties) === JSON.stringify(['hair_tailL', 'hair_tailR']), 'pigtails: both ties carried by their tail bones', (await H(p)).ties);
  await p.evaluate(() => window.__setSlots('f', { hair: 'hair_manbun' })); await steps(p, 10); ok(JSON.stringify((await H(p)).ties) === JSON.stringify(['hair_manbun']), 'manbun: tie carried by the bun bone', (await H(p)).ties);
  // hats
  for (const st of ['buns', 'bun_high', 'manbun']) for (const hat of ['acc_strawhat', 'acc_cap']) {
    await p.evaluate(([st, hat]) => window.__setSlots('f', { hair: 'hair_' + st, 'acc.hat': hat }), [st, hat]); await steps(p, 10);
    const yaw = await p.evaluate(() => window.__world.chars.f.yaw); await walk(p, yaw + 1.2, 4, true); await steps(p, 40); const a = await H(p);
    ok(a.state === 'static' && a.bones.length === 0 && a.rigidVisible, `${st} + ${hat.slice(4)}: static under the hat while running`, { state: a.state });
  }
  await p.evaluate(() => window.__setSlots('f', { hair: 'hair_long', 'acc.hat': 'acc_cap' })); await steps(p, 10);
  let a = await H(p); ok(a.key === 'long+hat' && a.chains.every((c) => c.stiff === 1.3 && c.lim.back <= 12 * 0.7 + 0.01), 'long + cap: springs kept below the brim, 1.3× stiffer, clamps × 0.7', { key: a.key, lim: a.chains[1]?.lim });
  for (const st of ['long', 'bob', 'braids', 'pony', 'buns', 'bun_high']) {
    await p.evaluate((st) => window.__setSlots('f', { hair: 'hair_' + st, 'acc.hat': null, 'acc.head2': 'acc_headphones' }), st); await steps(p, 10);
    a = await H(p); ok(a.key === st + '+phones' && a.chains.every((c) => c.lim.side <= 4.0001), `${st} + headphones: side swing capped at 4°`, { key: a.key, side: a.chains.map((c) => c.lim.side) });
  }
  await p.evaluate(() => window.__setSlots('f', { hair: 'hair_long', 'acc.head2': 'acc_headphones' })); await steps(p, 10);
  const yaw = await p.evaluate(() => window.__world.chars.f.yaw); await walk(p, yaw + Math.PI / 2, 5, true); a = await phase(p, 75);
  ok(peakMax(a) <= bound(a) + 0.5, 'long + headphones: run + turn swing within the reduced clamps', { peak: peakMax(a), bound: +bound(a).toFixed(2) });
  if (OUT) fs.writeFileSync(OUT + '/style_peaks.json', JSON.stringify(peaks, null, 1));
  console.log('style peaks (deg, run + turn 1.25 s):', JSON.stringify(peaks));
  ok(errs.length === 0, 'B: no console errors', errs.slice(0, 3)); errsAll.push(...errs);
  await ctx.close();
}

// ---------- C: static fallback (?hairmotion=0): same avatar scale, same draw calls ----------
{
  const shot = async (q) => { const { p, ctx, errs } = await open(q, true, false); await steps(p, 240); const r = await p.evaluate(() => ({ met: window.__metrics(), info: window.__info, h: window.__hair() })); errsAll.push(...errs); await ctx.close(); return r; };
  const on = await shot('fresh=1&lieu=appart'), off = await shot('fresh=1&lieu=appart&hairmotion=0');
  ok(off.h.enabled === false && off.h.avatars.f?.state === 'off' && off.h.avatars.f?.rigidVisible === true, '?hairmotion=0: static rigid hair (old rendering)', off.h.avatars.f && { state: off.h.avatars.f.state });
  ok(on.met.f && off.met.f && on.met.f.screenH === off.met.f.screenH && on.met.m.screenH === off.met.m.screenH, 'avatar screen height unchanged (scale)', { on: [on.met.f?.screenH, on.met.m?.screenH], off: [off.met.f?.screenH, off.met.m?.screenH] });
  ok(on.info && off.info && on.info.calls === off.info.calls, 'draw calls unchanged (spring vs static)', { on: on.info?.calls, off: off.info?.calls, onTris: on.info?.triangles, offTris: off.info?.triangles });
}

// ---------- D: saves (real localStorage) ----------
{
  const { p, ctx, errs } = await open('lieu=appart', false);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => window.game?.s.ready && window.__hair, null, { timeout: 180000 }); await p.waitForTimeout(4000);
  const snap = () => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  const looks = () => p.evaluate(() => JSON.stringify(window.fashion.s.looks));
  const k0 = await snap(), l0 = await looks();
  await p.evaluate(() => window.game.walkTo(new (window.__cam.position.constructor)(window.__world.chars.f.pos.x + 1.2, 0, window.__world.chars.f.pos.z + 0.8))); await p.waitForTimeout(3000);
  await p.reload(); await p.waitForFunction(() => window.game?.s.ready && window.__hair, null, { timeout: 180000 }); await p.waitForTimeout(4000);
  const k1 = await snap(), l1 = await looks(); const f = await H(p);
  const names0 = Object.keys(k0).sort(), names1 = Object.keys(k1).sort();
  ok(JSON.stringify(names0) === JSON.stringify(names1), 'same storage keys after walking + reload (no new key)', { before: names0.length, after: names1.length, added: names1.filter((k) => !names0.includes(k)) });
  ok(!names1.some((k) => /hair|spring/i.test(k)) && !Object.values(k1).some((v) => /hair_root|hairMotion|spring/.test(v ?? '')), 'nothing hair-motion related written to storage');
  ok(names1.every((k) => /^(yooworld:|yw\.|yw:e:)/.test(k)), 'only the existing key prefixes (yooworld:, yw., yw:e:)', names1.filter((k) => !/^(yooworld:|yw\.|yw:e:)/.test(k)));
  ok(l0 === l1, 'saved looks unchanged after reload');
  ok(f && f.key === 'buns' && f.bones.length === 3, 'rig rebuilt after reload', f && f.key);
  ok(errs.length === 0, 'D: no console errors', errs.slice(0, 3)); errsAll.push(...errs);
  await ctx.close();
}
ok(errsAll.length === 0, 'no console errors (all pages)', errsAll.slice(0, 3));
const n = results.filter((r) => r.ok).length; console.log(`\n${n}/${results.length} passed`);
if (OUT) fs.writeFileSync(OUT + '/e2e-hair-motion.json', JSON.stringify(results, null, 1));
await b.close();
