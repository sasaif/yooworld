import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * Gameplay polish regression suite (real game, deterministic virtual time: performance.now + requestAnimationFrame are
 * virtualised and stepped exactly 1/60 s per frame, so the numbers are those of a 60 fps phone whatever the headless speed).
 *  1. movement, walk (Run off: full stick = fast walk 1.8 m/s, 30 % stick) and run mode (🏃 button, 2.8 m/s): top speed, progressive acceleration, eased stop,
 *     no per-frame jump, gait (walk clip only in walk mode) and clip rate = actual speed / stride speed, foot slip of the
 *     stance foot; ?move=classic = the former controller (reference numbers, not asserted beyond its own speed).
 *  2. name tag vs top-bar chips: Juan placed so his tag would sit under the 'Mode local' chip → the tag is moved, no overlap.
 *  3. chat with the iOS keyboard (visualViewport heights 170 / 140 / 120 / 100 px, and a panned viewport): input, Envoyer
 *     and the newest message stay inside the visible area; header (✕) while there is room; keyboard closed: the chat card
 *     covers neither the joystick, the run button, the dock nor the avatar.
 * usage: node tools/e2e-gameplay.mjs [url] ; ONLY=move,tag,chat ; SHOTS=dir
 */
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5302'}/`;
const ONLY = (process.env.ONLY ?? 'move,tag,chat').split(','); const SHOTS = process.env.SHOTS ?? '/tmp/e2e-gameplay'; fs.mkdirSync(SHOTS, { recursive: true });
const dev = { w: 852, h: 393, dpr: 2 };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m, extra }); if (!c) process.exitCode = 1; };
const errs = [];
const DT = 1000 / 60, SCALE = 1.14, STRIDE = { walk: 0.377 * SCALE, run: 1.9 * SCALE }; // measured clip stride speeds (animBlend.STRIDE × avatar scale)
const WALK_TOP = 1.8, RUN_TOP = 2.8; // walk / run separation (walkProfile GAIT_SPEEDS): full stick = fast walk 1.8, Run on = 2.8

async function open(q = '', virtual = true) {
  const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('yw.portrait', '1'); } catch { /* */ }
    let vt = 0, virt = false; const rp = performance.now.bind(performance); const rr = window.requestAnimationFrame.bind(window); let cbs = [];
    performance.now = () => (virt ? vt : rp());
    window.requestAnimationFrame = (cb) => { if (!virt) return rr(cb); cbs.push(cb); return 1e6 + cbs.length; };
    const rc = window.cancelAnimationFrame.bind(window); window.cancelAnimationFrame = (id) => { if (id < 1e6) rc(id); };
    window.__virt = () => { vt = rp(); virt = true; window.__virtOn = true; };
    window.__step = (ms) => { vt += ms; const c = cbs; cbs = []; c.forEach((f) => f(vt)); };
  });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1&lieu=appart' + (q ? '&' + q : ''), { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__cam && window.__move, null, { timeout: 180000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const V = window.__cam.position.constructor; const scene = () => { let s = window.__cam; while (s.parent) s = s.parent; return s; };
    window.__scr = (x, y, z) => { const v = new V(x, y, z).project(window.__cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
    window.__avatarObj = (id) => { let r = null; scene().traverse((o) => { if (o.userData.avatarId === id) r = o; }); return r; };
    window.__bones = (id) => { const o = window.__avatarObj(id); const out = {}; o.traverse((m) => { if (m.isBone && !out[m.name]) out[m.name] = m.getWorldPosition(new V()).toArray(); }); return out; };
    window.__steps = (n) => { if (!window.__virtOn) return; for (let i = 0; i < n; i++) window.__step(1000 / 60); };
  });
  if (virtual) await p.evaluate(() => window.__virt());
  const cdp = await ctx.newCDPSession(p);
  return { p, ctx, cdp };
}
/** screenshot through CDP (page.screenshot waits for a real animation frame, which never comes with rAF virtualised on
 *  some headless hosts, e.g. GitHub runners); best effort: a failed capture never fails a test */
