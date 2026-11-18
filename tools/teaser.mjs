import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
import fs from 'fs';
/**
 * Gameplay teaser recorder: drives the real game (no mock-up) in virtual time so the clip is smooth even
 * though headless rendering is slow. performance.now + requestAnimationFrame are virtualised; each frame is
 * stepped 1/FPS s, then captured over CDP. Frames -> /tmp/teaser/frames, assembled by tools/teaser.sh.
 */
const FPS = 24, W = 1280, H = 720, port = process.env.PORT ?? '5210';
const dir = '/tmp/teaser/frames'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.addInitScript(() => {
  let vt = 0, virt = false; const rp = performance.now.bind(performance); const rr = window.requestAnimationFrame.bind(window); let cbs = [];
  performance.now = () => (virt ? vt : rp());
  window.requestAnimationFrame = (cb) => { if (!virt) return rr(cb); cbs.push(cb); return 1e6 + cbs.length; };
  const rc = window.cancelAnimationFrame.bind(window); window.cancelAnimationFrame = (id) => { if (id < 1e6) rc(id); };
  window.__virt = () => { vt = rp(); virt = true; };
  window.__step = (ms) => { vt += ms; const c = cbs; cbs = []; c.forEach((f) => f(vt)); };
});
await p.goto(`http://localhost:${port}/?fresh`, { timeout: 120000 });
await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(5000);
await p.evaluate(() => {
  const W = window.__world, g = window.game; window.__T = 0;
  for (const c of Object.values(W.chars)) { c.say = undefined; }
  const put = (id, x, z, yaw) => { const c = W.chars[id]; c.pos.set(x, 0, z); c.yaw = yaw; c.path = []; c.mode = 'idle'; c.sitOn = undefined; c.pendingSeat = undefined; c.emote = false; };
  const say = (id, text, s) => { W.chars[id].say = { text, until: performance.now() + s * 1000 }; };
  const as = (id, fn) => { const a = g.s.activeChar; g.setActive(id); fn(); g.setActive(a); };
  const zoomTo = { from: 0, to: 0, t0: 0, t1: 0 };
  window.__zoom = zoomTo;
  // timeline (seconds)
  window.__cues = [
    [0.0, () => { put('f', 2.9, 3.3, 0.6); put('m', 3.5, 3.6, 0.6); g.walkTo(new window.__V(5.3, 0, 1.0)); as('m', () => g.walkTo(new window.__V(5.8, 0, 1.3))); say('f', 'On va à la plage ? 🏖️', 1.8); }],
    [1.5, () => g.setPanel('places')],
    [2.3, () => g.store.set({ transition: { to: 'beach', at: performance.now() } })],
    [2.75, () => { g.travel('beach'); put('f', 10.2, 1.35, -1.4); put('m', 10.7, 1.65, -1.4); W.chars.f.say = undefined; }],
    [2.95, () => { window.__cam.zoom *= 1.22; window.__cam.updateProjectionMatrix(); }],
    [3.0, () => { g.interactProp('bench2', 'sit'); as('m', () => g.interactProp('bench2', 'sit')); }],
    [3.25, () => g.store.set({ transition: null })],
    [4.2, () => say('m', 'Trop beau ici ! 🌴', 2.2)],
    [7.6, () => say('f', 'On danse ? 🎶', 1.4)],
    [8.6, () => { g.interactProp('dj', 'dance'); W.chars.f.running = true; as('m', () => g.interactProp('dj', 'dance')); W.chars.m.running = true; }],
    [10.6, () => g.setMood('sunset')],
    [12.8, () => say('m', 'DJ, encore ! 🎶', 2.4)],
    [12.8, () => { const c = window.__cam; Object.assign(zoomTo, { from: c.zoom, to: c.zoom * 1.18, t0: 12.8, t1: 15.4 }); }],
  ];
});
await p.evaluate(() => { window.__V = class { constructor(x, y, z) { const v = window.__world.chars.f.pos.clone(); v.set(x, y, z); return v; } }; window.__virt(); });
const cdp = await ctx.newCDPSession(p);
const DUR = Number(process.env.DUR ?? 15.4); const N = Math.round(DUR * FPS); const t0 = Date.now();
for (let i = 0; i < N; i++) {
  await p.evaluate(({ t, dt }) => {
    while (window.__cues.length && window.__cues[0][0] <= t + 1e-6) window.__cues.shift()[1]();
    const z = window.__zoom; if (z.t1 && t >= z.t0) { const k = Math.min(1, (t - z.t0) / (z.t1 - z.t0)); const e = k * k * (3 - 2 * k); window.__cam.zoom = z.from + (z.to - z.from) * e; window.__cam.updateProjectionMatrix(); }
    window.__step(dt);
  }, { t: i / FPS, dt: 1000 / FPS });
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  fs.writeFileSync(`${dir}/f${String(i).padStart(4, '0')}.jpg`, Buffer.from(r.data, 'base64'));
  if (i % 48 === 0) console.log('frame', i, '/', N, Math.round((Date.now() - t0) / 1000) + 's');
}
console.log('done', N, 'frames; errors:', errs.slice(0, 5).join(' | ') || 'none');
await b.close();
