import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Movement Step 1 – virtual joystick end-to-end on the real game with REAL touch input (CDP Input.dispatchTouchEvent,
// which Chrome turns into pointer events exactly like a phone). Measures speeds from the game state (window.__move).
// usage: node tools/e2e-joystick.mjs [url] ; DEV=iphone15|pixel7|se|ipad (default iphone15), DPR=<n>, SHOTS=dir, FULL=0 (quick)
const url = (process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5230'}/`);
const DEVS = {
  iphone15: { w: 852, h: 393, dpr: 3, label: 'iPhone 15 paysage' }, pixel7: { w: 915, h: 412, dpr: 2.625, label: 'Pixel 7 paysage' },
  se: { w: 667, h: 375, dpr: 2, label: 'iPhone SE paysage' }, ipad: { w: 1024, h: 768, dpr: 2, label: 'iPad paysage' },
};
const devName = process.env.DEV ?? 'iphone15'; const dev = DEVS[devName]; const DPR = Number(process.env.DPR ?? dev.dpr);
const SHOTS = process.env.SHOTS ?? 'shots/movement'; const FULL = process.env.FULL !== '0';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errs = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m, extra }); if (!c) process.exitCode = 1; };
const sep = url.includes('?') ? '&' : '?';
await p.goto(url + sep + 'fresh=1'); await p.waitForFunction(() => window.game?.s.ready && window.__move, null, { timeout: 180000 }); await p.waitForTimeout(4000);
const cdp = await ctx.newCDPSession(p);

// ---------- helpers ----------
const touches = new Map();
const sendTouch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.entries()].map(([id, t]) => ({ x: t.x, y: t.y, id, radiusX: 6, radiusY: 6, force: 1 })) });
async function down(id, x, y) { touches.set(id, { x, y }); await sendTouch('touchStart'); }
async function moveT(id, x, y) { touches.set(id, { x, y }); await sendTouch('touchMove'); }
async function up(id) { const t = touches.get(id); touches.delete(id); if (t) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: t.x, y: t.y, id }] }); }
const J = async () => p.evaluate(() => { const j = document.querySelector('.joy'); const k = document.querySelector('.joy-knob'); if (!j) return null; const r = j.getBoundingClientRect(), kr = k.getBoundingClientRect(); const cs = getComputedStyle(j);
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, R: Math.max(20, j.offsetWidth / 2 - k.offsetWidth * 0.18), knob: [kr.x + kr.width / 2, kr.y + kr.height / 2], vis: cs.visibility !== 'hidden' && Number(cs.opacity) > 0.3, touchAction: cs.touchAction }; });
let joy = await J();
/** put the thumb at displacement d (0..1) towards screen angle a (deg, 0 = right, 90 = up), gliding there like a finger */
async function stickTo(d, a, id = 1, steps = 4) {
  const tx = joy.cx + Math.cos(a * Math.PI / 180) * d * joy.R, ty = joy.cy - Math.sin(a * Math.PI / 180) * d * joy.R;
  if (!touches.has(id)) await down(id, joy.cx, joy.cy);
  const from = touches.get(id); for (let i = 1; i <= steps; i++) await moveT(id, from.x + (tx - from.x) * i / steps, from.y + (ty - from.y) * i / steps);
  // Chrome delivers touch/pointer moves aligned to the next rendered frame: on a 5 fps renderer the last move can land
  // ~0.3 s after CDP returns. Wait until the game's stick actually reads the requested displacement.
  await p.waitForFunction((m) => Math.abs(window.__move().stick.mag - m) < 0.011, Math.min(1, d), { timeout: 3000, polling: 50 }).catch(() => {});
}
const mv = () => p.evaluate(() => window.__move());
const sampler = () => p.evaluate(() => { window.__samples = []; if (window.__sampling) return; window.__sampling = true; const f = () => { const m = window.__move(); window.__samples.push({ t: performance.now(), sim: m.simTime, x: m.pos[0], z: m.pos[1], speed: m.speed, v: Math.hypot(m.vel[0], m.vel[1]), mode: m.mode, d: m.d, act: m.stick.active, fr: m.frames, bl: m.blocked, yaw: m.yaw, anim: m.anim && { w: m.anim.walk, r: m.anim.run, i: m.anim.idle, wts: m.anim.walkTS, rts: m.anim.runTS, s: m.anim.speed } }); requestAnimationFrame(f); }; requestAnimationFrame(f); });
const samples = () => p.evaluate(() => window.__samples.slice());
const resetSamples = () => p.evaluate(() => { window.__samples = []; });
/** teleport the player (test setup only) */
const place = (x, z, yaw = 0) => p.evaluate(([x, z, yaw]) => { const c = window.__world.chars[window.game.s.activeChar]; c.pos.set(x, 0, z); c.yaw = yaw; c.path = []; c.mode = 'idle'; c.sitOn = undefined; c.emote = false; c.speed = 0; }, [x, z, yaw]);
/** floor direction for a screen angle, using the live camera (same maths as the controller) */
const worldDir = (a) => p.evaluate((a) => { const d = new window.__cam.position.constructor(); window.__cam.getWorldDirection(d); const h = Math.hypot(d.x, d.z), fx = d.x / h, fz = d.z / h, sinEl = Math.max(0.2, Math.abs(d.y) / d.length());
  const x = Math.cos(a * Math.PI / 180), y = -Math.sin(a * Math.PI / 180); const up = -y / sinEl; const wx = -fz * x + fx * up, wz = fx * x + fz * up, l = Math.hypot(wx, wz); return [wx / l, wz / l]; }, a);
