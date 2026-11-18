import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Movement Step 2 – optional touch tap-to-move (settings) and desktop click-to-move, end-to-end on the real game.
// Touch = real CDP touch events (Chrome turns them into pointer + click events like a phone); desktop = real mouse.
// usage: node tools/e2e-step2.mjs [url] ; DEV=iphone15|ipad|desktop (default iphone15), SHOTS=dir, DPR=<n>
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5230'}/`;
const DEVS = {
  iphone15: { w: 852, h: 393, dpr: 3, touch: true, label: 'iPhone 15 paysage' }, ipad: { w: 1024, h: 768, dpr: 2, touch: true, label: 'iPad paysage' },
  pixel7: { w: 915, h: 412, dpr: 2.625, touch: true, label: 'Pixel 7 paysage' }, desktop: { w: 1440, h: 900, dpr: 1, touch: false, label: 'Ordinateur 1440×900' },
};
const devName = process.env.DEV ?? 'iphone15'; const dev = DEVS[devName]; const DPR = Number(process.env.DPR ?? dev.dpr); const TOUCH = dev.touch;
const SHOTS = process.env.SHOTS ?? 'shots/movement-step2'; fs.mkdirSync(SHOTS, { recursive: true }); const tag = process.env.TAG ? process.env.TAG + '_' : '';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: DPR, isMobile: TOUCH, hasTouch: TOUCH });
const p = await ctx.newPage(); const errs = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
const skipped = []; const skip = (m, why) => { console.log('SKIP ' + m + ' — ' + why); skipped.push({ test: m, why }); };
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m, extra }); if (!c) process.exitCode = 1; };
const sep = url.includes('?') ? '&' : '?';
const boot = async () => { await p.waitForFunction(() => window.game?.s.ready && window.__move && window.__cam, null, { timeout: 180000 }); await p.waitForTimeout(3500); await p.evaluate(() => { try { sessionStorage.setItem('yw.portrait', '1'); } catch { /* */ } }); };
await p.goto(url + sep + 'fresh=1', { timeout: 120000 }); await boot();
const cdp = await ctx.newCDPSession(p);
const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 1500) requestAnimationFrame(f); else res(n / 1.5); }; requestAnimationFrame(f); }));
console.log(`== Step 2 · ${dev.label} ${dev.w}x${dev.h} @${DPR}x ~${Math.round(fps)} fps (headless SwiftShader) · ${url} ==`);

