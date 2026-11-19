import { createRequire } from 'module'; import fs from 'fs'; import { execFileSync } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright-core');
/**
 * Interaction transition recorder + smoothness meter (real game, deterministic virtual time).
 * performance.now + requestAnimationFrame are virtualised (as tools/teaser.mjs): every frame is stepped exactly 1/60 s
 * of game time, so the measured per-frame jumps are those of a 60 fps device whatever the headless speed.
 * For each scenario: walk to the furniture, sit / lie, hold, get up with the real input (touch joystick on phones,
 * keyboard on desktop) or interrupt half-way; records root / hips / head positions, yaw, seat phase each frame,
 * skinned vertices below the seat surface inside the furniture footprint (clipping) every 3rd frame, and crops.
 * usage: node tools/seq-capture.mjs [url] ; DEV=iphone15|desktop ; CHAR=f|m ; (SCEN=sofaCorner adds a corner sofa to the room: run it on its own) SCEN=stool,chair,... ; OUT=dir ; EVERY=2 ; CHECK=1 (assert the
 *        regression limits below: clipping, hip jumps, seated sole height, lounger lying pose; exit code 1 on failure)
 * output: OUT/<scen>_<dev>/f####.png (crops), OUT/full_<dev>/ (full frames for the video), OUT/metrics_<dev>.json
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5270/';
const DEVS = { iphone15: { w: 852, h: 393, dpr: 2, touch: true, crop: [300, 270] }, desktop: { w: 1440, h: 900, dpr: 1, touch: false, crop: [440, 380] } };
const devName = process.env.DEV ?? 'iphone15'; const dev = DEVS[devName]; const CHAR = process.env.CHAR; // CHAR=f|m: avatar used (default: the profile's)
const tag = devName + (CHAR ? '_' + CHAR : '');
const OUT = process.env.OUT ?? '/tmp/seq'; const EVERY = Number(process.env.EVERY ?? 2); const FULL = !!process.env.FULL;
const SCEN = (process.env.SCEN ?? 'stool,chair,deskChair,sofa,armchair,bedEdge,lie,interruptSit,interruptLie').split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: dev.touch, hasTouch: dev.touch });
await ctx.addInitScript(() => {
  try { sessionStorage.setItem('yw.portrait', '1'); localStorage.setItem('yw.camView', 'room'); } catch { /* */ }
  let vt = 0, virt = false; const rp = performance.now.bind(performance); const rr = window.requestAnimationFrame.bind(window); let cbs = [];
  performance.now = () => (virt ? vt : rp());
  window.requestAnimationFrame = (cb) => { if (!virt) return rr(cb); cbs.push(cb); return 1e6 + cbs.length; };
  const rc = window.cancelAnimationFrame.bind(window); window.cancelAnimationFrame = (id) => { if (id < 1e6) rc(id); };
  window.__virt = () => { vt = rp(); virt = true; };
  window.__step = (ms) => { vt += ms; const c = cbs; cbs = []; c.forEach((f) => f(vt)); };
});
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1&lieu=appart', { timeout: 120000 });
await p.waitForFunction(() => window.game?.s.ready && window.__cam && window.__move, null, { timeout: 180000 }); await p.waitForTimeout(4000);
const cdp = await ctx.newCDPSession(p);
await p.evaluate(() => {
  const V = window.__cam.position.constructor; const scene = () => { let s = window.__cam.parent; while (s.parent) s = s.parent; return s; };
  window.__scr = (x, y, z) => { const v = new V(x, y, z).project(window.__cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
  window.__avatarObj = (id) => { let r = null; scene().traverse((o) => { if (o.userData.avatarId === id) r = o; }); return r; };
  window.__z0 = window.__cam.zoom;
  /** world-space triangles of the furniture item whose instance sits at the box centre (cached per box) */
  const triCache = {};
  window.__furnTris = (box) => { const key = box.x.toFixed(3) + ',' + box.z.toFixed(3); if (key in triCache) return triCache[key];
    const out = []; const M = new window.__cam.matrixWorld.constructor(), W = new window.__cam.matrixWorld.constructor(), P = new V(), a = new V();
    scene().traverse((m) => { if (!m.isInstancedMesh || !m.visible) return; const pos = m.geometry.attributes.position, idx = m.geometry.index;
      for (let k = 0; k < m.count; k++) { m.getMatrixAt(k, M); W.multiplyMatrices(m.matrixWorld, M); P.setFromMatrixPosition(W); if (Math.hypot(P.x - box.x, P.z - box.z) > 0.03) continue;
        const nI = idx ? idx.count : pos.count; for (let t = 0; t < nI; t++) { a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(W); out.push(a.x, a.y, a.z); } } });
    return (triCache[key] = out.length ? new Float32Array(out) : null); };
  /** depth of (x,y,z) inside the closed triangle soup T (0 = outside): parity of the 6 axis rays, ≥ 4 odd = inside (robust to open Kenney seams) */
  const bbCache = new WeakMap(); // per-triangle AABB: an axis ray can only hit triangles whose box spans the 2 other coordinates
  window.__inside = (T, x, y, z) => { let B = bbCache.get(T); if (!B) { B = new Float32Array(T.length / 9 * 6); for (let t = 0, k = 0; t < T.length; t += 9, k += 6) for (let a = 0; a < 3; a++) { B[k + a] = Math.min(T[t + a], T[t + 3 + a], T[t + 6 + a]); B[k + 3 + a] = Math.max(T[t + a], T[t + 3 + a], T[t + 6 + a]); } bbCache.set(T, B); }
    const D = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]; const cnt = [0, 0, 0, 0, 0, 0]; const near = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity]; const P = [x, y, z];
    for (let t = 0, k = 0; t < T.length; t += 9, k += 6) { const inX = x >= B[k] && x <= B[k + 3], inY = y >= B[k + 1] && y <= B[k + 4], inZ = z >= B[k + 2] && z <= B[k + 5];
      if ((inY ? 1 : 0) + (inZ ? 1 : 0) + (inX ? 1 : 0) < 2) continue;
      const ax = T[t], ay = T[t + 1], az = T[t + 2], e1x = T[t + 3] - ax, e1y = T[t + 4] - ay, e1z = T[t + 5] - az, e2x = T[t + 6] - ax, e2y = T[t + 7] - ay, e2z = T[t + 8] - az;
      const sx = x - ax, sy = y - ay, sz = z - az;
      for (let di = 0; di < 6; di++) { const axis = di % 3; if (!(axis === 0 ? inY && inZ : axis === 1 ? inX && inZ : inX && inY)) continue; if (di < 3 ? B[k + 3 + axis] < P[axis] : B[k + axis] > P[axis]) continue;
        const [dx, dy, dz] = D[di]; const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x; const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det; const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue; const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv; if (w < 0 || u + w > 1) continue; const tt = (e2x * qx + e2y * qy + e2z * qz) * inv; if (tt > 1e-6) { cnt[di]++; if (tt < near[di]) near[di] = tt; } } }
    const odd = cnt.filter((c) => c % 2 === 1).length; return odd >= 4 ? Math.min(...near) : 0; };
  /** one sample: root, yaw, hips/head bones, seat phase; `pen` = deepest skinned vertex below the surface inside the footprint */
  window.__sample = (box, pen) => {
    const g = window.game, id = g.s.activeChar, c = window.__world.chars[id], o = window.__avatarObj(id); const v = new V(); let H, Hd;
    o.traverse((m) => { if (m.isBone && m.name === 'Hips' && !H) H = m.getWorldPosition(new V()); if (m.isBone && m.name === 'Head' && !Hd) Hd = m.getWorldPosition(new V()); });
    let depth = 0, n = 0, penAt = null, sole = Infinity, slab = 0; const SLAB = 0.12; // slab = depth into the top 12 cm (cushion / seat board)
    if (pen && box) { const cs = Math.cos(box.yaw), sn = Math.sin(box.yaw);
      o.traverse((m) => { if (!m.isSkinnedMesh || /outline/.test(m.name)) return; for (let q = m; q; q = q.parent) if (!q.visible) return; const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 2) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); if (v.y < sole) sole = v.y; const dx = v.x - box.x, dz = v.z - box.z; const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
          if (Math.abs(lx) < box.w / 2 - 0.01 && Math.abs(lz) < box.d / 2 - 0.01 && v.y < box.h - 0.01 && v.y > 0.02) { n++; if (box.h - v.y < SLAB && box.h - v.y > slab) slab = box.h - v.y; if (box.h - v.y > depth) { depth = box.h - v.y; penAt = [+lx.toFixed(3), +v.y.toFixed(3), +lz.toFixed(3)]; } } } }); }
    // real mesh clipping: skinned vertices INSIDE the furniture's own triangles (ray parity on 3 axes, majority vote), depth =
    // nearest surface along the 6 axis rays. Unlike the footprint box this ignores the open space between a stool's legs.
    let mDepth = 0, mN = 0, mAt = null; const FB = {};
    o.traverse((m) => { if (m.isBone && /^(Left|Right)(Foot|ToeBase)$/.test(m.name) && !FB[m.name]) FB[m.name] = m.getWorldPosition(new V()); });
    if (pen && box) { const T = window.__furnTris(box); if (T) { const cs = Math.cos(box.yaw), sn = Math.sin(box.yaw);
      o.traverse((m) => { if (!m.isSkinnedMesh || /outline/.test(m.name)) return; for (let q = m; q; q = q.parent) if (!q.visible) return; const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 2) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); const dx = v.x - box.x, dz = v.z - box.z; const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
          if (Math.abs(lx) > box.w / 2 + 0.05 || Math.abs(lz) > box.d / 2 + 0.05 || v.y > box.h + 0.35) continue;
          const r = window.__inside(T, v.x, v.y, v.z); if (r > 0.002) { mN++; if (r > mDepth) { mDepth = r; mAt = [+lx.toFixed(3), +v.y.toFixed(3), +lz.toFixed(3)]; } } } }); } }
    const toBox = (q) => { if (!box || !q) return null; const cs = Math.cos(box.yaw), sn = Math.sin(box.yaw), dx = q.x - box.x, dz = q.z - box.z; return [+(dx * cs - dz * sn).toFixed(3), +q.y.toFixed(3), +(dx * sn + dz * cs).toFixed(3)]; };
    const d = window.__move().seat;
    return { meshPen: pen && box ? +mDepth.toFixed(3) : null, meshPenN: pen && box ? mN : null, meshAt: mAt, feet: { lf: toBox(FB.LeftFoot), lt: toBox(FB.LeftToeBase), rf: toBox(FB.RightFoot), rt: toBox(FB.RightToeBase) }, pos: [c.pos.x, c.pos.y, c.pos.z], yaw: c.yaw, hips: H.toArray(), head: Hd.toArray(), mode: c.mode, phase: d?.phase ?? 'none', sp: d?.sp ?? 0, lp: d?.lp ?? 0, w: d?.w ?? 0, pitch: d?.pitch ?? 0, pen: pen ? +depth.toFixed(3) : null, penN: pen ? n : null, penAt, slab: pen ? +slab.toFixed(3) : null, sole: pen && Number.isFinite(sole) ? +sole.toFixed(3) : null,
      torso: +(Math.atan2(Math.hypot(Hd.x - H.x, Hd.z - H.z), Hd.y - H.y) * 180 / Math.PI).toFixed(1) };
  };
});
const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const joy = dev.touch ? await p.evaluate(() => { const j = document.querySelector('.joy'); const r = j.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, R: r.width * 0.4 }; }) : null;
async function pushStick(on, ang = -90) { // ang: screen degrees, -90 = down the screen (towards the camera)
  if (dev.touch) { if (on) { await T('touchStart', [{ x: joy.cx, y: joy.cy, id: 1 }]); await T('touchMove', [{ x: joy.cx + Math.cos(ang * Math.PI / 180) * joy.R, y: joy.cy - Math.sin(ang * Math.PI / 180) * joy.R, id: 1 }]); } else await T('touchEnd', []); }
  else { if (on) await p.keyboard.down('ArrowDown'); else await p.keyboard.up('ArrowDown'); }
}
const SEATS = { stool: ['stoolBar', 'sit'], chair: ['chair', 'sit'], deskChair: ['chairDesk', 'sit'], sofa: ['loungeSofa', 'sit'], sofaCorner: ['loungeSofaCorner', 'sit'], armchair: ['loungeChair', 'sit'], bedEdge: ['bedDouble', 'sit'], lie: ['bedDouble', 'lie'], interruptSit: ['loungeSofa', 'sit'], interruptLie: ['bedDouble', 'lie'], lounger: ['lounger2', 'lie', 'beach'], interruptLounger: ['lounger2', 'lie', 'beach'] };
fs.mkdirSync(OUT, { recursive: true }); const fullDir = `${OUT}/full_${devName}`; if (FULL) { fs.rmSync(fullDir, { recursive: true, force: true }); fs.mkdirSync(fullDir, { recursive: true }); }
await p.evaluate(() => { const g = window.game; const apt = g.s.apartment; if (!apt.items.some((i) => i.defId === 'stoolBar')) g['setLayout']({ ...apt, items: [...apt.items, { uid: 't_stool', defId: 'stoolBar', x: 10, z: 12, rot: 0 }, { uid: 't_desk', defId: 'chairDesk', x: 14, z: 12, rot: 2 }] }, 'place', {}); });
if (SCEN.includes('sofaCorner')) await p.evaluate(() => { const g = window.game; const apt = g.s.apartment; if (!apt.items.some((i) => i.defId === 'loungeSofaCorner')) g['setLayout']({ ...apt, items: [...apt.items, { uid: 't_corner', defId: 'loungeSofaCorner', x: 6, z: 12, rot: 0 }] }, 'place', {}); });
await p.waitForTimeout(2500);
if (CHAR) { await p.evaluate((c) => window.game.setActive(c), CHAR); await p.waitForTimeout(500); }
await p.evaluate(() => window.__virt());
let fullN = 0; const all = {};
for (const sc of SCEN) {
  const [defId, act, place] = SEATS[sc]; const dir = `${OUT}/${sc}_${tag}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  if (place === 'beach' && (await p.evaluate(() => window.game.s.location)) !== 'beach') { await p.evaluate(() => window.game.travel('beach')); for (let i = 0; i < 90; i++) await p.evaluate(() => window.__step(1000 / 60)); }
  if (place !== 'beach' && (await p.evaluate(() => window.game.s.location)) !== 'home') { await p.evaluate(() => window.game.travel('home')); for (let i = 0; i < 90; i++) await p.evaluate(() => window.__step(1000 / 60)); }
  const info = place === 'beach' ? await p.evaluate((propId) => {
    // Yoo Plage transat (registry preset 'lounger'): same flow as the bed, measured against its flat fabric
    const g = window.game; const W = window.__world; const id = g.s.activeChar; const c = W.chars[id];
    for (const o of Object.values(W.chars)) if (o.id !== id) { o.sitOn = undefined; o.pendingSeat = undefined; o.path = []; o.mode = 'idle'; }
    c.sitOn = undefined; c.pendingSeat = undefined; c.path = []; c.mode = 'idle';
    const seat = W.seats.find((s) => s.id === propId + ':0'); const f = [Math.sin(seat.yaw), Math.cos(seat.yaw)];
    c.pos.set(seat.front.x + f[0] * 0.9, 0, seat.front.z + f[1] * 0.9); c.yaw = seat.yaw + Math.PI;
    window.__cam.zoom = window.__z0 * 1.7; window.__cam.updateProjectionMatrix(); window.dispatchEvent(new Event('yw:follow'));
    const cx = seat.pos.x + f[0] * 0.09, cz = seat.pos.z + f[1] * 0.09; // centre of the fabric (seat.pos = hips at local z 0.03; fabric z -0.19..0.43)
    return { uid: propId, beach: true, box: { x: cx, z: cz, w: 0.46, d: 0.62, yaw: seat.yaw, h: seat.h }, hip: [seat.hip.x, seat.hip.z] };
  }, defId) : await p.evaluate(([defId, act]) => {
    const g = window.game; const it = g.s.apartment.items.find((i) => i.defId === defId); if (!it) return null; const W = window.__world; const id = g.s.activeChar; const c = W.chars[id];
    for (const o of Object.values(W.chars)) if (o.id !== id) { o.sitOn = undefined; o.pendingSeat = undefined; o.path = []; o.mode = 'idle'; }
    c.sitOn = undefined; c.pendingSeat = undefined; c.path = []; c.mode = 'idle';
    // start ~0.9 m further out than the walk-to point, on a free nav cell
    const seat = W.seats.find((s) => s.id.startsWith(it.uid + ':') && (s.pose ?? 'sit') === act); const f = [Math.sin(seat.yaw), Math.cos(seat.yaw)];
    let sx = seat.front.x + f[0] * 0.9, sz = seat.front.z + f[1] * 0.9; const nav = W.nav; let [i, j] = nav.toCell(sx, sz); if (!nav.free(i, j)) { [i, j] = nav.nearestFree(i, j); const q = nav.center(i, j); sx = q.x; sz = q.z; }
    c.pos.set(sx, 0, sz); c.yaw = seat.yaw + Math.PI; // facing the seat
    window.__cam.zoom = window.__z0 * 1.7; window.__cam.updateProjectionMatrix(); window.dispatchEvent(new Event('yw:follow'));
    const ip = window.__itemPoints().find((q) => q.uid === it.uid); const reg = g.cat[defId].seat;
    return { uid: it.uid, box: { x: ip.x, z: ip.z, w: ip.w, d: ip.d, yaw: seat.yaw, h: act === 'lie' ? reg.lie.h : reg.h }, hip: act === 'lie' ? [(seat.hip.x + ip.x) / 2, (seat.hip.z + ip.z) / 2] : seat.hip ? [seat.hip.x, seat.hip.z] : [seat.pos.x, seat.pos.z] };
  }, [defId, act]);
  if (!info) { console.log('SKIP', sc); continue; }
  for (let i = 0; i < 40; i++) await p.evaluate(() => window.__step(1000 / 60)); // camera settles
  await p.evaluate(([uid, act, beach]) => (beach ? window.game.interactProp(uid, 'sit') : window.game.interact(uid, act)), [info.uid, act, !!info.beach]);
  const S = []; let f = 0, stage = 'in', hold = 0, outAt = -1; const DT = 1000 / 60;
  const cw = dev.crop[0], ch = dev.crop[1];
  for (; f < 60 * 14; f++) {
    await p.evaluate((dt) => window.__step(dt), DT);
    const s = await p.evaluate(([box, pen]) => window.__sample(box, pen), [info.box, f % 3 === 0]); s.f = f; s.stage = stage; S.push(s);
    // script
    const target = act === 'lie' ? 'lying' : 'seated';
    if (stage === 'in') {
      if (sc === 'interruptSit' && s.phase === 'down' && s.sp >= 0.45) { stage = 'out'; outAt = f; await pushStick(true); }
      else if ((sc === 'interruptLie' || sc === 'interruptLounger') && s.phase === 'recline' && s.lp >= 0.5) { stage = 'out'; outAt = f; await pushStick(true); }
      else if (s.phase === target) { hold++; if (hold > 30) { stage = 'out'; outAt = f; await pushStick(true); } }
    } else if (stage === 'out') { if (s.mode === 'walk' || s.mode === 'idle') { stage = 'walkoff'; hold = 0; } }
    else if (stage === 'walkoff') { if (++hold === 24) await pushStick(false); if (hold > 40) break; }
    if (f % EVERY === 0 && f > 20) {
      const [sx, sy] = await p.evaluate(([x, z]) => window.__scr(x, 0.42, z), info.hip);
      const clip = { x: Math.max(0, Math.min(dev.w - cw, sx - cw / 2)), y: Math.max(0, Math.min(dev.h - ch, sy - ch * 0.55)), width: cw, height: ch };
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
      fs.writeFileSync(`${dir}/f${String(f).padStart(4, '0')}.png`, Buffer.from(r.data, 'base64'));
      if (FULL) { const r2 = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }); fs.writeFileSync(`${fullDir}/f${String(fullN++).padStart(5, '0')}.jpg`, Buffer.from(r2.data, 'base64')); }
    }
  }
  if (stage === 'out') await pushStick(false);
  // smoothness: max per-frame displacement of the root, hips bone and head bone (cm), yaw change (deg), during the interaction
  const live = S.filter((s, i) => i > 0 && (s.phase !== 'none' || S[i - 1].phase !== 'none' || s.mode === 'sitting' || s.mode === 'standing' || S[i - 1].mode === 'sitting' || S[i - 1].mode === 'standing'));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
  const mx = { root: 0, hips: 0, head: 0, yaw: 0 }; const at = {};
  for (const s of live) { const q = S[s.f - 1]; if (!q) continue; for (const [k, v] of [['root', dist(s.pos, q.pos)], ['hips', dist(s.hips, q.hips)], ['head', dist(s.head, q.head)], ['yaw', Math.abs(Math.atan2(Math.sin(s.yaw - q.yaw), Math.cos(s.yaw - q.yaw))) * 180 / Math.PI]]) if (v > mx[k]) { mx[k] = v; at[k] = `${s.f}:${q.phase}->${s.phase}`; } }
  const pen = Math.max(0, ...S.filter((s) => s.pen !== null && s.phase !== 'none').map((s) => s.pen));
  const penPhase = S.filter((s) => s.pen > 0.015).map((s) => s.phase); const phases = {}; for (const s of S) { phases[s.phase] = (phases[s.phase] ?? 0) + 1; }
  const med = (a) => { const q = a.filter((x) => x !== null && Number.isFinite(x)).sort((x, y) => x - y); return q.length ? q[q.length >> 1] : null; };
  const seated = S.filter((s) => s.phase === 'seated'), lying = S.filter((s) => s.phase === 'lying');
  const slabPen = Math.max(0, ...S.filter((s) => s.slab !== null && s.slab !== undefined && s.phase !== 'none').map((s) => s.slab));
  const meshPen = Math.max(0, ...S.filter((s) => s.meshPen !== null && s.meshPen !== undefined && s.phase !== 'none').map((s) => s.meshPen));
  const extra = { meshPenCm: +(meshPen * 100).toFixed(1), meshPenAt: S.reduce((b, s) => (s.meshPen > (b?.meshPen ?? 0) ? s : b), null)?.meshAt ?? null, feetSeated: seated.length ? seated[seated.length >> 1].feet : null, seatPenCm: +(slabPen * 100).toFixed(1), soleSeated: med(seated.map((s) => s.sole)), torsoLying: med(lying.map((s) => s.torso)), penLyingCm: lying.length ? +(Math.max(0, ...lying.filter((s) => s.pen !== null).map((s) => s.pen)) * 100).toFixed(1) : null };
  const res = { scen: sc, ...extra, frames: S.length, outAt, maxJumpCm: Object.fromEntries(Object.entries(mx).map(([k, v]) => [k, +v.toFixed(2)])), at, maxPenCm: +(pen * 100).toFixed(1), penPhases: [...new Set(penPhase)], phaseFrames: phases, endMode: S[S.length - 1].mode };
  all[sc] = { ...res, samples: S }; console.log(JSON.stringify(res));
}
fs.writeFileSync(`${OUT}/metrics_${tag}.json`, JSON.stringify(all));
if (process.env.CHECK) {
  // regression limits (gameplay polish). Option C (round 2): seats lowered so the feet reach the floor / the bar stool's
  // foot ring (data/furnitureReshape.ts). sole = median lowest skinned vertex while seated (floor = 0); meshPen = deepest
  // skinned vertex INSIDE the furniture mesh over the whole sit / stand-up (soft cushion contact, before Option C: chair
  // 0.7 / 0.3, desk chair 0.9 / 1.1, sofa 1.1 / 1.7, armchair 0.9 / 1.5, stool 0 / 0 cm for Juanita / Juan).
  const ringSrc = fs.readFileSync(new URL('../src/data/furnitureReshape.ts', import.meta.url), 'utf8').match(/stoolBar:[^\n]*ring: \{ y: ([\d.]+), r: ([\d.]+), tube: [\d.]+, cz: ([\d.]+) \}/);
  const RING = ringSrc ? { y: +ringSrc[1], r: +ringSrc[2], cz: +ringSrc[3] } : null;
  const LIM = { stool: { pen: 1.0, mesh: 1.0, ring: true }, chair: { pen: 1.0, mesh: 1.2, sole: 0.035 }, deskChair: { pen: 1.0, mesh: 1.2, sole: 0.035 },
    sofa: { mesh: 1.6, sole: 0.055 }, armchair: { mesh: 1.6, sole: 0.055 }, sofaCorner: { mesh: 1.0, sole: 0.055 },
    lounger: { pen: 4.0, penLying: 0.5, torso: [25, 45] }, interruptLounger: { pen: 4.0 } };
  // Juan (CHAR=m, longer thighs) was never gated before; his caps = his own pre-Option-C contact (desk chair slab 1.7 /
  // mesh 1.1, sofa 1.7, armchair 1.5 cm) + 0.3 cm. Juanita keeps the limits above.
  if (CHAR === 'm') Object.assign(LIM, { deskChair: { ...LIM.deskChair, pen: 2.0, mesh: 1.5 }, sofa: { ...LIM.sofa, mesh: 2.0 }, armchair: { ...LIM.armchair, mesh: 2.0 } });
  let bad = 0; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined && extra !== null ? ' ' + JSON.stringify(extra) : '')); if (!c) bad++; };
  for (const [sc, r] of Object.entries(all)) { const L = LIM[sc] ?? {};
    ok(r.endMode === 'walk' || r.endMode === 'idle', `${sc}: gets up and walks off (end mode ${r.endMode})`);
    ok(r.maxJumpCm.hips <= 6 && r.maxJumpCm.root <= 6, `${sc}: smooth (max per-frame jump hips ${r.maxJumpCm.hips} cm, root ${r.maxJumpCm.root} cm ≤ 6)`);
    // clipping INTO the seat = skin inside the top 12 cm under the seat surface (a foot stepping under the stool's front edge,
    // between its legs, is not a clip: the deepest point over the whole footprint volume is logged as maxPenCm)
    if (L.pen !== undefined) ok(r.seatPenCm <= L.pen, `${sc}: clipping into the seat ${r.seatPenCm} cm ≤ ${L.pen} (whole sit / stand-up; deepest point in the footprint volume ${r.maxPenCm} cm)`);
    if (L.mesh !== undefined) ok(r.meshPenCm <= L.mesh, `${sc}: skin inside the furniture mesh ${r.meshPenCm} cm ≤ ${L.mesh}`, r.meshPenAt);
    if (L.ring) { ok(!!RING && r.soleSeated !== null && Math.abs(r.soleSeated - RING.y) <= 0.012, `${sc}: seated soles on the foot ring (sole ${r.soleSeated} m, ring top ${RING?.y} ± 0.012)`);
      const f = r.feetSeated; const under = (a, t) => { const rz = RING.cz + Math.sqrt(Math.max(0, RING.r ** 2 - ((a[0] + t[0]) / 2) ** 2)); return rz >= Math.min(a[2], t[2]) - 0.01 && rz <= Math.max(a[2], t[2]) + 0.01; };
      ok(!!f && !!RING && under(f.lf, f.lt) && under(f.rf, f.rt), `${sc}: the ring passes under both feet (between ankle and toes)`, f); }
    if (L.sole !== undefined) ok(r.soleSeated !== null && r.soleSeated <= L.sole, `${sc}: seated sole height ${r.soleSeated} m ≤ ${L.sole}`);
    if (L.penLying !== undefined) ok(r.penLyingCm !== null && r.penLyingCm <= L.penLying, `${sc}: lying on the lounger, clipping ${r.penLyingCm} cm ≤ ${L.penLying}`);
    if (L.torso) ok(r.torsoLying !== null && r.torsoLying >= L.torso[0] && r.torsoLying <= L.torso[1], `${sc}: lying reclined on the backrest (torso ${r.torsoLying}° from vertical, ${L.torso[0]}–${L.torso[1]}°)`);
  }
  console.log(`== seq-capture checks: ${bad ? bad + ' failed' : 'all passed'} ==`); if (bad) process.exitCode = 1;
}
console.log('errors:', errs.slice(0, 5).join(' | ') || 'none'); await b.close();