/** free-disc test on the live nav grid */
const freeRay = (x, z, dx, dz, len, R = 0.15) => p.evaluate(([x, z, dx, dz, len, R]) => { const n = window.__world.nav; const bl = (px, pz) => { if (px < 0 || pz < 0) return true; const i = Math.floor(px / n.cell), j = Math.floor(pz / n.cell); return !n.free(i, j); };
  const disc = (px, pz) => [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R], [R * 0.7, R * 0.7], [-R * 0.7, R * 0.7], [R * 0.7, -R * 0.7], [-R * 0.7, -R * 0.7]].some(([a, b]) => bl(px + a, pz + b)); for (let s = 0; s <= len; s += 0.05) if (disc(x + dx * s, z + dz * s)) return s; return len; }, [x, z, dx, dz, len, R]);
async function openStart(dir, len) { // the free start point with the longest clear run in that direction
  const n = await p.evaluate(() => [window.__world.nav.nx, window.__world.nav.nz, window.__world.nav.cell]); let best = null;
  for (let j = 1; j < n[1]; j += 2) for (let i = 1; i < n[0]; i += 2) { const x = (i + 0.5) * n[2], z = (j + 0.5) * n[2]; const r = await freeRay(x, z, dir[0], dir[1], len); if (!best || r > best.r) best = { x, z, r }; if (r >= len) return best; }
  return best;
}
const cellFree = (r = 0) => p.evaluate((r) => { const n = window.__world.nav; const ok = (x, z) => { const i = Math.floor(x / n.cell), j = Math.floor(z / n.cell); return x >= 0 && z >= 0 && n.free(i, j); };
  return window.__samples.every((s) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([a, b]) => ok(s.x + a, s.z + b))); }, r);
const camState = () => p.evaluate(() => { const c = window.__cam; const d = new c.position.constructor(); c.getWorldDirection(d); return { zoom: c.zoom, az: Math.atan2(d.x, d.z), pol: Math.acos(-d.y / d.length()) }; });
/** speed over a window, measured against the GAME clock (sum of frame times the controller integrated). On a frame-starved
 *  headless renderer, frames longer than the 0.25 s clamp lose time; the wall-clock speed is reported alongside. */
let lastWall = NaN, longFrames = 0, lastA = null, lastB = null;
/** steady-state speed: from 0.3 s (game time) after the stick input reached displacement dT until the last frame before release */
function steadySpeed(ss, dT, tEnd) { if (dT <= 0.1) { const w = ss.filter((s) => s.t <= tEnd); return w.length > 1 ? Math.hypot(w.at(-1).x - w[0].x, w.at(-1).z - w[0].z) : 0; }
  const i0 = ss.findIndex((s) => Math.abs(s.d - dT) < 0.01); if (i0 < 0) return NaN; const a = ss.slice(i0).find((s) => s.sim - ss[i0].sim >= 0.3); const bb = [...ss].reverse().find((s) => s.t <= tEnd && Math.abs(s.d - dT) < 0.01);
  if (!a || !bb || bb.sim <= a.sim) return NaN; return speedOver(ss, a.t, bb.t); }
function speedOver(ss, t0, t1) { const a = ss.find((s) => s.t >= t0), bb = [...ss].reverse().find((s) => s.t <= t1); if (!a || !bb || bb.t <= a.t) return NaN; const dist = Math.hypot(bb.x - a.x, bb.z - a.z); lastA = a; lastB = bb;
  lastWall = dist / ((bb.t - a.t) / 1000); const w = ss.filter((s) => s.t >= a.t && s.t <= bb.t); longFrames = w.filter((s, i) => i && s.t - w[i - 1].t > 250).length; return dist / Math.max(1e-6, bb.sim - a.sim); }
/** One steady-speed measurement on a lane verified clear on the live nav grid (disc radius 0.15 m > the 0.08 m collider).
 *  The window is sized so the avatar is still inside the clear part of the lane at its end (distance already walked
 *  while the finger glided in + 0.3 s settle + window ≤ lane − margin), so the measurement can never include the
 *  avatar arriving at the furniture / wall at the end of the lane. A run is re-done (max 2×, logged) only when the
 *  measurement itself is unusable: no frame inside the window (renderer stall) or fewer than 3 frames. Being
 *  blocked inside the verified-clear lane is NOT retried: it is reported as a real collision bug. */