// ---------- helpers ----------
const touches = new Map();
const sendTouch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.entries()].map(([id, t]) => ({ x: t.x, y: t.y, id, radiusX: 6, radiusY: 6, force: 1 })) });
async function down(id, x, y) { touches.set(id, { x, y }); await sendTouch('touchStart'); }
async function moveT(id, x, y) { touches.set(id, { x, y }); await sendTouch('touchMove'); }
async function up(id) { const t = touches.get(id); touches.delete(id); if (t) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...touches.entries()].map(([i, q]) => ({ x: q.x, y: q.y, id: i })) }); }
/** one finger tap (touch devices) or a mouse click (desktop) at screen px */
async function tapAt(x, y) { if (TOUCH) { await down(9, x, y); await p.waitForTimeout(60); await up(9); } else await p.mouse.click(x, y); }
const mv = () => p.evaluate(() => window.__move());
const scr = (x, y, z) => p.evaluate(([x, y, z]) => { const v = new window.__cam.position.constructor(x, y, z).project(window.__cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, v.z]; }, [x, y, z]);
/** UI rects a floor tap must avoid (top bar, dock, joystick, sheets, menus) */
const uiRects = () => p.evaluate(() => [...document.querySelectorAll('.hud-top > *, .dock, .joy, .sheet, .imenu, .toast, .editbar, .joy-hint')].map((e) => { const r = e.getBoundingClientRect(); return [r.x - 14, r.y - 14, r.right + 14, r.bottom + 14]; }).filter((r) => r[2] - r[0] > 20));
/** free floor points (disc radius 0.2 m free on the nav grid) that are on screen, away from the UI, sorted by distance to `near` */
async function floorSpots({ minDist = 0, maxDist = 99, from = null, n = 40 } = {}) {
  const rects = await uiRects();
  return p.evaluate(([rects, minDist, maxDist, from, n]) => {
    const nav = window.__world.nav, c = window.__world.chars[window.game.s.activeChar]; const fx = from ? from[0] : c.pos.x, fz = from ? from[1] : c.pos.z; const V = window.__cam.position.constructor;
    const bl = (x, z) => x < 0 || z < 0 || !nav.free(Math.floor(x / nav.cell), Math.floor(z / nav.cell)); const R = 0.2;
    const disc = (x, z) => [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R], [R * .7, R * .7], [-R * .7, R * .7], [R * .7, -R * .7], [-R * .7, -R * .7]].some(([a, b2]) => bl(x + a, z + b2));
    const out = [];
    for (let j = 0; j < nav.nz; j++) for (let i = 0; i < nav.nx; i++) {
      const x = (i + 0.5) * nav.cell, z = (j + 0.5) * nav.cell; if (disc(x, z)) continue; const d = Math.hypot(x - fx, z - fz); if (d < minDist || d > maxDist) continue;
      const v = new V(x, 0, z).project(window.__cam); const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
      if (sx < 30 || sy < 30 || sx > innerWidth - 30 || sy > innerHeight - 30) continue; if (rects.some((r) => sx > r[0] && sx < r[2] && sy > r[1] && sy < r[3])) continue;
      if (nav.path(new V(fx, 0, fz), new V(x, 0, z)).length === 0) continue;
      out.push({ x, z, sx, sy, d });
    }
    out.sort((a, b2) => a.d - b2.d); const step = Math.max(1, Math.floor(out.length / n)); return out.filter((_, k) => k % step === 0).slice(0, n);
  }, [rects, minDist, maxDist, from, n]);
}
const tapLog = () => p.evaluate(() => window.__move().tap);
/** tap a floor point (world x,z) and return what the game did with it; `hit` = the tap reached the floor at that point */
async function tapFloor(x, z) {
  const [sx, sy] = await scr(x, 0, z); const before = (await tapLog()).count; await tapAt(sx, sy);
  await p.waitForFunction((n) => window.__move().tap.count > n, before, { timeout: 2500, polling: 40 }).catch(() => {});
  const t = await tapLog(); const hit = t.count > before && t.last && Math.hypot(t.last.x - x, t.last.z - z) < 0.2; return { hit, last: t.last, sx, sy };
}
/** tap the first spot of `spots` that the floor actually receives (a spot under a lamp shade / tall plant goes to the furniture instead) */
async function tapSomeFloor(spots) { for (const s of spots) { const r = await tapFloor(s.x, s.z); if (r.hit) return { ...r, spot: s }; await closeMenu(); } return null; }
const closeMenu = () => p.evaluate(() => { if (window.game.s.menuItem) window.game.store.set({ menuItem: null }); if (window.game.s.panel) window.game.setPanel(null); });
const place = (x, z, yaw = 0) => p.evaluate(([x, z, yaw]) => { const c = window.__world.chars[window.game.s.activeChar]; c.pos.set(x, 0, z); c.yaw = yaw; c.path = []; c.mode = 'idle'; c.sitOn = undefined; c.emote = false; c.speed = 0; c.pendingSeat = undefined; }, [x, z, yaw]);
const sampler = () => p.evaluate(() => { window.__samples = []; if (window.__sampling) return; window.__sampling = true; const f = () => { const m = window.__move(); window.__samples.push({ t: performance.now(), x: m.pos[0], z: m.pos[1], speed: m.speed, path: m.path, mode: m.mode, mk: m.marker.phase, a: m.marker.alpha, run: m.running }); requestAnimationFrame(f); }; requestAnimationFrame(f); });
const samples = () => p.evaluate(() => window.__samples.slice()); const resetSamples = () => p.evaluate(() => { window.__samples = []; });
/** every sampled avatar centre is inside the world and outside every blocked nav cell (walls, furniture + padding, sea, props) */
const allFree = () => p.evaluate(() => { const n = window.__world.nav; return window.__samples.filter((s) => s.x < 0 || s.z < 0 || !n.free(Math.floor(s.x / n.cell), Math.floor(s.z / n.cell))).length; });
async function waitArrive(x, z, ms = 25000) {
  const t0 = Date.now(); await p.waitForFunction(() => { const m = window.__move(); return m.path === 0 && m.speed < 0.01 && m.mode !== 'walk'; }, null, { timeout: ms, polling: 60 }).catch(() => {});
  const m = await mv(); return { dist: Math.hypot(m.pos[0] - x, m.pos[1] - z), ms: Date.now() - t0, m };
}
const J = () => p.evaluate(() => { const j = document.querySelector('.joy'); const k = document.querySelector('.joy-knob'); if (!j) return null; const r = j.getBoundingClientRect(); const cs = getComputedStyle(j); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, R: Math.max(20, j.offsetWidth / 2 - k.offsetWidth * 0.18), vis: cs.visibility !== 'hidden' && Number(cs.opacity) > 0.3 }; });
async function stickTo(d, a, id = 1, steps = 4) { const joy = await J(); const tx = joy.cx + Math.cos(a * Math.PI / 180) * d * joy.R, ty = joy.cy - Math.sin(a * Math.PI / 180) * d * joy.R; if (!touches.has(id)) await down(id, joy.cx, joy.cy); const from = touches.get(id); for (let i = 1; i <= steps; i++) await moveT(id, from.x + (tx - from.x) * i / steps, from.y + (ty - from.y) * i / steps); await p.waitForFunction((m) => Math.abs(window.__move().stick.mag - m) < 0.011, Math.min(1, d), { timeout: 3000, polling: 50 }).catch(() => {}); }
const zoom = () => p.evaluate(() => window.__cam.zoom);
/** a start A and a target B, both free, whose straight line crosses furniture (blocked cells), B on screen */
async function behindFurniture() {
  const spots = await floorSpots({ minDist: 0, n: 400 }); const rects = await uiRects();
  return p.evaluate(([spots]) => {
    const nav = window.__world.nav; const V = window.__cam.position.constructor; const items = window.__itemPoints();
    const blk = (x, z) => !nav.free(Math.floor(x / nav.cell), Math.floor(z / nav.cell));
    const under = (x, z) => items.some((it) => Math.abs(x - it.x) < Math.max(it.w, it.d) / 2 && Math.abs(z - it.z) < Math.max(it.w, it.d) / 2);
    let best = null;
    for (const A of spots) for (const B of spots) {
      const L = Math.hypot(B.x - A.x, B.z - A.z); if (L < 1.6 || L > 4) continue;
      let crossed = 0; for (let s = 0.2; s < L - 0.2; s += 0.05) { const x = A.x + (B.x - A.x) * s / L, z = A.z + (B.z - A.z) * s / L; if (blk(x, z) && under(x, z)) crossed++; }
      if (crossed < 6) continue; const path = nav.path(new V(A.x, 0, A.z), new V(B.x, 0, B.z)); if (!path.length) continue;
      let pl = 0, px = A.x, pz = A.z; for (const w of path) { pl += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z; }
      if (pl < L * 1.08) continue; const score = crossed; if (!best || score > best.score) best = { A, B, L, pl, crossed: crossed * 0.05, score };
    }
    return best;
  }, [spots, rects]);
}
async function tapFurniture() {
  const items = (await p.evaluate(() => window.__itemPoints())).filter((it) => it.interaction); const rects = await uiRects();
  for (const it of items) {
    const [sx, sy, z] = await scr(it.x, it.y, it.z); if (z > 1 || sx < 40 || sy < 40 || sx > dev.w - 40 || sy > dev.h - 40 || rects.some((r) => sx > r[0] && sx < r[2] && sy > r[1] && sy < r[3])) continue;
    const c0 = (await tapLog()).count; await tapAt(sx, sy); await p.waitForTimeout(700);
    const st = await p.evaluate(() => ({ menu: window.game.s.menuItem, el: !!document.querySelector('.imenu') }));
    if (st.menu === it.uid || (st.menu && st.el)) return { it, ...st, floorTaps: (await tapLog()).count - c0 };
    await closeMenu();
  }
  return null;
}
async function pinch(cx, cy) { const z0 = await zoom(); await down(2, cx - 40, cy); await down(3, cx + 40, cy); for (let i = 1; i <= 10; i++) { await moveT(2, cx - 40 - i * 9, cy); await moveT(3, cx + 40 + i * 9, cy); await p.waitForTimeout(40); } await up(3); await up(2); await p.waitForTimeout(500); return [z0, await zoom()]; }
await sampler();

