import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)('playwright-core');
// Experience audit: screenshots + framing metrics (room % of screen, room visible %, avatar px) per device.
// usage: node tools/exp-audit.mjs <url> <outdir> ; ONLY=iphone15,desktop ; SCENES=appart,perso,plage
const url = process.argv[2] ?? 'http://127.0.0.1:5243/'; const out = process.argv[3] ?? 'shots/experience/before'; fs.mkdirSync(out, { recursive: true });
const DEV = {
  iphone15: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  pixel7: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const only = process.env.ONLY?.split(','); const scenes = (process.env.SCENES ?? 'appart,perso,plage').split(',');
const DPR = process.env.DPR ? Number(process.env.DPR) : null;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const res = {};
for (const [name, o] of Object.entries(DEV)) {
  if (only && !only.includes(name)) continue;
  for (const sc of scenes) {
    const ctx = await b.newContext({ ...o, deviceScaleFactor: DPR ?? o.deviceScaleFactor }); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await ctx.addInitScript((sc) => { try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', sc.includes('perso') ? 'avatar' : 'room'); } catch { /* */ } }, sc);
    const sep = url.includes('?') ? '&' : '?';
    await p.goto(url + sep + 'fresh=1' + (sc === 'plage' ? '&lieu=plage' : '&lieu=appart'), { timeout: 120000 });
    await p.waitForFunction(() => window.game?.s.ready && window.__cam, null, { timeout: 180000 });
    await p.waitForTimeout(Number(process.env.WAIT ?? 8000));
    const measure = () => p.evaluate((beach) => {
      const cam = window.__cam; const V = cam.position.constructor; const W = innerWidth, H = innerHeight;
      const room = beach ? null : { w: 7.2, d: 6.0, h: window.__wallH ?? 1.55 };
      const proj = (x, y, z) => { const v = new V(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
      const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
      const hull = (pts) => { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
        for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
        for (const q of P.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
      const clip = (poly, x0, y0, x1, y1) => { const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
        [(p) => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]], [(p) => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
        let o = poly; for (const [ins, X] of edges) { const i = o; o = []; for (let k = 0; k < i.length; k++) { const a = i[k], c = i[(k + 1) % i.length]; if (ins(c)) { if (!ins(a)) o.push(X(a, c)); o.push(c); } else if (ins(a)) o.push(X(a, c)); } if (!o.length) break; } return o; };
      let r = null;
      if (room) {
        const pts = [[0, 0, 0], [room.w, 0, 0], [0, 0, room.d], [room.w, 0, room.d], [0, room.h, 0], [room.w, room.h, 0], [0, room.h, room.d]].map(([x, y, z]) => proj(x, y, z));
        const hp = hull(pts); const A = area(hp); const inside = area(clip(hp, 0, 0, W, H));
        const xs = hp.map((q) => q[0]), ys = hp.map((q) => q[1]);
        r = { roomPctOfScreen: +(100 * inside / (W * H)).toFixed(1), roomVisiblePct: +(100 * inside / A).toFixed(1), bbox: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))] };
        const fl = [[0, 0, 0], [room.w, 0, 0], [room.w, 0, room.d], [0, 0, room.d]].map(([x, y, z]) => proj(x, y, z)); r.floorPctOfScreen = +(100 * area(clip(fl, 0, 0, W, H)) / (W * H)).toFixed(1);
      }
      const st = document.querySelector('.stage').getBoundingClientRect(); const cv = document.querySelector('canvas').getBoundingClientRect();
      const met = window.__metrics?.() ?? {}; const act = window.game.s.activeChar;
      return { vw: W, vh: H, stage: [Math.round(st.width), Math.round(st.height)], canvas: [Math.round(cv.width), Math.round(cv.height)], zoom: met.zoom, room: r, avatarPx: met[act]?.screenH, avatarVisible: met[act]?.fullyVisible, other: met[act === 'f' ? 'm' : 'f']?.screenH, calls: window.__info?.calls };
    }, sc === 'plage');
    let m;
    if (sc === 'roam' || sc === 'roamperso') {
      // avatar walks to the room corners (bed, kitchen, dining table, door): worst-case framing while following
      const spots = { bed: [1.9, 4.6], kitchen: [6.4, 1.3], table: [5.4, 5.0], door: [5.3, 0.9], tv: [1.2, 1.7] }; const per = {};
      for (const [k, [x, z]] of Object.entries(spots)) {
        await p.evaluate(([x, z]) => { const c = window.__world.chars[window.game.s.activeChar]; c.pos.set(x, 0, z); c.path = []; window.dispatchEvent(new Event('yw:follow')); }, [x, z]);
        await p.waitForTimeout(5000); const r = await measure(); per[k] = { room: r.room?.roomPctOfScreen, vis: r.room?.roomVisiblePct, av: r.avatarVisible };
        if (k === 'bed') await p.screenshot({ path: `${out}/${name}_${sc}_bed.png` });
      }
      // one-finger pan far away (touch) or mouse drag: does the camera leave the room?
      const W = o.viewport.width, H = o.viewport.height;
      if (o.hasTouch) { const cdp = await ctx.newCDPSession(p); const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
        for (let rep = 0; rep < 3; rep++) { await T('touchStart', W * 0.6, H * 0.25); for (let i = 1; i <= 8; i++) await T('touchMove', W * 0.6 - i * W * 0.05, H * 0.25 + i * H * 0.09); await T('touchEnd'); await p.waitForTimeout(400); } }
      else { for (let rep = 0; rep < 3; rep++) { await p.mouse.move(W * 0.6, H * 0.25); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(W * 0.6 - i * W * 0.05, H * 0.25 + i * H * 0.09); await p.mouse.up(); await p.waitForTimeout(400); } }
      await p.waitForTimeout(2500); const r = await measure(); per.afterPan = { room: r.room?.roomPctOfScreen, vis: r.room?.roomVisiblePct, av: r.avatarVisible };
      await p.screenshot({ path: `${out}/${name}_${sc}_pan.png` });
      const vals = Object.values(per).map((q) => q.room); m = { per, worstRoomPct: Math.min(...vals) };
    } else m = await measure();
    await p.screenshot({ path: `${out}/${name}_${sc}.png` });
    res[`${name}_${sc}`] = { ...m, errors: errs.slice(0, 3) }; console.log(name, sc, JSON.stringify(res[`${name}_${sc}`]));
    await ctx.close();
  }
}
await b.close(); fs.writeFileSync(`${out}/metrics.json`, JSON.stringify(res, null, 2));
