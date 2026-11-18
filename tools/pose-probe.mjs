import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)('playwright-core');
// Seat pose probe: sits the player on each seat type, dumps leg bone world positions + angles and renders close-ups
// from the game camera and from the side (extra camera, same renderer). usage: node tools/pose-probe.mjs [url] [outDir]
const url = process.argv[2] ?? 'http://127.0.0.1:5243/'; const OUT = process.argv[3] ?? '/tmp/pp'; fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY?.split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { sessionStorage.setItem('yw.portrait', '1'); localStorage.setItem('yw.camView', 'room'); } catch { /* */ } });
const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(url + '?fresh=1&lieu=appart'); await p.waitForFunction(() => window.game?.s.ready && window.__gl, null, { timeout: 180000 }); await p.waitForTimeout(3000);
await p.evaluate(() => {
  const g = window.game; const apt = g.s.apartment;
  g['setLayout']({ ...apt, items: [...apt.items, { uid: 't_stool', defId: 'stoolBar', x: 10, z: 12, rot: 0 }, { uid: 't_desk', defId: 'chairDesk', x: 14, z: 12, rot: 2 }] }, 'place', {});
  const V = window.__cam.position.constructor; const scene = () => { let s = window.__cam.parent; while (s.parent) s = s.parent; return s; };
  window.__scene = scene;
  window.__bones = (id) => { let o = null; scene().traverse((q) => { if (q.userData.avatarId === id) o = q; }); o.updateWorldMatrix(true, true); const r = {}; o.traverse((m) => { if (m.isBone && !r[m.name]) r[m.name] = m.getWorldPosition(new V()).toArray().map((v) => +v.toFixed(3)); }); return r; };
  /** world vertices of the visible avatar meshes (skinned: exact skinning; attachments: matrixWorld), every `step`-th */
  window.__verts = (id, step = 2) => { let o = null; scene().traverse((q) => { if (q.userData.avatarId === id) o = q; }); o.updateWorldMatrix(true, true); const out = []; const v = new V();
    o.traverse((m) => { if (!m.isMesh || /outline/.test(m.name)) return; let vis = true; for (let q = m; q; q = q.parent) if (!q.visible) { vis = false; break; } if (!vis) return;
      const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i += step) { if (m.isSkinnedMesh) m.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i); v.applyMatrix4(m.matrixWorld); out.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)); } });
    return out; };
  /** render the scene from an extra camera looking at (x,y,z) from direction (dx,dz), return PNG data url */
  window.__side = (x, y, z, dx, dz, half = 0.75) => { const C = window.__cam.constructor; const a = innerWidth / innerHeight; const cam = new C(-half * a, half * a, half, -half, 3 - 0.4, 3 + 0.6);
    cam.position.set(x + dx * 3, y + 0.25, z + dz * 3); cam.lookAt(x, y, z); cam.updateMatrixWorld(); const gl = window.__gl; gl.render(scene(), cam); return gl.domElement.toDataURL('image/png'); };
});
await p.waitForTimeout(1500);
const names = await p.evaluate(() => Object.keys(window.__bones(window.game.s.activeChar))); console.log('bones:', names.join(','));
const seats = [['stoolBar', 'sit'], ['chair', 'sit'], ['chairDesk', 'sit'], ['loungeSofa', 'sit'], ['loungeChair', 'sit'], ['bedDouble', 'sit'], ['bedDouble', 'lie']];
const report = {};
for (const [def, act] of seats) {
  if (ONLY && !ONLY.includes(def + '_' + act) && !ONLY.includes(def)) continue;
  const r = await p.evaluate(([def, act]) => { const g = window.game; const it = g.s.apartment.items.find((i) => i.defId === def); if (!it) return null; const c = window.__world.chars[g.s.activeChar];
    c.pos.set(3.3, 0, 2.9); c.mode = 'idle'; c.path = []; c.sitOn = undefined; c.pendingSeat = undefined; g.interact(it.uid, act); window.dispatchEvent(new Event('yw:follow'));
    const s = c.pendingSeat; return s ? { uid: it.uid, yaw: s.yaw } : null; }, [def, act]);
  if (!r) { console.log('no seat', def, act); continue; }
  await p.waitForFunction(() => window.__world.chars[window.game.s.activeChar].mode === 'sitting', null, { timeout: 60000 }).catch(() => console.log('timeout sit'));
  await p.waitForTimeout(3000);
  const bones = await p.evaluate(() => window.__bones(window.game.s.activeChar));
  const ctr = await p.evaluate((uid) => window.__itemPoints().find((x) => x.uid === uid), r.uid);
  report[def + '_' + act] = { yaw: r.yaw, bones, item: { x: ctr.x, z: ctr.z }, verts: await p.evaluate(() => window.__verts(window.game.s.activeChar)) };
  const h = bones.Hips ?? Object.values(bones)[0];
  // close-up from the game camera
  const [sx, sy] = await p.evaluate(([x, y, z]) => { const v = new window.__cam.position.constructor(x, y, z).project(window.__cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, h);
  await p.screenshot({ path: `${OUT}/${def}_${act}_game.png`, clip: { x: Math.max(0, Math.min(852 - 260, sx - 130)), y: Math.max(0, Math.min(393 - 220, sy - 120)), width: 260, height: 220 } });
  // side view: perpendicular to the seat facing direction
  const sideDir = [Math.cos(r.yaw), -Math.sin(r.yaw)];
  for (const [tag, d] of [['side', sideDir], ['front', [Math.sin(r.yaw), Math.cos(r.yaw)]]]) {
    const data = await p.evaluate(([x, y, z, dx, dz]) => window.__side(x, y, z, dx, dz, 0.5), [h[0], h[1] + 0.02, h[2], d[0], d[1]]);
    fs.writeFileSync(`${OUT}/${def}_${act}_${tag}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  console.log(def, act, 'item', JSON.stringify({ x: ctr.x, z: ctr.z }), 'yaw', r.yaw.toFixed(2));
}
fs.writeFileSync(`${OUT}/bones.json`, JSON.stringify(report, null, 1));
await b.close();