// ======================= TOUCH DEVICES =======================
if (TOUCH) {
  const joy = await J(); ok(joy && joy.vis, 'joystick shown (default mobile control)');
  const set0 = await p.evaluate(() => ({ s: window.__move().settings, raw: localStorage.getItem('yw.controls.v1') }));
  ok(set0.s.touchTapToMove === false && set0.raw === null, 'default setting = "Joystick seul" (tap-to-move OFF, nothing saved yet)', set0);
  // --- OFF: a tap on free floor does nothing
  { const m0 = await mv(); const spots = await floorSpots({ minDist: 1.5 }); const r = await tapSomeFloor(spots); await p.waitForTimeout(1500); const m1 = await mv();
    const moved = Math.hypot(m1.pos[0] - m0.pos[0], m1.pos[1] - m0.pos[1]);
    ok(r && r.last.result === 'ignored' && moved < 0.01 && m1.path === 0 && m1.marker.phase === 'hidden', `OFF: tap on the floor ${r ? r.spot.d.toFixed(1) : '?'} m away is ignored (moved ${moved.toFixed(3)} m, no marker)`, { result: r?.last?.result, kind: r?.last?.kind }); }
  // --- OFF: furniture still opens its menu
  { const f = await tapFurniture(); ok(!!f && f.el && f.floorTaps === 0, `OFF: tapping furniture still opens its menu (${f?.it.name ?? 'none found'})`, f && { uid: f.it.uid });
    if (f) await p.screenshot({ path: `${SHOTS}/${tag}${devName}_furniture_menu_off.png` }); await closeMenu(); await p.waitForTimeout(300); }
  // --- settings panel: open from the HUD, enable tap-to-move
  { await closeMenu(); const chip = await p.$('.chip.settings'); const vis = chip && await chip.isVisible(); const bb = chip && await chip.boundingBox();
    if (bb) await tapAt(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForSelector('.settings-sheet', { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(500);
    const open = await p.$('.settings-sheet'); const sel0 = await p.evaluate(() => document.querySelector('.ctl-opt.on')?.getAttribute('data-ctl'));
    ok(vis && open && sel0 === 'joystick', 'settings panel opens from the ⚙️ chip, "Joystick seul" selected');
    await p.screenshot({ path: `${SHOTS}/${tag}${devName}_settings_default.png` });
    const opt = await p.$('.ctl-opt[data-ctl="tap"]'); const ob = opt && await opt.boundingBox(); if (ob) await tapAt(ob.x + ob.width / 2, ob.y + ob.height / 2); await p.waitForTimeout(600);
    const st = await p.evaluate(() => ({ s: window.__move().settings, raw: localStorage.getItem('yw.controls.v1'), sel: document.querySelector('.ctl-opt.on')?.getAttribute('data-ctl') }));
    ok(st.s.touchTapToMove === true && JSON.parse(st.raw).touchTapToMove === true && st.sel === 'tap', 'choosing "Joystick + toucher pour aller" enables it and saves it on the device', st);
    await p.screenshot({ path: `${SHOTS}/${tag}${devName}_settings_tap.png` });
    const x = await p.$('.settings-sheet .x'); const xb = x && await x.boundingBox(); if (xb) await tapAt(xb.x + xb.width / 2, xb.y + xb.height / 2); await p.waitForTimeout(400);
    ok(!(await p.$('.settings-sheet')), 'settings panel closes'); }
  // --- persistence across a reload
  { await p.reload(); await boot(); await sampler(); const s = await p.evaluate(() => window.__move().settings); ok(s.touchTapToMove === true && await p.evaluate(() => window.game.s.ready), 'setting kept after reload (game loads normally)', s); }
}

// ======================= TAP / CLICK TO MOVE =======================
const KIND = TOUCH ? 'tap' : 'click';
// --- walk to a free spot, marker shown then gone
{
  await closeMenu(); const spots = await floorSpots({ minDist: 1.8, maxDist: 3.5 }); await resetSamples();
  const r = await tapSomeFloor(spots); const t0 = Date.now();
  await p.waitForTimeout(350); const mk = await mv(); if (r) await p.screenshot({ path: `${SHOTS}/${tag}${devName}_marker.png` });
  const tx = r?.last?.tx ?? r?.spot.x, tz = r?.last?.tz ?? r?.spot.z; const a = r ? await waitArrive(tx, tz) : null; await p.waitForTimeout(700); const m2 = await mv();
  const ss = await samples(); const vmax = Math.max(...ss.map((s) => s.speed));
  ok(r && (r.last.result === 'moved' || r.last.result === 'snapped') && r.last.kind === (TOUCH ? 'touch' : 'mouse'), `${KIND} on a free floor spot ${r ? r.spot.d.toFixed(1) : '?'} m away starts a walk (${r?.last?.result}, pointer ${r?.last?.kind})`);
  ok(mk.marker.phase === 'active' && mk.marker.alpha > 0.3 && Math.hypot(mk.marker.x - tx, mk.marker.z - tz) < 0.05, 'destination marker visible on the target while walking', mk.marker);
  ok(a && a.dist < 0.08, `arrives at the destination (error ${a ? (a.dist * 100).toFixed(1) : '?'} cm, ${a ? Date.now() - t0 : '?'} ms, top speed ${vmax.toFixed(2)} m/s ≈ natural walk 0.85)`);
  ok(m2.marker.phase === 'hidden' && vmax < 1.0 && vmax > 0.6, 'marker fades out after arrival; walk speed natural', { phase: m2.marker.phase, vmax: +vmax.toFixed(2) });
  ok(await allFree() === 0, 'path stayed on walkable floor (never in a wall / furniture cell)');
}
// --- re-target mid-walk
{
  const far = await floorSpots({ minDist: 2.2, maxDist: 4 }); await resetSamples(); const r1 = await tapSomeFloor(far);
  await p.waitForFunction(() => window.__move().speed > 0.5, null, { timeout: 8000, polling: 40 }).catch(() => {}); await p.waitForTimeout(400);
  const m = await mv(); const alt = (await floorSpots({ minDist: 1.5, maxDist: 3.5, from: m.pos })).filter((s) => r1 && Math.hypot(s.x - r1.spot.x, s.z - r1.spot.z) > 1.5);
  const tRe = await p.evaluate(() => performance.now()); const r2 = await tapSomeFloor(alt); const tx = r2?.last?.tx ?? 0, tz = r2?.last?.tz ?? 0;
  const a = r2 ? await waitArrive(tx, tz) : null; const ss = (await samples()).filter((s) => s.t > tRe && s.t < tRe + 600);
  const minV = ss.length ? Math.min(...ss.map((s) => s.speed)) : 0;
  ok(r1 && r2 && a && a.dist < 0.08 && minV > 0.15, `${KIND} elsewhere mid-walk re-targets smoothly (speed never dropped below ${minV.toFixed(2)} m/s, arrived ${a ? (a.dist * 100).toFixed(1) : '?'} cm from the new spot)`);
  ok(await allFree() === 0, 're-targeted walk stayed on walkable floor');
}
// --- destination behind furniture: walks around it
{
  const pair = await behindFurniture();
  if (!pair) ok(false, 'behind-furniture: no test pair found');
  else {
    await place(pair.A.x, pair.A.z); await p.evaluate(() => window.dispatchEvent(new Event('yw:follow'))); await p.waitForTimeout(1500); await resetSamples();
    const r = await tapFloor(pair.B.x, pair.B.z); const a = await waitArrive(pair.B.x, pair.B.z); const ss = await samples();
    let len = 0; for (let i = 1; i < ss.length; i++) len += Math.hypot(ss[i].x - ss[i - 1].x, ss[i].z - ss[i - 1].z);
    const inBlocked = await allFree();
    if (!(r.hit && a.dist < 0.08)) fs.writeFileSync(`${SHOTS}/${tag}debug_behind_${devName}.json`, JSON.stringify({ pair, r, a, ss: ss.slice(0, 80), m: await mv() }, null, 1));
    ok(r.hit && a.dist < 0.08 && inBlocked === 0 && len > pair.L * 1.05, `${KIND} behind furniture: routes around it (straight line ${pair.L.toFixed(2)} m crosses ${pair.crossed.toFixed(2)} m of furniture, walked ${len.toFixed(2)} m, ${inBlocked} frames inside a blocked cell)`, { result: r.last?.result, dist: +a.dist.toFixed(3) });
  }
}
// --- tap on a non-walkable spot of the floor (furniture padding / under a low item): snaps to the nearest reachable point
{
  const cand = await p.evaluate(() => { const nav = window.__world.nav; const out = []; const V = window.__cam.position.constructor;
    for (let j = 1; j < nav.nz - 1; j++) for (let i = 1; i < nav.nx - 1; i++) { if (nav.free(i, j)) continue; const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => nav.free(i + a, j + b)); if (!nb) continue;
      const x = (i + 0.5) * nav.cell, z = (j + 0.5) * nav.cell; const v = new V(x, 0, z).project(window.__cam); const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight; if (sx > 60 && sy > 70 && sx < innerWidth - 60 && sy < innerHeight - 110) out.push({ x, z }); }
    return out.sort(() => Math.random() - 0.5).slice(0, 25); });
  let res = null; for (const c of cand) { const r = await tapFloor(c.x, c.z); if (r.hit) { res = { ...r, c }; break; } await closeMenu(); }
  if (!res) ok(false, 'snap: no visible floor spot inside a blocked cell received the tap');
  else { const a = await waitArrive(res.last.tx ?? 0, res.last.tz ?? 0); const free = await p.evaluate(([x, z]) => { const n = window.__world.nav; return n.free(Math.floor(x / n.cell), Math.floor(z / n.cell)); }, a.m.pos);
    ok(res.last.result === 'snapped' && free && Math.hypot((res.last.tx ?? 0) - res.c.x, (res.last.tz ?? 0) - res.c.z) < 0.9, `${KIND} on a blocked floor cell snaps to the nearest free point (${Math.hypot((res.last.tx ?? 0) - res.c.x, (res.last.tz ?? 0) - res.c.z).toFixed(2)} m away) and stops on free floor`, { result: res.last.result }); }
}
// --- the wall is never crossed: a click on the back wall (above the floor) does not walk outside the room
{
  await resetSamples(); const nav = await p.evaluate(() => [window.__world.nav.nx * window.__world.nav.cell, window.__world.nav.nz * window.__world.nav.cell]);
  const [sx, sy] = await scr(nav[0] * 0.55, 1.4, 0.02); const c0 = (await tapLog()).count; await tapAt(sx, sy); await p.waitForTimeout(1500); const t = await tapLog(); const m = await mv();
  const inside = m.pos[0] >= 0 && m.pos[1] >= 0 && m.pos[0] <= nav[0] && m.pos[1] <= nav[1];
  ok(inside && await allFree() === 0 && (t.count === c0 || t.last.result !== 'moved' || (t.last.tz ?? 1) > 0.15), `${KIND} on the back wall never walks through it (${t.count === c0 ? 'tap not taken by the floor' : t.last.result})`); await closeMenu();
}
// --- double tap / double click = run
{
  const spots = await floorSpots({ minDist: 2, maxDist: 4 }); const s = spots.find(Boolean);
  if (s) { const [sx, sy] = await scr(s.x, 0, s.z); if (TOUCH) { for (let k = 0; k < 2; k++) { await down(9, sx, sy); await up(9); } } else await p.mouse.dblclick(sx, sy);
    await p.waitForTimeout(900); const m = await mv(); await waitArrive(s.x, s.z);
    const gap = m.tap.last?.gap ?? 0;
    if (m.running !== true && gap > 380) skip(`double ${KIND} = run`, `harness: the headless renderer (~${Math.round(fps)} fps) delivered the 2nd ${KIND} ${Math.round(gap)} ms after the 1st (> 380 ms double-tap window), cannot test here`);
    else ok(m.running === true, `double ${KIND} = run (running ${m.running}, gap between the two ${KIND}s as seen by the game ${Math.round(m.tap.last?.gap ?? -1)} ms)`, { dbl: m.tap.last?.dbl, result: m.tap.last?.result }); }
}

if (TOUCH) {
  // --- joystick interrupts a tap path at any time
  { const far = await floorSpots({ minDist: 2.2, maxDist: 4 }); const r = await tapSomeFloor(far); await p.waitForFunction(() => window.__move().speed > 0.4, null, { timeout: 8000, polling: 40 }).catch(() => {});
    const m0 = await mv(); await stickTo(0.9, 90); await p.waitForFunction(() => window.__move().engaged && window.__move().frames > 0, null, { timeout: 3000, polling: 40 }).catch(() => {}); await p.waitForTimeout(300);
    const m1 = await mv(); await p.waitForTimeout(900); const m2 = await mv(); await up(1);
    await p.waitForFunction(() => { const m = window.__move(); return !m.stick.active && m.speed < 0.02 && !m.driving; }, null, { timeout: 3000, polling: 40 }).catch(() => {}); const m3 = await mv();
    const drove = Math.hypot(m2.pos[0] - m1.pos[0], m2.pos[1] - m1.pos[1]);
    ok(r && m0.path > 0 && m1.path === 0 && m1.engaged && m1.marker.phase !== 'active' && drove > 0.2 && m3.path === 0 && m3.speed < 0.02,
      `joystick interrupts the tap path (path ${m0.path} → ${m1.path}, marker ${m1.marker.phase}), stick drives (${drove.toFixed(2)} m in 0.9 s), stops on release`, { m0path: m0.path, m1: { path: m1.path, engaged: m1.engaged, mk: m1.marker.phase }, m3: { path: m3.path, speed: +m3.speed.toFixed(3), mode: m3.mode } }); }
  // --- furniture menu still opens with tap-to-move ON, and does not walk to the floor behind
  { await closeMenu(); const c0 = await mv(); const f = await tapFurniture(); ok(!!f && f.el && f.floorTaps === 0, `ON: tapping furniture still opens its menu (${f?.it.name ?? 'none found'}), no floor walk triggered`);
    if (f) await p.screenshot({ path: `${SHOTS}/${tag}${devName}_furniture_menu_on.png` }); await closeMenu(); }
}

// ======================= BEACH =======================
{
  await closeMenu(); await p.evaluate(() => window.game.travel('beach')); await p.waitForFunction(() => window.__move().location === 'beach', null, { timeout: 30000 }); await p.waitForTimeout(3500); await resetSamples();
  const spots = await floorSpots({ minDist: 1.5, maxDist: 3.5 }); const r = await tapSomeFloor(spots); await p.waitForTimeout(400); if (r) await p.screenshot({ path: `${SHOTS}/${tag}${devName}_beach_marker.png` });
  const a = r ? await waitArrive(r.last.tx ?? 0, r.last.tz ?? 0) : null;
  ok(r && a && a.dist < 0.08 && await allFree() === 0, `Yoo Plage: ${KIND} on the sand walks there (${a ? (a.dist * 100).toFixed(1) : '?'} cm), never into the sea or props`);
  // sea: walk the avatar to the shoreline (camera follows) so the water is on screen, then tap a point far in the water
  { const shore = await p.evaluate(() => { const n = window.__world.nav; for (const [x, z] of [[4.2, 5], [4.4, 6], [4.6, 4], [4.8, 7], [5, 5]]) if (n.free(Math.floor(x / n.cell), Math.floor(z / n.cell))) return [x, z]; return [5, 5]; });
    await place(shore[0], shore[1]); await p.evaluate(() => window.dispatchEvent(new Event('yw:follow'))); await p.waitForTimeout(2500); }
  const sea = await p.evaluate(() => { const V = window.__cam.position.constructor; const nav = window.__world.nav; const out = [];
    for (let x = -12; x < 3; x += 0.25) for (let z = -2; z < 16; z += 0.25) { const fr = (() => { for (let dx = -1; dx <= 1; dx += 0.2) for (let dz = -1; dz <= 1; dz += 0.2) { const px = x + dx, pz = z + dz; if (px >= 0 && pz >= 0 && nav.free(Math.floor(px / nav.cell), Math.floor(pz / nav.cell))) return true; } return false; })(); if (fr) continue;
      const v = new V(x, 0, z).project(window.__cam); const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight; if (sx > 60 && sy > 80 && sx < innerWidth - 60 && sy < innerHeight - 110) out.push({ x, z, sx, sy }); }
    return out.sort(() => Math.random() - 0.5).slice(0, 14); });
  console.log(`  sea candidates on screen: ${sea.length}`); let sr = null; const m0 = await mv(); for (const s of sea) { const q = await tapFloor(s.x, s.z); if (q.hit) { sr = q; break; } }
  await p.waitForTimeout(200); const mk = await mv(); await p.waitForTimeout(1200); const m1 = await mv();
  ok(sr && sr.last.result.startsWith('invalid') && mk.marker.phase === 'invalid' && Math.hypot(m1.pos[0] - m0.pos[0], m1.pos[1] - m0.pos[1]) < 0.01, `Yoo Plage: ${KIND} in the sea is refused (${sr?.last?.result ?? 'no sea point received the tap'}), short "invalid" ripple, no movement`);
  await p.evaluate(() => window.game.travel('home')); await p.waitForTimeout(2500);
}

if (TOUCH) {
  // --- pinch zoom unaffected (and never treated as a tap)
  { const m0 = await mv(); const c0 = (await tapLog()).count; const [z0, z1] = await pinch(dev.w * 0.6, dev.h * 0.45); const m1 = await mv(); await p.waitForTimeout(600); const c1 = (await tapLog()).count;
    ok(z1 > z0 * 1.1 && c1 === c0 && m1.path === 0, `ON: pinch-zoom works (${z0.toFixed(0)} → ${z1.toFixed(0)}) and is never taken as a floor tap`, { taps: c1 - c0 });
    await p.evaluate(() => window.dispatchEvent(new Event('yw:follow'))); }
}
if (!TOUCH) {
  const joy = await J(); ok(!joy || !joy.vis, 'desktop: no joystick by default (mouse + keyboard)');
  await resetSamples(); const m0 = await mv(); await p.keyboard.down('KeyD'); await p.waitForTimeout(900); await p.keyboard.up('KeyD'); await p.waitForTimeout(500); const m1 = await mv();
  ok(Math.hypot(m1.pos[0] - m0.pos[0], m1.pos[1] - m0.pos[1]) > 0.3, 'desktop: keyboard (WASD/ZQSD) still moves the avatar');
  const f = await tapFurniture(); ok(!!f && f.el && f.floorTaps === 0, `desktop: clicking furniture opens its menu (${f?.it.name ?? 'none found'})`); await closeMenu();
  const set = await p.evaluate(() => window.__move().settings); ok(set.touchTapToMove === false, 'desktop: click-to-move works without touching the touch setting (still off)');
  // settings panel on desktop (mouse info line)
  await p.click('.chip.settings'); await p.waitForTimeout(500); await p.screenshot({ path: `${SHOTS}/${tag}${devName}_settings.png` }); ok(!!(await p.$('.settings-sheet .ctl-note')), 'desktop: settings panel opens and explains click-to-move'); await closeMenu();
}
ok(errs.length === 0, 'no console / page errors', errs.slice(0, 5)); ok(bad.length === 0, 'no HTTP errors', bad.slice(0, 5));
fs.writeFileSync(`${SHOTS}/${tag}report_${devName}.json`, JSON.stringify({ device: devName, label: dev.label, url, fps: Math.round(fps), results, skipped }, null, 2));
console.log(`SUMMARY ${devName}: ${results.filter((r) => r.ok).length}/${results.length} passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
await b.close();
