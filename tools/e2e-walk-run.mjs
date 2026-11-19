import { createRequire } from 'module'; import fs from 'fs'; import { execFileSync } from 'child_process'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * Walk / run separation (owner, 19 Nov 2026) on the real game with REAL touches (CDP) on the joystick and the 🏃 button.
 * Deterministic virtual time (performance.now + rAF stepped exactly 1/60 s per frame, as e2e-gameplay.mjs), so the speeds
 * and timings are those of a 60 fps phone whatever the headless frame rate. Measured every frame from window.__move():
 * controller speed (m/s), animation weights (walk / run), clip rates, Run mode.
 *  A Run off + 25 % / B 60 % / C 100 % (thumb past the rim) → the single walk 1.2 m/s, Walk clip only at the
 *  pre-handoff 119643c rate (~1.24× = speed / (LOCO.walk × scale), run weight 0; feet slide ~56 %) · D Run on + 100 %
 *  → run 2.8 on the run clip at ≈ 1.29× · E Run on then off while moving (second finger on 🏃, thumb kept on the stick)
 *  → eases down to 1.2 m/s in ≈ 0.3 s, no jump, Walk clip at the pre-handoff rate (cap 1.6), run weight fades out · F
 *  release → eased stop.
 * usage: node tools/e2e-walk-run.mjs [url] ; DEVS=iphone15,se ; OUT=dir (report json) ;
 *        VIDEO=dir → also records the comparison clips (walk at full push / run) on iPhone 15 with ffmpeg (side-on lane,
 *        frames captured every 2nd virtual 1/60 s frame → real-time 30 fps video; VDPR=2 capture scale)
 */
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5410'}/`;
const DEVICES = { iphone15: { w: 852, h: 393, dpr: 3, label: 'iPhone 15 paysage' }, se: { w: 667, h: 375, dpr: 2, label: 'iPhone SE paysage' } };
const OUT = process.env.OUT ?? 'shots/walk-run'; fs.mkdirSync(OUT, { recursive: true }); const VIDEO = process.env.VIDEO;
const SC = 1.14, STRIDE = { walk: 0.377 * SC, run: 1.9 * SC }; // animBlend.STRIDE × avatar scale (V3)
const LIM = { accel: 12, frameJump: 0.20 }; // m/s² for the 2.8 → 1.2 change (ω 18, Δ 1.6 → peak ≈ 10.6); m/s per 1/60 s frame
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m, extra }); if (!c) process.exitCode = 1; };
const r3 = (x) => +x.toFixed(3);

async function open(dev, dpr = dev.dpr) {
  const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('yw.portrait', '1'); } catch { /* */ }
    let vt = 0, virt = false; const rp = performance.now.bind(performance); const rr = window.requestAnimationFrame.bind(window); let cbs = [];
    performance.now = () => (virt ? vt : rp());
    window.requestAnimationFrame = (cb) => { if (!virt) return rr(cb); cbs.push(cb); return 1e6 + cbs.length; };
    const rc = window.cancelAnimationFrame.bind(window); window.cancelAnimationFrame = (id) => { if (id < 1e6) rc(id); };
    window.__virt = () => { vt = rp(); virt = true; window.__virtOn = true; };
    window.__step = (ms) => { vt += ms; const c = cbs; cbs = []; c.forEach((f) => f(vt)); };
    window.__steps = (n) => { for (let i = 0; i < n; i++) window.__step(1000 / 60); };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1&lieu=appart', { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__cam && window.__move, null, { timeout: 180000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => window.__virt());
  const cdp = await ctx.newCDPSession(p);
  return { p, ctx, cdp, errs };
}
function touchApi(cdp) {
  const touches = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.entries()].map(([id, t]) => ({ x: t.x, y: t.y, id, radiusX: 6, radiusY: 6, force: 1 })) });
  return {
    down: async (id, x, y) => { touches.set(id, { x, y }); await send('touchStart'); },
    move: async (id, x, y) => { touches.set(id, { x, y }); await send('touchMove'); },
    up: async (id) => { const t = touches.get(id); touches.delete(id); if (t) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: t.x, y: t.y, id }] }); },
  };
}
const SAMPLE = () => { const m = window.__move(); return { pos: m.pos, sp: m.speed, v: Math.hypot(m.vel[0], m.vel[1]), mag: m.stick.mag, run: m.run, gait: m.gait, mode: m.mode, aw: m.anim?.walk ?? 0, ar: m.anim?.run ?? 0, ai: m.anim?.idle ?? 1, wts: m.anim?.walkTS ?? 0, rts: m.anim?.runTS ?? 0, am: m.anim?.mode }; };

