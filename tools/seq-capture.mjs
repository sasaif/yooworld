import { createRequire } from 'module'; import fs from 'fs'; import { execFileSync } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright-core');
/**
 * Interaction transition recorder + smoothness meter (real game, deterministic virtual time).
 * performance.now + requestAnimationFrame are virtualised (as tools/teaser.mjs): every frame is stepped exactly 1/60 s
 * of game time, so the measured per-frame jumps are those of a 60 fps device whatever the headless speed.
 * For each scenario: walk to the furniture, sit / lie, hold, get up with the real input (touch joystick on phones,
 * keyboard on desktop) or interrupt half-way; records root / hips / head positions, yaw, seat phase each frame,
 * skinned vertices below the seat surface inside the furniture footprint (clipping) every 3rd frame, and crops.
 * usage: node tools/seq-capture.mjs [url] ; DEV=iphone15|desktop ; SCEN=stool,chair,... ; OUT=dir ; EVERY=2
 * output: OUT/<scen>_<dev>/f####.png (crops), OUT/full_<dev>/ (full frames for the video), OUT/metrics_<dev>.json
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5270/';
const DEVS = { iphone15: { w: 852, h: 393, dpr: 2, touch: true, crop: [300, 270] }, desktop: { w: 1440, h: 900, dpr: 1, touch: false, crop: [440, 380] } };
const devName = process.env.DEV ?? 'iphone15'; const dev = DEVS[devName];
const OUT = process.env.OUT ?? '/tmp/seq'; const EVERY = Number(process.env.EVERY ?? 2); const FULL = !!process.env.FULL;
const SCEN = (process.env.SCEN ?? 'stool,chair,deskChair,sofa,armchair,bedEdge,lie,interruptSit,interruptLie').split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: dev.touch, hasTouch: dev.touch });
await ctx.addInitScript(() => {
  try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', 'room'); } catch { /* */ }
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
  /** one sample: root, yaw, hips/head bones, seat phase; `pen` = deepest skinned vertex below the surface inside the footprint */
  window.__sample = (box, pen) => {
    const g = window.game, id = g.s.activeChar, c = window.__world.chars[id], o = window.__avatarObj(id); const v = new V(); let H, Hd;
    o.traverse((m) => { if (m.isBone && m.name === 'Hips' && !H) H = m.getWorldPosition(new V()); if (m.isBone && m.name === 'Head' && !Hd) Hd = m.getWorldPosition(new V()); });
    let depth = 0, n = 0;
    if (pen && box) { const cs = Math.cos(box.yaw), sn = Math.sin(box.yaw);
      o.traverse((m) => { if (!m.isSkinnedMesh || /outline/.test(m.name)) return; for (let q = m; q; q = q.parent) if (!q.visible) return; const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 2) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); const dx = v.x - box.x, dz = v.z - box.z; const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
          if (Math.abs(lx) < box.w / 2 - 0.01 && Math.abs(lz) < box.d / 2 - 0.01 && v.y < box.h - 0.01 && v.y > 0.02) { n++; depth = Math.max(depth, box.h - v.y); } } }); }
    const d = window.__move().seat;
    return { pos: [c.pos.x, c.pos.y, c.pos.z], yaw: c.yaw, hips: H.toArray(), head: Hd.toArray(), mode: c.mode, phase: d?.phase ?? 'none', sp: d?.sp ?? 0, lp: d?.lp ?? 0, w: d?.w ?? 0, pitch: d?.pitch ?? 0, pen: pen ? +depth.toFixed(3) : null, penN: pen ? n : null };
  };
});
const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const joy = dev.touch ? await p.evaluate(() => { const j = document.querySelector('.joy'); const r = j.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, R: r.width * 0.4 }; }) : null;
async function pushStick(on, ang = -90) { // ang: screen degrees, -90 = down the screen (towards the camera)
  if (dev.touch) { if (on) { await T('touchStart', [{ x: joy.cx, y: joy.cy, id: 1 }]); await T('touchMove', [{ x: joy.cx + Math.cos(ang * Math.PI / 180) * joy.R, y: joy.cy - Math.sin(ang * Math.PI / 180) * joy.R, id: 1 }]); } else await T('touchEnd', []); }
  else { if (on) await p.keyboard.down('ArrowDown'); else await p.keyboard.up('ArrowDown'); }
}
const SEATS = { stool: ['stoolBar', 'sit'], chair: ['chair', 'sit'], deskChair: ['chairDesk', 'sit'], sofa: ['loungeSofa', 'sit'], armchair: ['loungeChair', 'sit'], bedEdge: ['bedDouble', 'sit'], lie: ['bedDouble', 'lie'], interruptSit: ['loungeSofa', 'sit'], interruptLie: ['bedDouble', 'lie'] };
fs.mkdirSync(OUT, { recursive: true }); const fullDir = `${OUT}/full_${devName}`; if (FULL) { fs.rmSync(fullDir, { recursive: true, force: true }); fs.mkdirSync(fullDir, { recursive: true }); }
await p.evaluate(() => { const g = window.game; const apt = g.s.apartment; if (!apt.items.some((i) => i.defId === 'stoolBar')) g['setLayout']({ ...apt, items: [...apt.items, { uid: 't_stool', defId: 'stoolBar', x: 10, z: 12, rot: 0 }, { uid: 't_desk', defId: 'chairDesk', x: 14, z: 12, rot: 2 }] }, 'place', {}); });
await p.waitForTimeout(2500);
await p.evaluate(() => window.__virt());
let fullN = 0; const all = {};
for (const sc of SCEN) {
  const [defId, act] = SEATS[sc]; const dir = `${OUT}/${sc}_${devName}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const info = await p.evaluate(([defId, act]) => {
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
  await p.evaluate(([uid, act]) => window.game.interact(uid, act), [info.uid, act]);
  const S = []; let f = 0, stage = 'in', hold = 0, outAt = -1; const DT = 1000 / 60;
  const cw = dev.crop[0], ch = dev.crop[1];
  for (; f < 60 * 14; f++) {
    await p.evaluate((dt) => window.__step(dt), DT);
    const s = await p.evaluate(([box, pen]) => window.__sample(box, pen), [info.box, f % 3 === 0]); s.f = f; s.stage = stage; S.push(s);
    // script
    const target = act === 'lie' ? 'lying' : 'seated';
    if (stage === 'in') {
      if (sc === 'interruptSit' && s.phase === 'down' && s.sp >= 0.45) { stage = 'out'; outAt = f; await pushStick(true); }
      else if (sc === 'interruptLie' && s.phase === 'recline' && s.lp >= 0.5) { stage = 'out'; outAt = f; await pushStick(true); }
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
  const res = { scen: sc, frames: S.length, outAt, maxJumpCm: Object.fromEntries(Object.entries(mx).map(([k, v]) => [k, +v.toFixed(2)])), at, maxPenCm: +(pen * 100).toFixed(1), penPhases: [...new Set(penPhase)], phaseFrames: phases, endMode: S[S.length - 1].mode };
  all[sc] = { ...res, samples: S }; console.log(JSON.stringify(res));
}
fs.writeFileSync(`${OUT}/metrics_${devName}.json`, JSON.stringify(all));
console.log('errors:', errs.slice(0, 5).join(' | ') || 'none'); await b.close();
