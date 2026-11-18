import { chromium } from 'playwright-core';
// node tools/fashion/shoot.mjs <device:phone|desktop> <script-module> [base]
const dev = process.argv[2] ?? 'phone'; const script = process.argv[3]; const base = process.env.BASE ?? 'http://127.0.0.1:5217/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(dev === 'phone' ? { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage(); const logs = [];
p.on('console', (x) => { if (x.type() === 'error') logs.push(x.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
p.on('response', (r) => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`); });
const fn = (await import(script)).default; try { await fn(p, { base, dev, shot: async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `shots/fashion/${name}_${dev}.png` }); console.log('shot', name); } }); } catch (e) { console.log('FAIL', e.message.split('\n').slice(0, 6).join(' / ')); await p.screenshot({ path: `shots/fashion/zz_fail_${dev}.png` }); }
console.log('ERRORS', JSON.stringify(logs.slice(0, 20)));
await b.close();