async function setup(dev, dpr, angles = [0, 45, 90, 135, 180, 225, 270, 315]) {
  const S = await open(dev, dpr); const { p } = S;
  await p.evaluate(() => window.game.travel('beach')); await p.evaluate(() => window.__steps(150));
  S.lane = await p.evaluate((angles) => { // longest clear lane on the live nav grid among the 8 stick directions
    const d = new window.__cam.position.constructor(); window.__cam.getWorldDirection(d); const h = Math.hypot(d.x, d.z), fx = d.x / h, fz = d.z / h, sinEl = Math.max(0.2, Math.abs(d.y) / d.length());
    const n = window.__world.nav; const free = (x, z) => x > 0 && z > 0 && n.free(Math.floor(x / n.cell), Math.floor(z / n.cell)); const R = 0.2;
    const disc = (x, z) => [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]].every(([a, c]) => free(x + a, z + c)); let best = null;
    for (const a of angles) { const sx = Math.cos(a * Math.PI / 180), sy = -Math.sin(a * Math.PI / 180), up = -sy / sinEl; let wx = -fz * sx + fx * up, wz = fx * sx + fz * up; const l = Math.hypot(wx, wz); wx /= l; wz /= l;
      for (let j = 1; j < n.nz; j++) for (let i = 1; i < n.nx; i++) { const x = (i + 0.5) * n.cell, z = (j + 0.5) * n.cell; let s = 0; while (s < 12 && disc(x + wx * s, z + wz * s)) s += 0.05; if (!best || s > best.len) best = { a, x, z, wx, wz, len: s }; } }
    return best; }, angles);
  S.joy = await p.evaluate(() => { const j = document.querySelector('.joy'), k = document.querySelector('.joy-knob'); const r = j.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, R: Math.max(20, j.offsetWidth / 2 - k.offsetWidth * 0.18) }; });
  S.T = touchApi(S.cdp);
  return S;
}
const placeStart = (S) => S.p.evaluate((L) => { const c = window.__world.chars[window.game.s.activeChar]; c.path = []; c.mode = 'idle'; c.pos.set(L.x, 0, L.z); c.yaw = Math.atan2(L.wx, L.wz); window.dispatchEvent(new Event('yw:follow')); }, S.lane);
/** teleport back to the lane start when near its end, KEEPING the velocity (the controller re-syncs its position only) */
const recycle = (S) => S.p.evaluate((L) => { const c = window.__world.chars[window.game.s.activeChar]; const s = (c.pos.x - L.x) * L.wx + (c.pos.z - L.z) * L.wz; if (s > L.len - 0.6) { c.pos.set(L.x, 0, L.z); return true; } return false; }, S.lane);
async function tapRun(S, rec) { // tap the 🏃 button with a second finger (the thumb may stay on the stick)
  const r = await S.p.evaluate(() => { const e = document.querySelector('.run-btn'); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }); if (!r) return [];
  await S.T.down(7, r[0], r[1]); const a = await frames(S, 3, rec); await S.T.up(7); const c = await frames(S, 3, rec); return [...a, ...c];
}
async function frames(S, n, rec = true, onFrame) {
  const out = []; for (let i = 0; i < n; i++) { await S.p.evaluate(() => window.__step(1000 / 60)); const s = await S.p.evaluate(SAMPLE); if (rec && await recycle(S)) s.tp = true; out.push(s); if (onFrame) await onFrame(s, i); } return out;
}
const stickPos = (S, d) => [S.joy.cx + Math.cos(S.lane.a * Math.PI / 180) * S.joy.R * d, S.joy.cy - Math.sin(S.lane.a * Math.PI / 180) * S.joy.R * d];
async function push(S, d) { await S.T.down(1, S.joy.cx, S.joy.cy); for (let i = 1; i <= 3; i++) { const [x, y] = stickPos(S, d * i / 3); await S.T.move(1, x, y); } }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