async function shot(cdp, path) { try { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path, Buffer.from(r.data, 'base64')); } catch (e) { console.log(`   (screenshot ${path} skipped: ${e.message.slice(0, 80)})`); } }
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function tapEl(p, cdp, sel) { const r = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, sel); if (!r) return false;
  await touch(cdp, 'touchStart', [{ x: r[0], y: r[1], id: 7 }]); await p.evaluate(() => window.__steps(3)); await touch(cdp, 'touchEnd', []); await p.evaluate(() => window.__steps(3)); return true; }

// ---------------------------------------------------------------- 1. movement
async function moveRun(name, q, runMode, defl = 1) {
  const { p, ctx, cdp } = await open(q);
  await p.evaluate(() => window.game.travel('beach')); await p.evaluate(() => window.__steps(120));
  if (runMode) { const t = await tapEl(p, cdp, '.run-btn'); ok(t && (await p.evaluate(() => window.__move().run)) === true, `${name}: the 🏃 button switches the stick to run`); }
  // longest clear lane on the live nav grid among the 8 stick directions
  const lane = await p.evaluate(() => {
    const d = new window.__cam.position.constructor(); window.__cam.getWorldDirection(d); const h = Math.hypot(d.x, d.z), fx = d.x / h, fz = d.z / h, sinEl = Math.max(0.2, Math.abs(d.y) / d.length());
    const n = window.__world.nav; const free = (x, z) => x > 0 && z > 0 && n.free(Math.floor(x / n.cell), Math.floor(z / n.cell)); const R = 0.2;
    const disc = (x, z) => [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]].every(([a, c]) => free(x + a, z + c));
    let best = null;
    for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) { const sx = Math.cos(a * Math.PI / 180), sy = -Math.sin(a * Math.PI / 180), up = -sy / sinEl; let wx = -fz * sx + fx * up, wz = fx * sx + fz * up; const l = Math.hypot(wx, wz); wx /= l; wz /= l;
      for (let j = 1; j < n.nz; j += 2) for (let i = 1; i < n.nx; i += 2) { const x = (i + 0.5) * n.cell, z = (j + 0.5) * n.cell; let s = 0; while (s < 5 && disc(x + wx * s, z + wz * s)) s += 0.05; if (!best || s > best.len) best = { a, x, z, wx, wz, len: s }; if (best.len >= 5) return best; } }
    return best; });
  await p.evaluate((L) => { const g = window.game, c = window.__world.chars[g.s.activeChar]; c.path = []; c.mode = 'idle'; c.pos.set(L.x, 0, L.z); c.yaw = Math.atan2(L.wx, L.wz); window.dispatchEvent(new Event('yw:follow')); }, lane);
  await p.evaluate(() => window.__steps(30));
  const joy = await p.evaluate(() => { const r = document.querySelector('.joy').getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, R: r.width * 0.45 }; });
  const sample = () => p.evaluate(() => { const m = window.__move(); const id = window.game.s.activeChar; const B = window.__bones(id); return { pos: m.pos, v: Math.hypot(m.vel[0], m.vel[1]), sp: m.speed, anim: m.anim, lf: B.LeftFoot, rf: B.RightFoot, lt: B.LeftToeBase, rt: B.RightToeBase, mode: m.mode, max: m.maxSpeed }; });
  const S = []; const DRIVE = Math.min(2.0, (lane.len - 0.6) / (q.includes('classic') ? 1.9 : runMode ? RUN_TOP : WALK_TOP) + 0.4);
  await touch(cdp, 'touchStart', [{ x: joy.cx, y: joy.cy, id: 1 }]);
  await touch(cdp, 'touchMove', [{ x: joy.cx + Math.cos(lane.a * Math.PI / 180) * joy.R * 1.2 * defl, y: joy.cy - Math.sin(lane.a * Math.PI / 180) * joy.R * 1.2 * defl, id: 1 }]);
  const nDrive = Math.round(DRIVE * 60); for (let f = 0; f < nDrive; f++) { await p.evaluate(() => window.__step(1000 / 60)); S.push({ ...(await sample()), f, on: true }); }
  await touch(cdp, 'touchEnd', []);
  for (let f = 0; f < 60; f++) { await p.evaluate(() => window.__step(1000 / 60)); S.push({ ...(await sample()), f: nDrive + f, on: false }); }
  await shot(cdp, `${SHOTS}/move_${name}.png`); await ctx.close();
  if (process.env.DUMP) fs.writeFileSync(`${SHOTS}/move_${name}_samples.json`, JSON.stringify(S));
  // ---- metrics
  const drive = S.filter((s) => s.on), rel = S.filter((s) => !s.on), T = drive[0].max;
  const steady = drive.slice(-24); const top = steady.reduce((a, s) => a + s.sp, 0) / steady.length;
  const T1 = defl < 1 ? top : T; const t50 = (drive.findIndex((s) => s.v >= T1 * 0.5) + 1) / 60, t95 = (drive.findIndex((s) => s.v >= T1 * 0.95) + 1) / 60;
  const a1 = drive[0].v * 60; let maxStep = 0; for (let i = 1; i < S.length; i++) maxStep = Math.max(maxStep, Math.hypot(S[i].pos[0] - S[i - 1].pos[0], S[i].pos[1] - S[i - 1].pos[1]));
  const stopI = rel.findIndex((s) => s.v === 0); const stopT = (stopI + 1) / 60; const last = drive.at(-1); const stopD = Math.hypot(rel.at(-1).pos[0] - last.pos[0], rel.at(-1).pos[1] - last.pos[1]);
  let rev = false; for (let i = 1; i < rel.length; i++) if (rel[i].v > rel[i - 1].v + 1e-6) rev = true;
  const walkW = Math.min(...steady.map((s) => s.anim?.walk ?? 0)), runW = Math.min(...steady.map((s) => s.anim?.run ?? 0)), runMax = Math.max(...S.map((s) => s.anim?.run ?? 0));
  const clipErrRun = Math.max(...steady.map((s) => Math.abs(s.anim.runTS * STRIDE.run - s.sp) / s.sp)), clipErrWalk = Math.max(...steady.map((s) => Math.abs(s.anim.walkTS * STRIDE.walk - s.sp) / s.sp));
  // foot sync (walk clip): from the root-relative motion of the LOWER foot over the last 1.2 s, the body speed at which that
  // foot would stay planted (least total world travel). Synced gait ⇒ ≈ the actual body speed. (The run clip has flight
  // phases with no planted foot: not measurable this way, its rate is checked against its stride speed only.)
  const st2 = drive.slice(-72); const fr = [];
  for (let i = 1; i < st2.length; i++) { const A = st2[i], B0 = st2[i - 1]; const hx = A.pos[0] - B0.pos[0], hz = A.pos[1] - B0.pos[1], L = Math.hypot(hx, hz) || 1;
    const side = A.lt[1] + A.lf[1] < A.rt[1] + A.rf[1] ? 'l' : 'r'; const F = (q) => [(q[side + 'f'][0] + q[side + 't'][0]) / 2 - q.pos[0], (q[side + 'f'][2] + q[side + 't'][2]) / 2 - q.pos[1]];
    const a = F(A), c = F(B0); fr.push([(a[0] - c[0]) * 60, (a[1] - c[1]) * 60, hx / L, hz / L]); }
  let syncV = NaN, bestT = Infinity; for (let v = 0.05; v < 3.5; v += 0.005) { let t = 0; for (const [rx, rz, fx, fz] of fr) t += Math.hypot(v * fx + rx, v * fz + rz); if (t < bestT) { bestT = t; syncV = v; } }
  const slipR = syncV / top; const n = rel.length;
  return { name, T, top, t50, t95, a1, maxStep, stopT, stopD, rev, walkW, runW, runMax, clipErrRun, clipErrWalk, slipR, slipN: n, lane: +lane.len.toFixed(2) };
}
if (ONLY.includes('move')) {
  const R = {};
  for (const [name, q, run, defl] of [['classic', 'move=classic', false, 1], ['default', '', false, 1], ['slow', '', false, 0.3], ['classic_slow', 'move=classic', false, 0.3], ['run', '', true, 1]].filter(([n]) => !process.env.PROF || process.env.PROF.split(',').includes(n))) {
    const r = await moveRun(name, q, run, defl); R[name] = r; console.log('   ' + JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]))));
    if (name === 'classic') { ok(Math.abs(r.top - 1.9) / 1.9 < 0.03, `classic: former controller kept (full stick ${r.top.toFixed(2)} m/s, 95 % in ${r.t95.toFixed(2)} s)`); continue; }
    if (name === 'classic_slow') { console.log(`   reference: former blend at 30 % stick walks ${r.top.toFixed(2)} m/s while its walk clip plants the feet for ${(r.slipR * r.top).toFixed(2)} m/s (${Math.round((1 - r.slipR) * 100)} % foot slide)`); continue; }
    const want = run ? RUN_TOP : WALK_TOP;
    if (defl === 1) ok(Math.abs(r.T - want) < 0.005 && Math.abs(r.top - want) / want < 0.03, `${name}: full stick = ${r.top.toFixed(3)} m/s (target ${want}, ${run ? 'run' : 'fast walk, Run off'})`);
    else ok(r.top > 1.1 && r.top < 1.6, `${name}: ${Math.round(defl * 100)} % stick = ${r.top.toFixed(2)} m/s (between slow and normal walk)`);
    ok(r.a1 < 6 && r.t50 < 0.21 && r.t95 > 0.3 && r.t95 < 0.65, `${name}: progressive start (1st frame ${r.a1.toFixed(1)} m/s², classic ${R.classic?.a1.toFixed(1)}; 50 % in ${r.t50.toFixed(2)} s, 95 % in ${r.t95.toFixed(2)} s)`);
    ok(r.stopT > 0.1 && r.stopT < 0.45 && !r.rev && r.stopD < Math.max(0.25, 2 * want / 18 * 1.15), `${name}: eased stop on release (rest after ${r.stopT.toFixed(2)} s, ${(r.stopD * 100).toFixed(1)} cm, never reverses)`);
    ok(r.maxStep <= Math.max(want, r.top) / 60 * 1.06, `${name}: no jump (max ${(r.maxStep * 100).toFixed(2)} cm/frame ≤ top speed × 1/60 s)`);
    if (!run) ok(r.walkW > 0.95 && r.runMax === 0 && r.clipErrWalk < 0.03, `${name}: walk clip only (run clip max ${r.runMax}) (≥ ${r.walkW.toFixed(2)}), rate = speed / measured stride speed (max error ${(r.clipErrWalk * 100).toFixed(1)} %)`);
    else ok(r.runW > 0.95 && r.clipErrRun < 0.03, `${name}: run clip (≥ ${r.runW.toFixed(2)}), rate = speed / measured stride speed (max error ${(r.clipErrRun * 100).toFixed(1)} %)`);
    if (!run) ok(Math.abs(r.slipR - 1) < 0.1, `${name}: walk feet planted — the clip's planted foot matches ${(r.slipR * r.top).toFixed(2)} m/s vs body ${r.top.toFixed(2)} m/s (${((r.slipR - 1) * 100).toFixed(0)} %)`);
  }
  fs.writeFileSync(`${SHOTS}/movement.json`, JSON.stringify(R, null, 1));
}