const END_MARGIN = 0.25; const retries = [];
async function laneRun({ a, d, dir, st, target, maxWin, tag }) {
  let out = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await place(st.x, st.z, Math.atan2(dir[0], dir[1])); await p.waitForTimeout(150); await resetSamples(); lastA = lastB = null; lastWall = NaN; longFrames = 0;
    await stickTo(d, a, 1, 2); const m0 = await mv(); const t0 = m0.t;
    const walked = Math.max(0, (m0.pos[0] - st.x) * dir[0] + (m0.pos[1] - st.z) * dir[1]); const v = Math.max(0.15, MAX * (target ?? m0.factor));
    const room = st.r - END_MARGIN - walked - v * 0.3; const win = Math.max(250, Math.min(maxWin, room / v * 1000));
    await p.waitForTimeout(300 + win + 150); const m = await mv(); await up(1); await p.waitForTimeout(350);
    const ss = await samples(); const tEnd = t0 + 300 + win; const sp = steadySpeed(ss, m.d, tEnd);
    const inWin = lastA && lastB ? ss.filter((s) => s.t >= lastA.t && s.t <= lastB.t) : [];
    const endProg = lastB ? (lastB.x - st.x) * dir[0] + (lastB.z - st.z) * dir[1] : NaN;
    const blocked = inWin.some((s) => s.bl);
    out = { sp, ss, m, t0, win, tEnd, walked, endProg, blocked, frames: inWin.length, attempt };
    if (process.env.DUMP) fs.writeFileSync(`/tmp/dump_${devName}_${tag}.json`, JSON.stringify({ st, ...out }));
    const why = d <= 0.1 ? null : !Number.isFinite(sp) ? 'no frame in the measurement window (renderer stall)' : inWin.length < 3 ? `only ${inWin.length} frames in the window` : null;
    if (!why) break; retries.push({ tag, attempt, why }); console.log(`  retry ${tag}: ${why}`);
  }
  return out;
}
const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 1500) requestAnimationFrame(f); else res(n / 1.5); }; requestAnimationFrame(f); }));
const MAX = (await mv()).maxSpeed; const frameMs = 1000 / fps; const report = { device: devName, label: dev.label, viewport: [dev.w, dev.h], dpr: DPR, fps: Math.round(fps), maxSpeed: MAX, dirs: [], bands: [] };
console.log(`== ${dev.label} ${dev.w}x${dev.h} @${DPR}x  ~${Math.round(fps)} fps (headless SwiftShader) ==`);