async function suite(devName) {
  const dev = DEVICES[devName]; const S = await setup(dev); const rep = { device: devName, viewport: [dev.w, dev.h], lane: r3(S.lane.len), cases: {} };
  const wantStick = await S.p.evaluate(() => [0.25, 0.6, 1].map((d) => window.__stickSpeed(d)));
  ok(wantStick.every((x) => Math.abs(x - 1.2) < 1e-6), `${devName}: live curve (Run off) 25/60/100 % → ${wantStick.map((x) => x.toFixed(2)).join(' / ')} m/s (single walk 1.2)`);
  ok((await S.p.evaluate(() => window.__move().run)) === false, `${devName}: walking is the default mode (Run off at start)`);
  async function drive(name, d, { run = false, secs = 2.2, rel = 1.0 } = {}) {
    await placeStart(S); await frames(S, 20, false);
    if (run) { await tapRun(S, false); }
    const isRun = await S.p.evaluate(() => window.__move().run); await push(S, d);
    const on = await frames(S, Math.round(secs * 60)); await S.T.up(1); const off = await frames(S, Math.round(rel * 60));
    if (run) { await tapRun(S, false); }
    const steady = on.slice(-40); const top = mean(steady.map((s) => s.sp)); const mag = mean(steady.map((s) => s.mag));
    const r = { d, run: isRun, mag: r3(mag), speed: r3(top), maxV: r3(Math.max(...on.map((s) => s.v))), maxRunW: r3(Math.max(...[...on, ...off].map((s) => s.ar))), minWalkW: r3(Math.min(...steady.map((s) => s.aw))), minRunW: r3(Math.min(...steady.map((s) => s.ar))),
      walkTS: r3(mean(steady.map((s) => s.wts))), runTS: r3(mean(steady.map((s) => s.rts))), gait: [...new Set(on.map((s) => s.gait))].join(','),
      clipErrWalk: r3(Math.max(...steady.map((s) => Math.abs(s.wts * STRIDE.walk - s.sp) / s.sp))), clipErrRun: r3(Math.max(...steady.map((s) => Math.abs(s.rts * STRIDE.run - s.sp) / s.sp))),
      stopS: r3((off.findIndex((s) => s.v === 0) + 1) / 60), stopRev: off.some((s, i) => i > 0 && s.v > off[i - 1].v + 1e-6), maxDecel: r3(Math.max(0, ...off.map((s, i) => i ? (off[i - 1].v - s.v) * 60 : (on.at(-1).v - s.v) * 60))),
      timeline: [...on, ...off].filter((_, i) => i % 6 === 0).map((s) => [r3(s.sp), +s.aw.toFixed(2), +s.ar.toFixed(2)]) };
    rep.cases[name] = r; console.log('   ' + name + ' ' + JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'timeline'))));
    return r;
  }
  const A = await drive('A_off_25', 0.25), B = await drive('B_off_60', 0.6), C = await drive('C_off_100', 1.2, { secs: 3 }), D = await drive('D_on_100', 1.2, { run: true, secs: 3 });
  const near = (v, t, tol = 0.03) => Math.abs(v - t) / t <= tol;
  const vW = 0.85 * 1.14; // LOCO.walk × default avatar scale — pre-handoff 119643c playback
  const walkTS12 = 1.2 / vW; // ≈ 1.238
  const fastRunTS = 2.8 / STRIDE.run; // ≈ 1.29: the 2.8 m/s run-mode playback
  const walkFeel = (r) => r.maxRunW === 0 && r.minWalkW > 0.95 && near(r.walkTS, walkTS12) && r.walkTS <= 1.6 + 1e-6;
  ok(Math.abs(A.mag - 0.25) < 0.012 && near(A.speed, 1.2) && A.gait === 'walk' && walkFeel(A), `${devName} A Run off + 25 %: walk ${A.speed} m/s (target 1.2), Walk clip ≥ ${A.minWalkW} at pre-handoff rate ${A.walkTS} (~1.24×, run clip max ${A.maxRunW})`);
  ok(Math.abs(B.mag - 0.6) < 0.012 && near(B.speed, 1.2) && B.gait === 'walk' && walkFeel(B), `${devName} B Run off + 60 %: walk ${B.speed} m/s (target 1.2, same as 25 %), Walk clip ≥ ${B.minWalkW} at pre-handoff rate ${B.walkTS} (run clip max ${B.maxRunW})`);
  ok(C.mag === 1 && near(C.speed, 1.2) && C.maxV <= 1.2 * 1.002 && C.gait === 'walk' && walkFeel(C), `${devName} C Run off + 100 % (thumb past the rim): walk ${C.speed} m/s (target 1.2, max ${C.maxV}, never a faster walk), Walk clip ≥ ${C.minWalkW} at pre-handoff rate ${C.walkTS} (~1.24×, run clip max ${C.maxRunW})`);
  ok(D.run && near(D.speed, 2.8) && D.minRunW > 0.95 && D.clipErrRun < 0.03 && near(D.runTS, fastRunTS), `${devName} D Run on + 100 %: run ${D.speed} m/s (target 2.8), run clip ≥ ${D.minRunW} at rate ${D.runTS} (stride error ${(D.clipErrRun * 100).toFixed(1)} %)`);
  for (const [k, r] of [['A', A], ['C', C], ['D', D]]) ok(r.stopS > 0.15 && r.stopS < 0.5 && !r.stopRev, `${devName} F release after ${k}: eased stop in ${r.stopS} s, never reverses (peak decel ${r.maxDecel} m/s²)`);
  // E: Run on → off while moving (thumb stays at 100 %)
  {
    await placeStart(S); await frames(S, 20, false); await tapRun(S, false); await push(S, 1.2);
    const pre = await frames(S, 120); const sw = await tapRun(S, true); const post = await frames(S, 54); await S.T.up(1); await frames(S, 60);
    const all = [...pre.slice(-10), ...sw, ...post]; const i0 = 10; const v0 = pre.at(-1).sp;
    let jump = 0, decel = 0; for (let i = 1; i < all.length; i++) { jump = Math.max(jump, Math.abs(all[i].v - all[i - 1].v)); decel = Math.max(decel, (all[i - 1].v - all[i].v) * 60); }
    const offI = all.findIndex((s, i) => i >= i0 && s.run === false); const after = all.slice(Math.max(0, offI));
    const t12 = (after.findIndex((s) => s.v <= 1.2 * 1.02) + 1) / 60;
    const afterOff = after.filter((s) => s.run === false);
    const maxWalkTSOff = afterOff.length ? Math.max(...afterOff.map((s) => s.wts)) : NaN;
    const tRun = (afterOff.findIndex((s) => s.ar < 0.05) + 1) / 60;
    const endTS = mean(post.slice(-12).map((s) => s.wts));
    const endSp = mean(post.slice(-12).map((s) => s.sp));
    const E = { v0: r3(v0), end: r3(endSp), maxFrameJump: r3(jump), maxDecel: r3(decel), minV: r3(Math.min(...after.map((s) => s.v))), t12, maxWalkTSOff: r3(maxWalkTSOff), endWalkTS: r3(endTS), endRunW: r3(post.at(-1).ar), endWalkW: r3(post.at(-1).aw), endGait: post.at(-1).gait, tRunFade: tRun, timeline: all.filter((_, i) => i % 3 === 0).map((s) => [r3(s.v), +s.aw.toFixed(2), +s.ar.toFixed(2), r3(s.wts), s.run ? 1 : 0]) };
    rep.cases.E_on_then_off = E; console.log('   E ' + JSON.stringify(Object.fromEntries(Object.entries(E).filter(([k]) => k !== 'timeline'))));
    ok(offI > 0 && near(v0, 2.8) && near(E.end, 1.2) && E.minV >= 1.15 && E.maxDecel <= LIM.accel && E.maxFrameJump <= LIM.frameJump && t12 > 0.1 && t12 < 0.45 && E.endGait === 'walk' && E.endRunW < 0.05 && E.endWalkW > 0.95 && E.maxWalkTSOff <= 1.6 + 0.05 && near(E.endWalkTS, walkTS12) && tRun > 0 && tRun < 0.5,
      `${devName} E Run on → off while moving: ${E.v0} → ${E.end} m/s in ${t12} s, peak decel ${E.maxDecel} m/s² (limit ${LIM.accel}), max frame jump ${E.maxFrameJump} m/s (limit ${LIM.frameJump}), run clip out in ${tRun} s, Walk clip ${E.endWalkW} at pre-handoff rate ${E.endWalkTS} (cap 1.6)`);
  }
  ok(S.errs.length === 0, `${devName}: no console / page errors`, S.errs.slice(0, 3));
  await S.ctx.close(); return rep;
}

