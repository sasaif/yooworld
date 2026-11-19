import { chromium } from 'playwright-core';
// V1/V2/V3 size+framing comparison: same apartment (fresh default save), same lighting, same iso angle, same spawn.
// usage: node tools/compare-v.mjs <baseUrl> <outdir>   env ONLY=device,... VARS=1,2,3 VIEWS=room,avatar
const url = process.argv[2] ?? 'http://localhost:5231/';
const out = process.argv[3] ?? 'shots/compare-v/raw';
const DEVICES = {
  iphone15_landscape: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pixel7_landscape: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ipad_landscape: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const only = process.env.ONLY?.split(','); const vars = (process.env.VARS ?? '1,2,3').split(','); const views = (process.env.VIEWS ?? 'room,avatar').split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const res = {};
for (const [dn, opts] of Object.entries(DEVICES)) for (const v of vars) for (const view of views) {
  if (only && !only.includes(dn)) continue;
  const ctx = await b.newContext(opts); await ctx.addInitScript((vw) => { try { localStorage.setItem('yw:e:dev:camView', vw); localStorage.setItem('yw:e:dev:placesSeen', '1'); } catch {} }, view);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await p.goto(`${url}?fresh&v=${v}`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
  await p.waitForTimeout(Number(process.env.WAIT ?? 9000));
  const name = `${dn}_v${v}_${view}`;
  await p.screenshot({ path: `${out}/${name}.png` });
  const m = await p.evaluate(() => window.__metrics?.() ?? null);
  // room-coverage probe: paint the background pure green, hide HUD / labels, count non-green pixels (tools/coverage.py)
  await p.addStyleTag({ content: '.stage{background:#00ff00 !important} .hud-top,.dock,.rotate,.tagwrap,.toast{display:none !important}' });
  await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${name}__probe.png` });
  res[name] = { device: dn, v: +v, view, zoom: m?.zoom, f: m?.f, m: m?.m, errors: errs.slice(0, 3) };
  console.log(name, JSON.stringify(res[name])); await ctx.close();
}
await b.close();
const fs = await import('fs'); const f = `${out}/metrics.json`; const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
fs.writeFileSync(f, JSON.stringify({ ...prev, ...res }, null, 2));
