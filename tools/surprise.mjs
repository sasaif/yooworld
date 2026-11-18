import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
import fs from 'fs';
// Yoo Plage screenshots: node tools/surprise.mjs [scene,...]  (dev server on $PORT, default 5210) -> shots/surprise/
const port = process.env.PORT ?? '5210'; const out = 'shots/surprise';
const DEV = {
  iphone15_landscape: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const HELP = `
  const W = window.__world, g = window.game;
  window.sitAt = (id, prop) => { const c = W.chars[id]; const s = W.seats.filter((x) => x.id.startsWith(prop + ':')).find((x) => !Object.values(W.chars).some((o) => o.id !== id && (o.pendingSeat ?? o.sitOn)?.id === x.id)); c.mode = 'idle'; c.sitOn = undefined; c.pos.copy(s.front); c.path = [s.front.clone()]; c.pendingSeat = s; };
  window.put = (id, x, z, yaw) => { const c = W.chars[id]; c.pos.set(x, 0, z); c.yaw = yaw; c.path = []; c.mode = 'idle'; c.sitOn = undefined; c.pendingSeat = undefined; };
  window.zoomBy = (k) => { const cam = window.__cam; cam.zoom *= k; cam.updateProjectionMatrix(); };`;
const SCENES = {
  overview: `g.travel('beach'); put('f', 9.3, 2.6, 0.5); put('m', 10.0, 2.9, -0.6); g.sendChat('Bienvenue à Yoo Plage ! 🏖️'); setTimeout(() => zoomBy(0.72), 300);`,
  sit_bench: `g.travel('beach'); sitAt('f', 'bench2'); sitAt('m', 'bench2'); setTimeout(() => { W.chars.m.say = { text: 'Quelle vue ! 🌊', until: performance.now() + 1e9 }; zoomBy(1.25); }, 300);`,
  sit_towels: `g.travel('beach'); sitAt('f', 'lounger1'); sitAt('m', 'lounger2'); setTimeout(() => { W.chars.f.say = { text: 'Bronzette 😎', until: performance.now() + 1e9 }; zoomBy(1.2); }, 300);`,
  dance: `g.travel('beach'); g.interactProp('dj', 'music'); put('f', 13.2, 4.0, 0.7); put('m', 13.9, 3.7, 0.1); W.chars.f.emote = true; W.chars.m.emote = true; setTimeout(() => { W.chars.m.say = { text: 'DJ, encore ! 🎶', until: performance.now() + 1e9 }; zoomBy(1.15); }, 300);`,
  sunset: `g.travel('beach'); g.setMood('sunset'); g.interactProp('dj', 'music'); sitAt('f', 'chair1a'); sitAt('m', 'chair1b'); setTimeout(() => { W.chars.f.say = { text: 'Le coucher de soleil… 🌅', until: performance.now() + 1e9 }; zoomBy(0.8); }, 300);`,
  sunset_dance: `g.travel('beach'); g.setMood('sunset'); g.interactProp('dj', 'music'); put('f', 13.2, 4.0, 0.7); put('m', 13.9, 3.7, 0.1); W.chars.f.emote = true; W.chars.m.emote = true; setTimeout(() => zoomBy(0.9), 300);`,
  places: `g.setPanel('places');`,
  home: ``,
};
const only = (process.argv[2] ?? Object.keys(SCENES).join(',')).split(',');
const devs = (process.env.DEVS ?? Object.keys(DEV).join(',')).split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = fs.existsSync(`${out}/metrics.json`) ? JSON.parse(fs.readFileSync(`${out}/metrics.json`, 'utf8')) : {};
for (const scene of only) for (const d of devs) {
  const ctx = await b.newContext(DEV[d]); const p = await ctx.newPage(); const errs = [], bad = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await p.goto(`http://localhost:${port}/?fresh`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(2500);
  await p.evaluate(HELP + SCENES[scene]);
  await p.waitForTimeout(Number(process.env.WAIT ?? 9000));
  const name = `${scene}_${d}`; await p.screenshot({ path: `${out}/${name}.png` });
  const m = await p.evaluate(() => ({ info: window.__info, metrics: window.__metrics?.(), location: window.game.s.location, mood: window.game.s.mood }));
  report[name] = { ...m, errors: errs.slice(0, 5), http4xx: bad.slice(0, 5) }; console.log(name, JSON.stringify(m.info), errs.length ? 'ERR ' + errs.join(' | ') : '', bad.join(' '));
  await ctx.close();
}
fs.writeFileSync(`${out}/metrics.json`, JSON.stringify(report, null, 2));
await b.close();
