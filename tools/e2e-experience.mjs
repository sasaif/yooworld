import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)('playwright-core');
// Experience polish e2e (real game, real CDP touch on phones / real mouse on desktop):
// full-screen stage, camera kept on the room (pan / Vue perso), compact chat + 'Mode local', seat & bed anchors, watch TV.
// usage: node tools/e2e-experience.mjs [url] ; DEV=iphone15|pixel7|ipad|desktop ; SHOTS=dir ; SEATS_ONLY=1 (seat close-ups only, old builds too)
const url = process.argv[2] ?? 'http://127.0.0.1:5243/';
const DEVS = { iphone15: { w: 852, h: 393, dpr: 3, touch: true }, pixel7: { w: 915, h: 412, dpr: 2.625, touch: true }, ipad: { w: 1024, h: 768, dpr: 2, touch: true }, desktop: { w: 1440, h: 900, dpr: 1, touch: false } };
const devName = process.env.DEV ?? 'iphone15'; const dev = DEVS[devName]; const TOUCH = dev.touch; const DPR = Number(process.env.DPR ?? Math.min(dev.dpr, 2));
const SHOTS = process.env.SHOTS ?? 'shots/experience/e2e'; fs.mkdirSync(SHOTS, { recursive: true }); const SEATS_ONLY = !!process.env.SEATS_ONLY;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: DPR, isMobile: TOUCH, hasTouch: TOUCH });
await ctx.addInitScript(() => { try { sessionStorage.setItem('yw.portrait', '1'); localStorage.setItem('yw.camView', 'room'); } catch { /* */ } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m, extra }); if (!c) process.exitCode = 1; };
const sep = url.includes('?') ? '&' : '?';
await p.goto(url + sep + 'fresh=1&lieu=appart', { timeout: 120000 });
await p.waitForFunction(() => window.game?.s.ready && window.__cam && window.__move, null, { timeout: 180000 }); await p.waitForTimeout(4000);
const cdp = await ctx.newCDPSession(p);
const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 1500) requestAnimationFrame(f); else res(n / 1.5); }; requestAnimationFrame(f); }));
console.log(`== Experience · ${devName} ${dev.w}x${dev.h} @${DPR}x ~${Math.round(fps)} fps (headless SwiftShader) · ${url} ==`);
const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function tap(x, y) { if (TOUCH) { await T('touchStart', [{ x, y, id: 1 }]); await p.waitForTimeout(60); await T('touchEnd', []); } else await p.mouse.click(x, y); }
async function drag(x0, y0, x1, y1, steps = 8) {
  if (TOUCH) { await T('touchStart', [{ x: x0, y: y0, id: 1 }]); for (let i = 1; i <= steps; i++) await T('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }]); await T('touchEnd', []); }
  else { await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i <= steps; i++) await p.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await p.mouse.up(); }
}
await p.evaluate(() => {
  const V = window.__cam.position.constructor; const scene = () => { let s = window.__cam.parent; while (s.parent) s = s.parent; return s; };
  window.__scr = (x, y, z) => { const v = new V(x, y, z).project(window.__cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
  /** room silhouette % of the screen and % of the room visible (same maths as tools/exp-audit.mjs) */
  window.__frame = () => {
    const W = innerWidth, H = innerHeight; const pr = (x, y, z) => window.__scr(x, y, z);
    const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
    const hull = (pts) => { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
      for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (const q of P.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
    const clip = (poly) => { const E = [[(q) => q[0] >= 0, (a, c) => [0, a[1] + (c[1] - a[1]) * (0 - a[0]) / (c[0] - a[0])]], [(q) => q[0] <= W, (a, c) => [W, a[1] + (c[1] - a[1]) * (W - a[0]) / (c[0] - a[0])]], [(q) => q[1] >= 0, (a, c) => [a[0] + (c[0] - a[0]) * (0 - a[1]) / (c[1] - a[1]), 0]], [(q) => q[1] <= H, (a, c) => [a[0] + (c[0] - a[0]) * (H - a[1]) / (c[1] - a[1]), H]]];
      let o = poly; for (const [ins, X] of E) { const i = o; o = []; for (let k = 0; k < i.length; k++) { const a = i[k], c = i[(k + 1) % i.length]; if (ins(c)) { if (!ins(a)) o.push(X(a, c)); o.push(c); } else if (ins(a)) o.push(X(a, c)); } if (!o.length) break; } return o; };
    const hp = hull([[0, 0, 0], [7.2, 0, 0], [0, 0, 6], [7.2, 0, 6], [0, 1.55, 0], [7.2, 1.55, 0], [0, 1.55, 6]].map(([x, y, z]) => pr(x, y, z))); const ins = area(clip(hp));
    return { roomPct: +(100 * ins / (W * H)).toFixed(1), visPct: +(100 * ins / area(hp)).toFixed(1) };
  };
  window.__avatarObj = (id) => { let r = null; scene().traverse((o) => { if (o.userData.avatarId === id) r = o; }); return r; };
  /** exact skinned vertices (subsampled) of an avatar: lowest point + hips bone + head bone + group pitch */
  window.__body = (id) => { const o = window.__avatarObj(id); o.updateWorldMatrix(true, true); let lo = Infinity; const bones = {}; const v = new V();
    o.traverse((m) => { if (m.isBone && /^(Hips|Head)$/.test(m.name)) bones[m.name] = m.getWorldPosition(new V()).toArray();
      let vis = true; for (let q = m; q; q = q.parent) if (!q.visible) vis = false;
      if (vis && m.isSkinnedMesh && !/outline/.test(m.name)) { const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i += 3) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); if (v.y < lo) lo = v.y; } } });
    return { lo, hips: bones.Hips, head: bones.Head, pitch: o.parent.rotation.x }; };
  /** seated pose metrics: lowest visible vertex over the seat surface, pelvis, knee angles, thigh slope, sole height */
  window.__seatPose = (id, uid, yaw, seatH, front) => { const o = window.__avatarObj(id); o.updateWorldMatrix(true, true); const it = window.__itemPoints().find((x) => x.uid === uid); const v = new V(); const B = {};
    o.traverse((m) => { if (m.isBone && !B[m.name]) B[m.name] = m.getWorldPosition(new V()); });
    const loc = (p) => { const dx = p.x - it.x, dz = p.z - it.z; return [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)]; };
    const hl = loc(B.Hips); let under = Infinity, sole = Infinity;
    o.traverse((m) => { if (!m.isMesh || /outline/.test(m.name)) return; for (let q = m; q; q = q.parent) if (!q.visible) return; const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) { if (m.isSkinnedMesh) m.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i); v.applyMatrix4(m.matrixWorld); if (v.y < sole) sole = v.y;
        const [lx, lz] = loc(v); if (Math.abs(lx - hl[0]) < 0.15 && lz < front - 0.01 && lz > hl[1] - 0.15 && v.y > seatH - 0.15 && v.y < under) under = v.y; } });
    const ang = (a, b, c) => { const u = a.clone().sub(b).normalize(), w = c.clone().sub(b).normalize(); return Math.round(Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * 180 / Math.PI); };
    const th = B.LeftLeg.clone().sub(B.LeftUpLeg); const thigh = Math.round(Math.abs(Math.atan2(th.y, Math.hypot(th.x, th.z))) * 180 / Math.PI);
    return { under: +(under - seatH).toFixed(3), pelvis: +(B.Hips.y - seatH).toFixed(3), hipsLocal: hl.map((x) => +x.toFixed(3)), knee: [ang(B.LeftUpLeg, B.LeftLeg, B.LeftFoot), ang(B.RightUpLeg, B.RightLeg, B.RightFoot)], thigh, sole: +sole.toFixed(3), kneeY: +Math.min(B.LeftLeg.y, B.RightLeg.y).toFixed(3) }; };
});
async function waitMode(mode, ms = 60000) { try { await p.waitForFunction((m) => window.__world.chars[window.game.s.activeChar].mode === m, mode, { timeout: ms, polling: 100 }); return true; } catch { return false; } }
const clickVue = () => p.evaluate(() => { const b = [...document.querySelectorAll('.hud-top button')].find((x) => /Vue/.test(x.textContent)); b?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

if (!SEATS_ONLY) {
  // ---------- A. full screen (mauve band bug) ----------
  const cov = () => p.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return { canvas: [Math.round(c.width), Math.round(c.height)], stage: [Math.round(s.width), Math.round(s.height)], vp: [innerWidth, innerHeight], appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h') }; });
  let c0 = await cov(); ok(c0.canvas[0] === c0.vp[0] && c0.canvas[1] === c0.vp[1], 'A1 canvas fills the whole screen at load', c0);
  await p.setViewportSize({ width: dev.w, height: Math.round(dev.h * 0.85) }); await p.waitForTimeout(1500);
  await p.setViewportSize({ width: dev.w, height: dev.h }); await p.waitForTimeout(2000);
  c0 = await cov(); ok(c0.canvas[1] === dev.h && c0.stage[1] === dev.h, 'A2 browser bars shrink then grow back (−15 % height): the game fills the screen again (no band)', c0);
  await p.setViewportSize({ width: dev.h, height: dev.w }); await p.waitForTimeout(1500); await p.setViewportSize({ width: dev.w, height: dev.h }); await p.waitForTimeout(2500);
  c0 = await cov(); ok(c0.canvas[1] === dev.h && c0.canvas[0] === dev.w, 'A3 rotation round-trip: the game fills the screen', c0);

  // ---------- B. camera stays on the room ----------
  const f0 = await p.evaluate(() => window.__frame()); console.log('   frame at load', JSON.stringify(f0));
  for (let k = 0; k < 3; k++) { await drag(dev.w * 0.6, dev.h * 0.25, dev.w * 0.2, dev.h * 0.97); await p.waitForTimeout(300); }
  await p.waitForTimeout(800); let f1 = await p.evaluate(() => window.__frame());
  ok(f1.roomPct >= 60, 'B1 three big one-finger pans: the room still covers ≥ 60 % of the screen (before: 0 %)', f1);
  await p.screenshot({ path: `${SHOTS}/${devName}_B_after_pan.png` });
  await p.waitForTimeout(4500); const avOn = await p.evaluate(() => window.__metrics()[window.game.s.activeChar]);
  ok(avOn && avOn.bboxPx[2] > 0 && avOn.bboxPx[0] < dev.w && avOn.bboxPx[3] > 0 && avOn.bboxPx[1] < dev.h, 'B2 the avatar is on screen after the pan', avOn);
  await clickVue(); await p.waitForTimeout(2500);
  for (let k = 0; k < 3; k++) { await drag(dev.w * 0.55, dev.h * 0.3, dev.w * 0.05, dev.h * 0.95); await p.waitForTimeout(300); }
  await p.waitForTimeout(800); f1 = await p.evaluate(() => window.__frame());
  ok(f1.roomPct >= 70, 'B3 Vue perso + big pans: the room still covers ≥ 70 % of the screen (before: 0 %)', f1);
  await p.screenshot({ path: `${SHOTS}/${devName}_B_perso_pan.png` });
  await clickVue(); await p.waitForTimeout(2500);
  let worst = 100; for (const [x, z] of [[1.9, 4.6], [6.4, 1.3], [5.4, 5.0], [5.3, 0.9]]) { await p.evaluate(([x, z]) => { const c = window.__world.chars[window.game.s.activeChar]; c.pos.set(x, 0, z); c.path = []; window.dispatchEvent(new Event('yw:follow')); }, [x, z]); await p.waitForTimeout(4000); worst = Math.min(worst, (await p.evaluate(() => window.__frame())).roomPct); }
  ok(worst >= 65, 'B4 avatar in the 4 corners of the room: the room always covers ≥ 65 % of the screen (before: 55-62 %)', { worst });

  // ---------- C. social: Mode local + compact chat ----------
  const chip = await p.evaluate(() => { const c = document.querySelector('.chip.net'); const r = c.getBoundingClientRect(); return { text: c.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  ok(/Mode local/.test(chip.text) && !/en ligne/i.test(chip.text), 'C1 top bar says "Mode local" (offline prototype), never "en ligne"', chip.text);
  await tap(chip.x, chip.y); await p.waitForTimeout(700);
  const pop = await p.evaluate(() => document.querySelector('.net-pop')?.textContent ?? null);
  ok(!!pop && /aucun autre joueur/.test(pop), 'C2 tapping it explains: prototype hors ligne, aucun autre joueur', pop);
  const tags = await p.evaluate(() => [...document.querySelectorAll('.nametag')].map((n) => n.textContent));
  ok(tags.filter((t) => /PNJ/.test(t)).length === 1, 'C3 the companion avatar is tagged PNJ (local test character), the player is not', tags);
  await tap(chip.x, chip.y); await p.waitForTimeout(400);
  const chatBtn = await p.evaluate(() => { const b = [...document.querySelectorAll('.dock button')].find((x) => /Chat/.test(x.textContent)); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await tap(...chatBtn); await p.waitForTimeout(1200);
  const chat = await p.evaluate(() => { const s = document.querySelector('.chat-sheet'); if (!s) return null; const r = s.getBoundingClientRect(); return { area: +(100 * r.width * r.height / (innerWidth * innerHeight)).toFixed(1), rect: [r.x, r.y, r.right, r.bottom].map(Math.round), mode: s.querySelector('.chat-mode')?.textContent, scope: s.querySelector('.chat-scope')?.textContent }; });
  ok(!!chat && /Mode local/.test(chat.mode) && /seuls tes avatars/.test(chat.scope), 'C4 chat panel says Mode local · hors ligne + who can read messages', chat && { mode: chat.mode });
  if (dev.h < 500) ok(chat && chat.area <= 22, 'C5 landscape phone: the chat is a compact corner card (≤ 22 % of the screen)', chat);
  const avs = await p.evaluate(() => { const m = window.__metrics(); return ['f', 'm'].map((k) => m[k]?.bboxPx); });
  const covered = (bb) => { if (!bb || !chat) return 0; const ix = Math.max(0, Math.min(bb[2], chat.rect[2]) - Math.max(bb[0], chat.rect[0])), iy = Math.max(0, Math.min(bb[3], chat.rect[3]) - Math.max(bb[1], chat.rect[1])); return ix * iy / ((bb[2] - bb[0]) * (bb[3] - bb[1])); };
  ok(Math.max(...avs.map(covered)) < 0.5, 'C6 the chat does not hide the avatars (< 50 % of either avatar covered)', avs.map((x) => +covered(x).toFixed(2)));
  await p.screenshot({ path: `${SHOTS}/${devName}_C_chat.png` });
  await p.evaluate(() => window.game.setPanel(null)); await p.waitForTimeout(500);
}

// ---------- D. seats & bed (anchors) ----------
await p.evaluate(() => { const g = window.game; const apt = g.s.apartment; g['setLayout']({ ...apt, items: [...apt.items, { uid: 't_stool', defId: 'stoolBar', x: 10, z: 12, rot: 0 }, { uid: 't_desk', defId: 'chairDesk', x: 14, z: 12, rot: 2 }] }, 'place', {}); });
await p.waitForTimeout(1500);
/** local z of the front edge of each seat surface (tools/seat_heights.py profiles) */
const SEAT_FRONT = { loungeSofa: 0.246, loungeChair: 0.246, chair: 0.12, chairDesk: 0.189, stoolBar: 0.138, bedDouble: 0.675 };
const hasLie = await p.evaluate(() => !!window.game.cat.bedDouble.seat?.lie);
fs.mkdirSync(`${SHOTS}/seats`, { recursive: true });
for (const [def, act] of [['loungeSofa', 'sit'], ['loungeChair', 'sit'], ['chair', 'sit'], ['stoolBar', 'sit'], ['chairDesk', 'sit'], ['bedDouble', 'sit'], ['bedDouble', 'lie']]) {
  if (act === 'lie' && !hasLie) { console.log('SKIP lie (build without lying)'); continue; }
  const r = await p.evaluate(([def, act]) => { const g = window.game; const it = g.s.apartment.items.find((i) => i.defId === def); const c = window.__world.chars[g.s.activeChar];
    c.pos.set(3.3, 0, 2.9); c.mode = 'idle'; c.path = []; c.sitOn = undefined; c.pendingSeat = undefined; g.interact(it.uid, act); window.dispatchEvent(new Event('yw:follow'));
    const s = c.pendingSeat; return s ? { uid: it.uid, yaw: s.yaw, seatH: g.cat[def].seat?.h ?? null } : null; }, [def, act]);
  if (!r) { ok(false, `D ${def} ${act}: no free seat`); continue; }
  const sat = await waitMode('sitting'); await p.waitForTimeout(act === 'lie' ? 2500 : 3500);
  console.log('   ', def, act, JSON.stringify(await p.evaluate(() => { const c = window.__world.chars[window.game.s.activeChar]; return { mode: c.mode, pos: c.pos.toArray().map((v) => +v.toFixed(2)), seat: c.sitOn?.id }; })));
  const body = await p.evaluate(() => window.__body(window.game.s.activeChar));
  const center = await p.evaluate((uid) => window.__itemPoints().find((x) => x.uid === uid), r.uid);
  const seatH = r.seatH ?? { loungeChair: 0.276, loungeSofa: 0.276, chair: 0.288, stoolBar: 0.522, chairDesk: 0.28, bedDouble: 0.3 }[def];
  if (act === 'sit') {
    // real seated pose (procedural layer on the skeleton): measured on the exact skinned vertices + bones
    const q = await p.evaluate(([id, uid, yaw, seatH, front]) => window.__seatPose(id, uid, yaw, seatH, front), [await p.evaluate(() => window.game.s.activeChar), r.uid, r.yaw, seatH, SEAT_FRONT[def]]);
    ok(sat && q.under >= -0.025 && q.under <= 0.02, `D ${def} sit: body rests ON the seat (lowest point over the cushion ${seatH} m: −2.5/+2 cm)`, { under: q.under, pelvisAboveSeat: q.pelvis });
    ok(q.hipsLocal[1] <= SEAT_FRONT[def] && q.hipsLocal[1] >= -center.d / 2 && Math.abs(q.hipsLocal[0]) <= center.w / 2, `D ${def} sit: pelvis is over the seat, not in front of it`, { hipsLocal: q.hipsLocal, front: SEAT_FRONT[def] });
    ok(q.knee[0] >= 70 && q.knee[0] <= 120 && q.knee[1] >= 70 && q.knee[1] <= 120, `D ${def} sit: knees really bent (70–120°, standing ≈ 170°)`, { knee: q.knee });
    ok(q.thigh <= 25, `D ${def} sit: thighs about horizontal (≤ 25° from horizontal)`, { thighDeg: q.thigh });
    ok(q.sole > 0.005 && q.sole < q.kneeY - 0.05, `D ${def} sit: feet hang below the knees, never through the floor`, { soleY: q.sole, kneeY: q.kneeY });
  } else {
    ok(sat && body.lo >= seatH - 0.015 && body.lo <= seatH + 0.05, 'D bed lie: lying ON the mattress (lowest body point within −1.5/+5 cm of the mattress top)', { lowest: +body.lo.toFixed(3), mattress: seatH });
    const towardsBoard = ((body.head[0] - body.hips[0]) * Math.sin(r.yaw) + (body.head[2] - body.hips[2]) * Math.cos(r.yaw)) < 0;
    ok(towardsBoard && body.pitch < -1.0, 'D bed lie: on the back, head towards the headboard', { pitch: +body.pitch.toFixed(2) });
    const lp = await p.evaluate(() => { const o = window.__avatarObj(window.game.s.activeChar); o.updateWorldMatrix(true, true); const B = {}; o.traverse((m) => { if (m.isBone && !B[m.name]) B[m.name] = m.getWorldPosition(new window.__cam.position.constructor()); });
      const ang = (a, b, c) => { const u = a.clone().sub(b).normalize(), w = c.clone().sub(b).normalize(); return Math.round(Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * 180 / Math.PI); };
      const bag = o.getObjectByName('acc_backpack'); return { knee: [ang(B.LeftUpLeg, B.LeftLeg, B.LeftFoot), ang(B.RightUpLeg, B.RightLeg, B.RightFoot)], bagVisible: bag ? bag.visible : null }; });
    ok(lp.knee[0] >= 150 && lp.knee[1] >= 150 && lp.bagVisible !== true, 'D bed lie: legs stretched out (knees ≥ 150°), backpack put aside while lying', lp);
  }
  const [sx, sy] = await p.evaluate((c) => window.__scr(c.x, 0.35, c.z), center); const cw = Math.min(dev.w, 320), ch = Math.min(dev.h, 240);
  await p.screenshot({ path: `${SHOTS}/seats/${devName}_${def}_${act}.png`, clip: { x: Math.max(0, Math.min(dev.w - cw, sx - cw / 2)), y: Math.max(0, Math.min(dev.h - ch, sy - ch * 0.6)), width: cw, height: ch } });
  if (act === 'lie') {
    await p.evaluate(() => window.game.walkTo(new window.__cam.position.constructor(3.3, 0, 3.2)));
    await p.waitForFunction(() => { const c = window.__world.chars[window.game.s.activeChar]; return c.mode !== 'sitting' && c.mode !== 'standing'; }, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(800); const up = await p.evaluate(() => ({ b: window.__body(window.game.s.activeChar), y: window.__world.chars[window.game.s.activeChar].pos.y, mode: window.__world.chars[window.game.s.activeChar].mode }));
    ok(Math.abs(up.b.pitch) < 0.01 && up.y === 0, 'D bed: getting up -> upright and back on the floor', { pitch: up.b.pitch, y: up.y, mode: up.mode });
  }
}
if (!SEATS_ONLY) {
  // ---------- E. watch TV + real tap on the bed menu ----------
  const tv = await p.evaluate(() => { const g = window.game; const it = g.s.apartment.items.find((i) => g.cat[i.defId].interaction === 'tv'); const c = window.__world.chars[g.s.activeChar]; c.pos.set(3.3, 0, 2.9); c.mode = 'idle'; c.path = []; c.sitOn = undefined;
    if (it.on) g.interact(it.uid, 'toggle'); g.interact(it.uid, 'watch'); return { uid: it.uid, seat: c.pendingSeat?.id ?? null }; });
  const satTv = tv.seat ? await waitMode('sitting') : false; await p.waitForTimeout(1500);
  const tvState = await p.evaluate((uid) => { const g = window.game; const it = g.s.apartment.items.find((i) => i.uid === uid); const c = window.__world.chars[g.s.activeChar]; const s = c.sitOn; const t = window.__itemPoints().find((q) => q.uid === uid);
    const dx = t.x - c.pos.x, dz = t.z - c.pos.z, d = Math.hypot(dx, dz); return { on: !!it.on, seat: s?.id, facing: s ? +((Math.sin(s.yaw) * dx + Math.cos(s.yaw) * dz) / d).toFixed(2) : null }; }, tv.uid);
  ok(tvState.on && satTv && tvState.facing > 0.6, 'E1 "Regarder la télé": TV switched on, avatar sits on a seat facing it', tvState);
  await p.screenshot({ path: `${SHOTS}/${devName}_E_watch_tv.png` });
  await p.evaluate(() => window.game.walkTo(new window.__cam.position.constructor(3.0, 0, 3.6))); await waitMode('idle', 30000);
  await p.evaluate(() => window.dispatchEvent(new Event('yw:follow'))); await p.waitForTimeout(3000);
  const bed = await p.evaluate(() => { const q = window.__itemPoints().find((x) => x.defId === 'bedDouble'); return window.__scr(q.x, 0.3, q.z); });
  await tap(bed[0], bed[1]); await p.waitForTimeout(1200);
  const menu = await p.evaluate(() => [...document.querySelectorAll('.imenu .btn')].map((b) => b.textContent));
  ok(menu.some((t) => /allonger/.test(t)) && menu.some((t) => /asseoir/.test(t)), 'E2 real tap on the bed opens its menu with S’allonger + S’asseoir', menu);
  const lieBtn = await p.evaluate(() => { const b = [...document.querySelectorAll('.imenu .btn')].find((x) => /allonger/.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  if (lieBtn) { await tap(...lieBtn); const lay = await waitMode('sitting'); await p.waitForTimeout(2500); const bd = await p.evaluate(() => window.__body(window.game.s.activeChar)); ok(lay && bd.pitch < -1.0, 'E3 tapping S’allonger: the avatar walks to the bed and lies down', { pitch: +bd.pitch.toFixed(2) }); await p.screenshot({ path: `${SHOTS}/${devName}_E_lie.png` }); }
}
const fails = results.filter((r) => !r.ok);
console.log(`SUMMARY ${devName}: ${results.length - fails.length}/${results.length} pass` + (errs.length ? ` · page errors: ${errs.slice(0, 3).join(' | ')}` : ' · no page errors'));
fs.writeFileSync(`${SHOTS}/${devName}_results.json`, JSON.stringify({ dev: devName, url, results, errs }, null, 2));
await b.close();
