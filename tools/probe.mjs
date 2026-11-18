import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// quick probe: node tools/probe.mjs <name> <js-to-eval-after-ready> [w h dpr mobile]
const [name, js = '', w = '1440', h = '900', dpr = '1', mob = ''] = process.argv.slice(2);
const port = process.env.PORT ?? '5210';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr, isMobile: !!mob, hasTouch: !!mob });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
await p.goto(`http://localhost:${port}/?fresh&${process.env.Q ?? ''}`, { timeout: 120000 });
await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
await p.waitForTimeout(3000);
if (js) await p.evaluate(js);
await p.waitForTimeout(Number(process.env.WAIT ?? 5000));
await p.screenshot({ path: `shots/surprise/${name}.png` });
const fps = await p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
console.log('fps', fps, JSON.stringify(await p.evaluate(() => ({ info: window.__info, m: window.__metrics?.() }))), errs.slice(0, 8).join('\n'));
await b.close();
