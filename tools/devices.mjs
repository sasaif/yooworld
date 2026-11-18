import { chromium } from 'playwright-core';
// usage: node tools/devices.mjs <url> <outdir>   — captures the game on the reference phone/tablet/desktop viewports
const url = process.argv[2] ?? 'http://localhost:5202/';
const out = process.argv[3] ?? '/workspace/yooville/yooworld/shots/after';
export const DEVICES = [
  { name: 'iphone15_portrait', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'iphone15_landscape', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'pixel7_portrait', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  { name: 'pixel7_landscape', viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  { name: 'ipad_landscape', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'ipad_portrait', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];
const only = process.env.ONLY?.split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = {};
for (const d of DEVICES) {
  if (only && !only.includes(d.name)) continue;
  const { name, ...opts } = d;
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  if (process.env.SKIP_ROTATE) await p.addInitScript(() => sessionStorage.setItem('yw.portrait', '1'));
  const errs = []; const bad = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await p.goto(url, { timeout: 120000 });
  try { await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); } catch { console.log('TIMEOUT', name); }
  await p.waitForTimeout(Number(process.env.WAIT ?? 9000));
  if (process.env.BG_PROBE) { await p.addStyleTag({ content: '.stage{background:#00ff00 !important} .hud-top,.dock,.rotate,.tagwrap{display:none !important}' }); await p.waitForTimeout(400); }
  if (process.env.PANEL) { await p.evaluate((x) => window.game.setPanel(x), process.env.PANEL); await p.waitForTimeout(600); }
  await p.screenshot({ path: `${out}/${name}${process.env.PANEL ? '_' + process.env.PANEL : ''}${process.env.SKIP_ROTATE ? '_continue' : ''}.png` });
  const m = await p.evaluate(() => {
    const c = document.querySelector('canvas'); const r = c?.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    const cov = r ? (Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))) / (vw * vh) : 0;
    return { vw, vh, canvas: r && [Math.round(r.width), Math.round(r.height)], coverage: Math.round(cov * 1000) / 10, scrollH: document.documentElement.scrollHeight, metrics: window.__metrics?.() ?? null, info: window.__info ?? null };
  });
  results[name] = { ...m, errors: errs.slice(0, 5), http4xx: bad.slice(0, 5) };
  console.log(name, JSON.stringify(results[name]));
  await ctx.close();
}
await b.close();
import('fs').then((fs) => fs.writeFileSync(`${out}/metrics.json`, JSON.stringify(results, null, 2)));