// ---------------------------------------------------------------- 2. name tag vs 'Mode local' chip
if (ONLY.includes('tag')) {
  // real-time frames here (with virtualised rAF the drei <Html> tag layer sometimes stayed at its first position in
  // headless Chrome); Juan is pinned every frame and the test waits for the tag state itself
  const { p, ctx, cdp } = await open('', false);
  const chip = await p.evaluate(() => { const e = [...document.querySelectorAll('.hud-top .chip')].find((x) => /Mode local/.test(x.textContent)); const r = e?.getBoundingClientRect(); return r && { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  ok(!!chip, `'Mode local' chip shown (${chip ? [chip.l, chip.t, chip.r, chip.b].map(Math.round).join(',') : 'none'})`);
  // Juan's tag offset from his feet on screen, then put him where the raw tag lands on the chip
  const r = await p.evaluate((chip) => {
    const W = window.__world; const j = Object.values(W.chars).find((c) => c.name === 'Juan'); const el = [...document.querySelectorAll('.nametag')].find((e) => /^Juan(PNJ)?$/.test(e.textContent));
    const rc = el.getBoundingClientRect(); const [fx, fy] = window.__scr(j.pos.x, 0, j.pos.z); const dx = rc.left + rc.width / 2 - fx, dy = rc.top + rc.height / 2 - fy;
    const V = window.__cam.position.constructor; const sx = (chip.l + chip.r) / 2 - dx, sy = (chip.t + chip.b) / 2 - dy;
    const ndc = new V(sx / innerWidth * 2 - 1, 1 - sy / innerHeight * 2, -1).unproject(window.__cam), dir = new V(); window.__cam.getWorldDirection(dir);
    const k = -ndc.y / dir.y; const x = ndc.x + dir.x * k, z = ndc.z + dir.z * k; j.path = []; j.mode = 'idle'; j.pos.set(x, 0, z); window.__juan = [x, z];
    return { x, z, dx, dy }; }, chip);
  await p.evaluate(() => { const pin = () => { const j = Object.values(window.__world.chars).find((c) => c.name === 'Juan'); j.pos.set(window.__juan[0], 0, window.__juan[1]); j.path = []; requestAnimationFrame(pin); }; pin(); });
  // the tag first follows Juan (projected under the chip), then the avoidance (re-measured every 500 ms, eased) moves it
  await p.waitForFunction((chip) => { const el = [...document.querySelectorAll('.nametag')].find((e) => /^Juan(PNJ)?$/.test(e.textContent)); const r = el.getBoundingClientRect();
    return r.left > chip.l - 40 && r.top >= chip.b - 0.5; }, chip, { timeout: 15000, polling: 100 }).catch(() => {});
  await p.waitForTimeout(800);
  const m = await p.evaluate((chip) => { const el = [...document.querySelectorAll('.nametag')].find((e) => /^Juan(PNJ)?$/.test(e.textContent)); const rc = el.getBoundingClientRect();
    const ty = Number((el.style.transform.match(/translateY\(([-\d.]+)px\)/) ?? [0, 0])[1]); const ov = (t) => Math.max(0, Math.min(rc.right, chip.r) - Math.max(rc.left, chip.l)) * Math.max(0, Math.min(rc.bottom + t, chip.b) - Math.max(rc.top + t, chip.t));
    const j = Object.values(window.__world.chars).find((c) => c.name === 'Juan'); return { juan: [j.pos.x, j.pos.z].map((x) => +x.toFixed(2)), want: window.__juan.map((x) => +x.toFixed(2)), wrap: el.parentElement?.parentElement?.style.transform?.slice(0, 60), rect: [rc.left, rc.top, rc.right, rc.bottom].map(Math.round), ty, overlap: ov(0), rawOverlap: ov(-ty), visible: rc.bottom > 0 && rc.top < innerHeight }; }, chip);
  await shot(cdp, `${SHOTS}/tag_vs_chip.png`);
  ok(m.rawOverlap > 50 && m.ty > 0 && m.overlap === 0 && m.visible, `Juan's tag would cover the 'Mode local' chip (${Math.round(m.rawOverlap)} px²) → moved ${m.ty.toFixed(1)} px down, overlap now ${m.overlap} px², still on screen`, m);
  await ctx.close();
}

// ---------------------------------------------------------------- 3. chat with the iOS keyboard
if (ONLY.includes('chat')) {
  const { p, ctx, cdp } = await open('');
  await p.evaluate(() => { window.game.setPanel('chat'); for (const t of ['Salut Juan', 'On va à la plage ?', 'Dernier message 42']) window.game.sendChat(t); window.__steps(30); });
  await p.waitForTimeout(200);
  const R = (s) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; }, s);
  const inter = (a, c) => !!a && !!c && Math.min(a.r, c.r) > Math.max(a.l, c.l) && Math.min(a.b, c.b) > Math.max(a.t, c.t);
  // keyboard closed: the card leaves the controls and the avatar free
  const sheet = await R('.chat-sheet'); const joy = await R('.joy'), run = await R('.run-btn'), dock = await R('.dock');
  const av = await p.evaluate(() => { const c = window.__world.chars[window.game.s.activeChar]; const a = window.__scr(c.pos.x, 0, c.pos.z), h = window.__scr(c.pos.x, 1.0, c.pos.z); return { l: a[0] - 20, r: a[0] + 20, t: h[1], b: a[1] }; });
  ok(sheet && !inter(sheet, joy) && !inter(sheet, run) && !inter(sheet, dock) && !inter(sheet, av), 'chat open, keyboard closed: the card covers neither the joystick, 🏃, the dock nor the avatar', { sheet, av });
  await p.focus('.chat-sheet input');
  for (const [h, top] of [[170, 0], [140, 0], [120, 0], [100, 0], [140, 60]]) {
    await p.evaluate(([h, top]) => { Object.defineProperty(window.visualViewport, 'height', { get: () => h, configurable: true }); Object.defineProperty(window.visualViewport, 'offsetTop', { get: () => top, configurable: true }); window.visualViewport.dispatchEvent(new Event('resize')); window.__steps(20); }, [h, top]);
    await p.waitForTimeout(250); await p.evaluate(() => window.__steps(10));
    const m = await p.evaluate(([h, top]) => { const q = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { t: b.top, b: b.bottom } : null; };
      const log = document.querySelector('.chatlog'); const lr = log?.getBoundingClientRect(); const last = log?.lastElementChild?.getBoundingClientRect();
      return { kb: document.documentElement.classList.contains('kb-open'), input: q('.chat-sheet input'), send: q('.chat-sheet .chatbar .btn'), x: q('.chat-sheet .x'), lastText: log?.lastElementChild?.textContent ?? '',
        lastVis: !!last && !!lr && lr.height > 0 && last.top >= lr.top - 1 && last.bottom <= lr.bottom + 1 && last.top >= top && last.bottom <= top + h, focus: document.activeElement?.tagName }; }, [h, top]);
    const inV = (r) => !!r && r.t >= top - 0.5 && r.b <= top + h + 0.5;
    await shot(cdp, `${SHOTS}/chat_kb_${h}_${top}.png`);
    ok(m.kb && inV(m.input) && inV(m.send) && m.focus === 'INPUT', `keyboard up, visible ${h} px${top ? ` panned ${top} px` : ''}: input + Envoyer fully visible, focus kept`, { input: m.input, send: m.send });
    if (h >= 90) ok(m.lastVis && /Dernier message 42/.test(m.lastText), `keyboard up, visible ${h} px${top ? ` panned ${top} px` : ''}: newest message visible`);
    if (h >= 125) ok(inV(m.x), `keyboard up, visible ${h} px${top ? ` panned ${top} px` : ''}: header with ✕ visible`);
  }
  await ctx.close();
}
console.log(`errors: ${errs.slice(0, 5).join(' | ') || 'none'}`); ok(errs.length === 0, 'no page errors');
const pass = results.filter((r) => r.ok).length; console.log(`== e2e-gameplay: ${pass}/${results.length} passed ==`);
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 1)); await b.close();
