import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * Hair motion before / after capture on the real game at the DEFAULT camera (iPhone 15 landscape, 852x393, captured at
 * DPR 3), beach, deterministic virtual time: idle → walk → turn 90° (run) → stop. For each hairstyle (Juanita twin buns,
 * long hair) the same path is recorded with ?hairmotion=0 (current static hair) and ?hairmotion=1 (springs). Frames are a
 * crop of the default view centred on Juanita (no zoom). Writes FRAMES/<hair>_<0|1>/f####.jpg + meta.json (phase per frame).
 * usage: node tools/capture-hair-motion.mjs [url] ; FRAMES=dir
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5794/'; const FR = process.env.FRAMES ?? 'shots/hair-frames';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = 852, Hh = 393, SC = 3, CW = 250, CH = 200; const meta = {};
const SCRIPT = [['REPOS', 24, null], ['MARCHE', 84, [1, 0, false]], ['VIRAGE 90° (course)', 66, [0, 1, true]], ['ARRÊT → REPOS', 60, 'stop']];
// CASES=buns,long,long_cap,buns_cap,long_phones (default buns,long): hat / headphones cases equip acc.hat / acc.head2
const CASES = (process.env.CASES ?? 'buns,long').split(',');
const LOOK = { buns: {}, long: { hair: 'hair_long', hairColor: 'haircol_brown' }, long_cap: { hair: 'hair_long', hairColor: 'haircol_brown', 'acc.hat': 'acc_cap' },
  buns_cap: { 'acc.hat': 'acc_cap' }, long_phones: { hair: 'hair_long', hairColor: 'haircol_brown', 'acc.head2': 'acc_headphones' } };
for (const hair of CASES) for (const hm of [0, 1]) {
  const ctx = await b.newContext({ viewport: { width: W, height: Hh }, deviceScaleFactor: SC, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('yw.portrait', '1'); } catch { /* */ }
    let vt = 0, virt = false; const rp = performance.now.bind(performance); const rr = window.requestAnimationFrame.bind(window); let cbs = [];
    performance.now = () => (virt ? vt : rp()); window.requestAnimationFrame = (cb) => { if (!virt) return rr(cb); cbs.push(cb); return 1e6 + cbs.length; };
    const rc = window.cancelAnimationFrame.bind(window); window.cancelAnimationFrame = (id) => { if (id < 1e6) rc(id); };
    window.__virt = () => { vt = rp(); virt = true; }; window.__step = (ms) => { vt += ms; const c = cbs; cbs = []; c.forEach((f) => f(vt)); }; window.__steps = (n) => { for (let i = 0; i < n; i++) window.__step(1000 / 60); }; });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url + `?fresh=1&lieu=appart&hairmotion=${hm}`, { timeout: 120000 }); await p.waitForFunction(() => window.game?.s.ready && window.__hair, null, { timeout: 180000 }); await p.waitForTimeout(2500);
  await p.evaluate((sl) => { if (Object.keys(sl).length) { const L = window.fashion.s.looks; window.fashion.store.set({ looks: { ...L, f: { ...L.f, slots: { ...L.f.slots, ...sl } } } }); } }, LOOK[hair]);
  await p.evaluate(() => window.__virt()); await p.evaluate(() => window.game.travel('beach')); await p.evaluate(() => window.__steps(150));
  // same start for every run: clear spot, facing the camera's right
  await p.evaluate(() => { const c = window.__world.chars.f; c.path = []; c.mode = 'idle'; window.__start = { x: c.pos.x, z: c.pos.z }; });
  const dir = `${FR}/${hair}_${hm}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); let n = 0; const ph = [];
  const shot = async (label) => {
    const c = await p.evaluate(() => { const c = window.__world.chars.f; const v = new (window.__cam.position.constructor)(c.pos.x, 0.62, c.pos.z).project(window.__cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
    const x = Math.max(0, Math.min(W - CW, c[0] - CW / 2)), y = Math.max(0, Math.min(Hh - CH, c[1] - CH / 2));
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, clip: { x, y, width: CW, height: CH, scale: SC } }); fs.writeFileSync(`${dir}/f${String(n++).padStart(4, '0')}.jpg`, Buffer.from(r.data, 'base64'));
    const h = await p.evaluate(() => { const a = window.__hair().avatars.f; return a ? Math.max(0, ...a.chains.map((x) => x.deg)) : 0; }); ph.push([label, +h.toFixed(2)]);
  };
  for (const [label, frames, act] of SCRIPT) {
    if (Array.isArray(act)) await p.evaluate(([dx, dz, run]) => { const c = window.__world.chars.f; const V = window.__cam.position.constructor; const az = Math.atan2(dx, dz);
      for (let k = 0; k < 12; k++) { const a = az + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.3; if (window.game.walkTo(new V(c.pos.x + Math.sin(a) * 4, 0, c.pos.z + Math.cos(a) * 4), run)) return; } }, act);
    if (act === 'stop') await p.evaluate(() => { const c = window.__world.chars.f; c.path = c.path.slice(0, 1); });
    for (let f = 0; f < frames; f += 2) { await p.evaluate(() => window.__steps(2)); await shot(label); }
  }
  meta[`${hair}_${hm}`] = ph; console.log('captured', hair, hm, n, 'frames, errors', errs.length); await ctx.close();
}
let old = {}; try { old = JSON.parse(fs.readFileSync(`${FR}/meta.json`, 'utf8')); } catch { /* */ } fs.writeFileSync(`${FR}/meta.json`, JSON.stringify({ ...old, ...meta })); await b.close();