const reports = [];
for (const d of (process.env.DEVS ?? 'iphone15,se').split(',').filter(Boolean)) reports.push(await suite(d));
fs.writeFileSync(`${OUT}/walk-run-report.json`, JSON.stringify({ results, reports }, null, 1));

// ------------------------------------------------------------ comparison video (iPhone 15 landscape, real rendering)
if (VIDEO) {
  fs.mkdirSync(`${VIDEO}/frames`, { recursive: true });
  const dev = DEVICES.iphone15; const DPR = Number(process.env.VDPR ?? 2); const FPS = 30; const STEP = 60 / FPS;
  const clips = [
    { key: 'slow_walk', title: 'Marche', sub: 'Course désactivée · joystick 100 % · 1,2 m/s', d: 1.2, run: false, secs: 3.4 },
    { key: 'run', title: 'Course', sub: 'Bouton 🏃 activé · joystick 100 % · 2,8 m/s', d: 1.2, run: true, secs: 3.4 },
  ];
  const meta = [];
  for (const cl of clips) {
    const S = await setup(dev, DPR, [0, 180]); const dir = `${VIDEO}/frames/${cl.key}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    await placeStart(S); await frames(S, 20, false);
    if (cl.run) await tapRun(S, false);
    await S.p.evaluate(([t, s]) => { const o = document.createElement('div'); o.id = 'rec-label'; o.style.cssText = 'position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:99999;background:rgba(20,10,30,.78);color:#fff;font:600 15px/1.25 system-ui,sans-serif;padding:6px 12px;border-radius:10px;text-align:center;pointer-events:none;white-space:nowrap';
      o.innerHTML = `<div style="font-size:17px">${t}</div><div style="font-weight:500;opacity:.9">${s}</div><div id="rec-v" style="font-variant-numeric:tabular-nums">–</div>`; document.body.appendChild(o); }, [cl.title, cl.sub]);
    let n = 0; const vs = []; let teleports = 0;
    const label = () => S.p.evaluate(() => { const m = window.__move(); const a = m.anim ?? { walk: 0, run: 0 }; const clip = a.run > 0.5 ? 'course' : a.walk > 0.5 ? 'marche' : 'repos';
      document.getElementById('rec-v').textContent = `vitesse mesurée ${m.speed.toFixed(2)} m/s · animation : ${clip}`; return m.speed; });
    const shot = async () => { const r = await S.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: dev.w, height: dev.h, scale: DPR } }); fs.writeFileSync(`${dir}/f${String(n++).padStart(4, '0')}.jpg`, Buffer.from(r.data, 'base64')); };
    await label(); for (let i = 0; i < 12; i++) { await S.p.evaluate(() => window.__steps(2)); await label(); await shot(); } // 0.4 s at rest
    await push(S, cl.d);
    const total = Math.round(cl.secs * 60); for (let f = 0; f < total; f += STEP) { await S.p.evaluate((k) => window.__steps(k), STEP); if (await recycle(S)) teleports++; vs.push(await label()); await shot(); }
    await S.T.up(1); for (let f = 0; f < 36; f += STEP) { await S.p.evaluate((k) => window.__steps(k), STEP); await label(); await shot(); }
    const steady = vs.slice(-30); meta.push({ clip: cl.key, frames: n, steadySpeed: r3(mean(steady)), teleports, lane: r3(S.lane.len) });
    const mp4 = `${VIDEO}/${cl.key}.mp4`; execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/f%04d.jpg`, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4]);
    console.log(`VIDEO ${mp4} ${JSON.stringify(meta.at(-1))}`); await S.ctx.close();
  }
  const [a, r] = clips.map((x) => `${VIDEO}/${x.key}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', r, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${VIDEO}/comparison_sequential.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', r, '-filter_complex', '[0:v]scale=1280:-2[a];[1:v]scale=1280:-2[b];[a][b]vstack=inputs=2[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', `${VIDEO}/comparison_stacked.mp4`]);
  fs.writeFileSync(`${VIDEO}/video-meta.json`, JSON.stringify(meta, null, 1)); console.log('VIDEO', JSON.stringify(meta));
}
console.log(`SUMMARY walk-run: ${results.filter((r) => r.ok).length}/${results.length} passed`);
await b.close();