// ---------- 1. layout ----------
const dock = await p.evaluate(() => { const r = document.querySelector('.dock')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
ok(joy && joy.vis, 'joystick visible in the game world (touch device, no flag)');
ok(joy.x >= 8 && joy.y + joy.h <= dev.h - 8 && joy.x + joy.w < dev.w / 2 && joy.y > dev.h / 2, 'joystick in the bottom-left corner, inside the screen edges', { rect: [joy.x, joy.y, joy.w].map(Math.round) });
ok(joy.w >= 120 && joy.w <= 160, `base ${Math.round(joy.w)} px (thumb-sized), knob travel radius ${Math.round(joy.R)} px`);
ok(!dock || joy.x + joy.w <= dock.x || joy.y + joy.h <= dock.y, 'joystick does not overlap the bottom dock', { dock: dock && [dock.x, dock.y, dock.r].map(Math.round) });
ok(joy.touchAction === 'none', 'touch-action:none on the joystick (no browser scroll / zoom)');
await sampler();

// ---------- 2. 8+ directions at full deflection ----------
const angles = process.env.ANGLES ? process.env.ANGLES.split(',').map(Number) : FULL ? [0, 45, 90, 135, 180, 225, 270, 315, 22.5, 112.5, 202.5, 292.5] : [0, 45, 90, 135];
for (const a of angles) {
  const dir = await worldDir(a); const st = await openStart(dir, 3.4);
  const R = await laneRun({ a, d: 1, dir, st, target: 1, maxWin: 900, tag: `dir${a}` }); const sp = R.sp;
  const first = lastA ?? R.ss[0], last = lastB ?? R.ss[R.ss.length - 1]; const ang = Math.atan2(last.z - first.z, last.x - first.x), want = Math.atan2(dir[1], dir[0]);
  const err = Math.abs(((ang - want) * 180 / Math.PI + 540) % 360 - 180);
  // on-screen direction of travel vs stick angle
  const scr = await p.evaluate(([a0, a1]) => { const V = window.__cam.position.constructor; const p0 = new V(a0[0], 0, a0[1]).project(window.__cam), p1 = new V(a1[0], 0, a1[1]).project(window.__cam); return Math.atan2((p1.y - p0.y) * innerHeight, (p1.x - p0.x) * innerWidth) * 180 / Math.PI; }, [[first.x, first.z], [last.x, last.z]]);
  const scrErr = Math.abs(((scr - a) + 540) % 360 - 180);
  report.dirs.push({ stickDeg: a, diagonal: a % 90 !== 0, speed: +sp.toFixed(3), wallClockSpeed: +lastWall.toFixed(3), longFrames, pctMax: Math.round(sp / MAX * 100), worldErrDeg: +err.toFixed(1), screenErrDeg: +scrErr.toFixed(1), lane: +st.r.toFixed(2), windowMs: Math.round(R.win), endInLane: +R.endProg.toFixed(2), frames: R.frames, blocked: R.blocked, retries: R.attempt });
  ok(sp > 0.9 * MAX && sp < 1.06 * MAX && err < 8 && scrErr < 10 && !R.blocked, `direction ${a}° → ${sp.toFixed(2)} m/s (${Math.round(sp / MAX * 100)} %), heading error ${err.toFixed(1)}° world / ${scrErr.toFixed(1)}° on screen`, { lane: +st.r.toFixed(2), end: +R.endProg.toFixed(2), win: Math.round(R.win), frames: R.frames, blocked: R.blocked });
}
const straight = report.dirs.filter((d) => !d.diagonal).map((d) => d.speed), diag = report.dirs.filter((d) => d.diagonal).map((d) => d.speed);
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length; report.straightAvg = +avg(straight).toFixed(3); report.diagAvg = +avg(diag).toFixed(3);
if (diag.length && straight.length) ok(Math.max(...diag) <= MAX * 1.06 && Math.abs(avg(diag) - avg(straight)) / avg(straight) < 0.05, `diagonals not faster: straight ${avg(straight).toFixed(2)} m/s vs diagonal ${avg(diag).toFixed(2)} m/s`);

// ---------- 3. speed bands ----------
const bands = FULL ? [[0.05, 'zone morte', 0], [0.15, 'lent (bord bas)', null], [0.225, 'lent', 0.30], [0.30, 'lent (bord haut)', null], [0.5, 'normal', 0.60], [0.6, 'normal (bord haut)', null], [0.775, 'rapide', 0.85], [0.95, 'max', 1.0], [1.25, 'max (butée)', 1.0]]
  : [[0.05, 'zone morte', 0], [0.225, 'lent', 0.30], [0.5, 'normal', 0.60], [0.775, 'rapide', 0.85], [1.25, 'max (butée)', 1.0]];
const bandDir = 90 + 45; // pick one well-open direction for all bands
const bdir = await worldDir(bandDir); const bst = await openStart(bdir, 3.4);
for (const [d, name, target] of bands) {
  // 'butée' = the finger slides past the rim (1.25 × the travel radius): the stick must clamp to exactly d = 1
  const R = await laneRun({ a: bandDir, d, dir: bdir, st: bst, target, maxWin: 1200, tag: `band${d}` }); const { sp, ss, m, t0 } = R;
  const an = ss.filter((s) => s.t > t0 + 300 && s.t <= R.tEnd && s.anim).pop()?.anim;
  report.bands.push({ d, name, target, inputD: +m.d.toFixed(3), factor: +m.factor.toFixed(3), speed: +sp.toFixed(3), wallClockSpeed: +lastWall.toFixed(3), longFrames, pctMax: Math.round(sp / MAX * 100), lane: +bst.r.toFixed(2), windowMs: Math.round(R.win), frames: R.frames, blocked: R.blocked, anim: an && { s: +an.s.toFixed(3), walk: +an.w.toFixed(2), run: +an.r.toFixed(2), walkTS: +an.wts.toFixed(3), runTS: +an.rts.toFixed(3) } });
  if (target === 0) ok(sp < 0.01 && m.speed === 0, `dead zone ${d * 100}% → no movement (${sp.toFixed(3)} m/s)`);
  else if (d > 1) ok(m.d === 1 && Math.abs(sp / MAX - target) < 0.06 && !R.blocked, `${name}: finger past the rim → d=${m.d.toFixed(3)}, ${sp.toFixed(2)} m/s = ${Math.round(sp / MAX * 100)} % of max (target 100 %)`);
  else if (target != null) ok(Math.abs(sp / MAX - target) < 0.06 && !R.blocked, `${name} band d=${d}: ${sp.toFixed(2)} m/s = ${Math.round(sp / MAX * 100)} % of max (target ≈${target * 100} %)`);
  else ok(sp > 0 && !R.blocked, `${name} d=${d}: ${sp.toFixed(2)} m/s (${Math.round(sp / MAX * 100)} %)`);
}
const bs = report.bands.filter((x) => x.target !== 0).map((x) => x.speed); ok(bs.every((v, i) => i === 0 || v >= bs[i - 1] - 0.03), 'speed increases progressively with displacement', bs);
// animation follows the actual speed
const slowB = report.bands.find((x) => x.name === 'lent'), maxB = report.bands.find((x) => x.name.startsWith('max (butée'));
const vW = 0.85 * 1.14, vR = 1.9 * 1.14;
ok(slowB.anim.walk > 0.8 && maxB.anim.run > 0.8, `animation: slow = walk (${slowB.anim.walk}), max = run (${maxB.anim.run})`);
ok(report.bands.every((x) => !x.anim || (x.anim.walkTS <= x.anim.s / vW + 1e-3 && x.anim.runTS <= x.anim.s / vR + 1e-3 && x.anim.walkTS <= x.speed / vW + 0.1)), 'walk/run playback rate ≤ actual speed / natural clip speed (feet never faster than the body)', report.bands.map((x) => x.anim && [x.anim.walkTS, x.anim.runTS]));

// ---------- 4. accel / decel / immediate stop (frame-rate independent: distances on the game clock) ----------
await place(bst.x, bst.z, 0); await p.waitForTimeout(200); await resetSamples();
await stickTo(1, bandDir, 1, 1); await p.waitForTimeout(900); await up(1); await p.waitForTimeout(900);
const sa = await samples(); const iIn = sa.findIndex((s) => s.d >= 0.99); const o = sa[Math.max(0, iIn - 1)];
const X = 0.3; const kA = 14, kD = 32; // MOVE_DEFAULTS accel / decel rates
const at = sa.slice(iIn).find((s) => s.sim - o.sim >= X) ?? sa.at(-1); const Xs = at.sim - o.sim;
const ramp = Math.hypot(at.x - o.x, at.z - o.z) / (MAX * Xs), rampTheory = 1 - (1 - Math.exp(-kA * Xs)) / (kA * Xs);
const iRel = sa.findIndex((s, i) => i > iIn && s.d === 0); const r0 = sa[iRel - 1]; const iStop = sa.findIndex((s, i) => i >= iRel && s.v === 0); const i5 = sa.findIndex((s, i) => i >= iRel && s.v <= 0.05 * MAX); const slowGameMs = Math.round((sa[i5].sim - r0.sim) * 1000);
const coast = Math.hypot(sa[iStop].x - r0.x, sa[iStop].z - r0.z), coastTheory = r0.v / kD;
const stopFrames = iStop - iRel + 1, stopGameMs = Math.round((sa[iStop].sim - r0.sim) * 1000);
const tail = sa.slice(iStop); const drift = Math.hypot(tail.at(-1).x - tail[0].x, tail.at(-1).z - tail[0].z);
report.accelSamples = sa.slice(Math.max(0, iIn - 2), iIn + 8).map((s) => [Math.round(s.t), +s.sim.toFixed(3), +s.x.toFixed(3), +s.z.toFixed(3), +s.v.toFixed(2), +s.d.toFixed(2)]);
Object.assign(report, { accelRamp: { windowS: +Xs.toFixed(3), distRatio: +ramp.toFixed(3), theory: +rampTheory.toFixed(3) }, stop: { coastM: +coast.toFixed(3), theoryM: +coastTheory.toFixed(3), under5pctMs: slowGameMs, frames: stopFrames, gameMs: stopGameMs }, drift: +drift.toFixed(4) });
ok(Math.abs(ramp - rampTheory) < 0.1 && ramp < 0.95, `smooth acceleration: in the first ${Math.round(Xs * 1000)} ms the avatar covers ${Math.round(ramp * 100)} % of the full-speed distance (model ${Math.round(rampTheory * 100)} %, ≈95 % speed after 0.21 s)`);
ok(coast < 0.12 && slowGameMs <= 120 + 2 * frameMs && drift === 0, `immediate stop after release: coasts ${(coast * 100).toFixed(1)} cm (model ${(coastTheory * 100).toFixed(1)} cm), below 5 % speed after ${slowGameMs} ms, fully at rest after ${stopFrames} frame(s) / ${stopGameMs} ms game time, no drift`);
// the knob springs back with a 0.14 s CSS transition and the idle pose is set by the next rendered frame: poll (≤ 1.5 s after release)
let after2, knob, settleMs = 0; { const tR = Date.now(); for (;;) { after2 = await mv(); knob = (await J()).knob; settleMs = Date.now() - tR + 900;
  if ((!after2.stick.active && after2.mode === 'idle' && Math.hypot(knob[0] - joy.cx, knob[1] - joy.cy) < 2) || Date.now() - tR > 600) break; await p.waitForTimeout(100); } }
ok(!after2.stick.active && after2.mode === 'idle' && Math.hypot(knob[0] - joy.cx, knob[1] - joy.cy) < 2, `stick recentred, avatar idle (checked ${settleMs} ms after release)`, { active: after2.stick.active, mode: after2.mode, speed: after2.speed, knobOff: +Math.hypot(knob[0] - joy.cx, knob[1] - joy.cy).toFixed(1) });
await p.screenshot({ path: `${SHOTS}/${devName}_idle.png` });

// ---------- 5. walls & furniture ----------
{ // back wall (world -X) head-on and sliding along it diagonally
  let best = null; for (let a = 0; a < 360; a += 2) { const d = await worldDir(a); const s = -d[0]; if (!best || s > best.s) best = { a, s, d }; }
  let z0 = 1.8; for (let z = 0.5; z < 5; z += 0.1) { if (await freeRay(1.3, z, -1, 0, 1.1, 0.08) >= 1.0) { z0 = z; break; } }
  await place(1.3, z0, 0); await p.waitForTimeout(150); await resetSamples();
  await stickTo(1, best.a); await p.waitForTimeout(1200); await up(1); await p.waitForTimeout(300);
  let ss = await samples(); const minX = Math.min(...ss.map((s) => s.x));
  ok(minX > 0.12 + 0.07 && minX < 0.45 && await cellFree(0.08), `wall: walking into the back wall stops at x=${minX.toFixed(2)} m (wall face 0.12 m + avatar radius), never inside`);
  // diagonal into the wall: keeps sliding along it
  let sl = null; for (let a = 0; a < 360; a += 2) { const d = await worldDir(a); if (d[0] < -0.6 && d[1] > 0.5 && (!sl || d[1] > sl.d[1])) sl = { a, d }; }
  let zs = null, xs = 0.35; for (const x of [0.3, 0.35, 0.92, 0.96]) { for (let z = 0.4; z < 4 && zs == null; z += 0.1) { if (await freeRay(x, z, 0, 1, 1.0, 0.08) >= 1.0) { zs = z; xs = x; } } if (zs != null) break; }
  console.log('  wall-slide lane', xs, zs); await place(xs, zs, 0); await p.waitForTimeout(150); await resetSamples(); await stickTo(1, sl.a); await p.waitForTimeout(1300);
  ss = await samples(); await up(1); await p.waitForTimeout(300);
  const dz = ss.at(-1).z - ss[0].z, mx = Math.min(...ss.map((s) => s.x));
  ok(dz > 0.6 && mx > 0.18 && await cellFree(0.08), `wall slide: pushing diagonally into a wall (or the furniture line along it) slides along it (+${dz.toFixed(2)} m along, min x ${mx.toFixed(2)} m)`);
  await p.screenshot({ path: `${SHOTS}/${devName}_wall.png` });
}
{ // furniture: find a start that faces a piece of furniture (not the room edge) 0.5–1.2 m ahead
  const fur = await p.evaluate(() => { const n = window.__world.nav; const out = []; for (let j = 3; j < n.nz - 3; j++) for (let i = 3; i < n.nx - 3; i++) if (!n.free(i, j)) out.push([i, j]); return out.length; });
  let hit = null;
  for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const d = await worldDir(a);
    const cand = await p.evaluate(([dx, dz]) => { const n = window.__world.nav; const bl = (x, z) => { const i = Math.floor(x / n.cell), j = Math.floor(z / n.cell); return x < 0 || z < 0 || !n.free(i, j); };
      const inner = (x, z) => x > 0.5 && z > 0.5 && x < n.nx * n.cell - 0.3 && z < n.nz * n.cell - 0.3;
      for (let j = 2; j < n.nz - 2; j++) for (let i = 2; i < n.nx - 2; i++) { const x = (i + 0.5) * n.cell, z = (j + 0.5) * n.cell; if (bl(x, z) || bl(x + 0.1, z) || bl(x - 0.1, z) || bl(x, z + 0.1) || bl(x, z - 0.1)) continue;
        for (let s = 0.1; s < 1.2; s += 0.05) { const px = x + dx * s, pz = z + dz * s; if (bl(px, pz)) { if (s > 0.5 && inner(px, pz)) return [x, z, s]; break; } } }
      return null; }, d);
    if (cand) { hit = { a, d, c: cand }; break; }
  }
  if (hit) {
    await place(hit.c[0], hit.c[1], 0); await p.waitForTimeout(150); await resetSamples(); await stickTo(1, hit.a); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${SHOTS}/${devName}_furniture.png` }); await up(1); await p.waitForTimeout(300);
    const ss = await samples(); const prog = ss.map((s) => (s.x - hit.c[0]) * hit.d[0] + (s.z - hit.c[1]) * hit.d[1]); const maxProg = Math.max(...prog);
    const travelled = Math.hypot(ss.at(-1).x - ss[0].x, ss.at(-1).z - ss[0].z);
    ok(await cellFree(0.08), `furniture: avatar never enters the furniture footprint (obstacle ${hit.c[2].toFixed(2)} m ahead; advanced ${maxProg.toFixed(2)} m, ${travelled.toFixed(2)} m travelled incl. sliding around it)`, { blockedCells: fur });
  } else ok(false, 'furniture: no test spot found');
}

// ---------- 6. camera independence & multi-touch pinch ----------
{
  const st = await openStart(await worldDir(135), 2); await place(st.x, st.z, 0); await p.waitForTimeout(800);
  const c0 = await camState(); await stickTo(1, 200); await stickTo(1, 20, 1, 8); await stickTo(1, 290, 1, 8); await p.waitForTimeout(400); await up(1); await p.waitForTimeout(500);
  const c1 = await camState();
  ok(Math.abs(c1.zoom - c0.zoom) < 1e-6 && Math.abs(c1.az - c0.az) < 1e-6 && Math.abs(c1.pol - c0.pol) < 1e-6, 'joystick drag never zooms or rotates the camera', { zoom: [c0.zoom, c1.zoom].map((v) => +v.toFixed(2)), az: [c0.az, c1.az].map((v) => +v.toFixed(4)) });
  // hold the stick with finger 1, pinch out with fingers 2+3 on the scene
  await place(st.x, st.z, 0); await p.waitForTimeout(300); await resetSamples();
  await stickTo(0.6, 135); await p.waitForTimeout(300); const z0 = (await camState()).zoom; const m0 = await mv();
  const mx = dev.w * 0.62, my = dev.h * 0.45; await down(2, mx - 40, my); await down(3, mx + 40, my);
  for (let i = 1; i <= 10; i++) { await moveT(2, mx - 40 - i * 9, my); await moveT(3, mx + 40 + i * 9, my); await p.waitForTimeout(40); }
  const m1 = await mv(); await up(3); await up(2); await p.waitForTimeout(400); const z1 = (await camState()).zoom; const m2 = await mv(); await up(1); await p.waitForTimeout(300);
  const ss = await samples(); const moved = Math.hypot(ss.at(-1).x - ss[0].x, ss.at(-1).z - ss[0].z);
  ok(z1 > z0 * 1.1, `pinch-zoom with two other fingers while the joystick is held: zoom ${z0.toFixed(0)} → ${z1.toFixed(0)}`);
    // compare the stick's own magnitude (updated on every pointer event); the controller's d is only refreshed per rendered frame
  ok(m1.stick.active && m1.stick.pointerId === m0.stick.pointerId && Math.abs(m0.stick.mag - 0.6) < 0.02 && Math.abs(m1.stick.mag - m0.stick.mag) < 0.02 && m2.stick.active && moved > 0.4, `joystick unaffected by the pinch (same pointer, d ${m0.stick.mag.toFixed(2)} → ${m1.stick.mag.toFixed(2)}, avatar kept walking ${moved.toFixed(2)} m)`, { ctrlD: [m0.d, m1.d].map((v) => +v.toFixed(2)) });
  await p.evaluate(() => window.dispatchEvent(new Event('yw:follow')));
  // single finger on the scene still pans; the joystick is not involved
  const c2 = await camState(); await p.mouse.wheel(0, 0); ok(Math.abs(c2.az - c0.az) < 0.2, 'camera rotation range intact');
}

// ---------- 7. tap-to-move interrupt, sit → stand, dance → walk ----------
{
  const st = await openStart(await worldDir(45), 2); await place(st.x, st.z, 0); await p.waitForTimeout(200);
  await p.evaluate(() => window.game.walkTo(new window.__cam.position.constructor(5.2, 0, 4.2)));
  const pth = (await mv()).path; await stickTo(1, 45); await p.waitForTimeout(250); const m = await mv(); await up(1); await p.waitForTimeout(500);
  ok(pth > 0 && m.path === 0 && m.mode === 'walk', `joystick interrupts a tap-to-move path (path ${pth} → ${m.path} waypoints)`);
  // tap a free floor spot ≥ 1.5 m away (a fixed spot could be where the avatar already stands), then check it walks there
  const pre = await mv(); const tgt = await p.evaluate(([x0, z0]) => { const n = window.__world.nav; let best = null;
    for (let j = 1; j < n.nz - 1; j++) for (let i = 1; i < n.nx - 1; i++) { if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => n.free(i + a, j + b))) continue; const x = (i + 0.5) * n.cell, z = (j + 0.5) * n.cell, dd = Math.hypot(x - x0, z - z0); if (dd >= 1.5 && (!best || dd < best[2])) best = [x, z, dd]; }
    return best; }, pre.pos);
  const tapOk = await p.evaluate(([x, z]) => window.game.walkTo(new window.__cam.position.constructor(x, 0, z)), tgt); let tm = await mv(); const tT = Date.now();
  while (Date.now() - tT < 3000 && Math.hypot(tm.pos[0] - pre.pos[0], tm.pos[1] - pre.pos[1]) < 0.3) { await p.waitForTimeout(100); tm = await mv(); }
  const tapMoved = Math.hypot(tm.pos[0] - pre.pos[0], tm.pos[1] - pre.pos[1]);
  ok(tapOk && tapMoved >= 0.3, `tap-to-move still works after the joystick is released (walking to a spot ${tgt[2].toFixed(1)} m away, ${tapMoved.toFixed(2)} m covered after ${Date.now() - tT} ms)`, { tapOk, mode: tm.mode, path: tm.path });
  await p.waitForTimeout(2500);
  // sit on a sofa then push the stick
  const sofa = await p.evaluate(() => window.game.s.apartment.items.find((i) => window.game.cat[i.defId].interaction === 'sit')?.uid);
  await p.evaluate((u) => window.game.interact(u, 'sit'), sofa);
  const sat = await p.waitForFunction(() => window.__move().mode === 'sitting', null, { timeout: 60000 }).then(() => true, () => false);
  await p.waitForTimeout(1200); await p.screenshot({ path: `${SHOTS}/${devName}_sitting.png` });
  // every rendered frame's mode is recorded by the in-page sampler (polling from node could miss a short stand-up phase on a slow renderer)
  await sampler(); await resetSamples(); await stickTo(1, 0); let mm = await mv(); const tS = Date.now();
  while (Date.now() - tS < 10000) { mm = await mv(); if (mm.mode === 'walk' && mm.speed > 0.2) break; await p.waitForTimeout(120); }
  await up(1); await p.waitForTimeout(400); const modes = [...new Set((await samples()).map((s) => s.mode))];
  ok(sat && modes.includes('standing') && mm.mode === 'walk' && mm.speed > 0.2, 'sitting + joystick → stand-up animation, then walks away', { sat, modes, last: [mm.mode, +mm.speed.toFixed(2)] });
  // dance then push the stick
  await place(st.x, st.z, 0); await p.evaluate(() => window.game.toggleEmote()); await p.waitForTimeout(800);
  const dancing = (await mv()).mode === 'emote'; await stickTo(1, 45); await p.waitForTimeout(500); const md = await mv(); const em = await p.evaluate(() => window.__world.chars[window.game.s.activeChar].emote); await up(1); await p.waitForTimeout(400);
  ok(dancing && md.mode === 'walk' && !em, 'dancing + joystick → stops dancing and walks');
  const buddy = await p.evaluate(() => { const g = window.game.s.activeChar === 'f' ? 'm' : 'f'; return window.__world.chars[g].mode; }); ok(!!buddy, `companion avatar untouched (${buddy})`);
}

// ---------- 8. hidden while the style studio / decorate mode is open ----------
{
  await p.evaluate(() => window.game.setMode('edit')); await p.waitForFunction(() => document.querySelector('.joy')?.classList.contains('joy-hidden'), null, { timeout: 8000 }).catch(() => {}); const e = await J();
  // back in play mode the stick fades in (0.2 s opacity transition, advanced per rendered frame): wait for it, ≤ 3 s
  const tP = Date.now(); await p.evaluate(() => window.game.setMode('play'));
  const back = await p.waitForFunction(() => { const j = document.querySelector('.joy'); if (!j || j.classList.contains('joy-hidden')) return false; const cs = getComputedStyle(j); return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.3; }, null, { timeout: 3000, polling: 50 }).then(() => true, () => false);
  const backMs = Date.now() - tP; const e2 = await J();
  ok(!e.vis && back && e2.vis, `hidden in decorate mode, back in play mode (visible again after ${backMs} ms)`, { edit: e && [e.vis], play: e2 && [e2.vis], panel: await p.evaluate(() => window.game.s.panel) });
}

// ---------- 9. walking screenshots ----------
{ const st = await openStart(await worldDir(150), 2.2); await place(st.x, st.z, 0); await p.waitForTimeout(300); await stickTo(0.85, 150); await p.waitForTimeout(700); await p.screenshot({ path: `${SHOTS}/${devName}_walking.png` }); await up(1); await p.waitForTimeout(300); }

// ---------- 10. beach ----------
if (FULL || devName === 'iphone15') {
  await p.evaluate(() => window.game.travel('beach')); await p.waitForFunction(() => window.__move().location === 'beach', null, { timeout: 30000 }); await p.waitForTimeout(3500);
  await sampler(); await resetSamples(); joy = await J(); const b0 = await mv();
  await stickTo(1, 180); await p.waitForTimeout(1200); await p.screenshot({ path: `${SHOTS}/${devName}_beach.png` }); await stickTo(1, 270, 1, 6); await p.waitForTimeout(2500); await up(1); await p.waitForTimeout(400);
  const ss = await samples(); const moved = Math.hypot(ss.at(-1).x - b0.pos[0], ss.at(-1).z - b0.pos[1]);
  ok(joy.vis && moved > 0.8 && await cellFree(), `Yoo Plage: joystick walks on the sand/boardwalk (${moved.toFixed(2)} m), never into the sea or props`);
}
ok(errs.length === 0, 'no console / page errors', errs.slice(0, 5)); ok(bad.length === 0, 'no HTTP errors', bad.slice(0, 5));
report.results = results; fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(`${SHOTS}/report_${devName}.json`, JSON.stringify(report, null, 2));
console.log('DIRS', JSON.stringify(report.dirs)); console.log('BANDS', JSON.stringify(report.bands.map(({ anim, ...x }) => x)));
console.log(`SUMMARY ${devName}: ${results.filter((r) => r.ok).length}/${results.length} passed`);
await b.close();
