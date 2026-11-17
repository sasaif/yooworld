import { chromium } from 'playwright-core';
// usage: node tools/shot.mjs overview,close,walk [outdir]
const modes = (process.argv[2] ?? 'overview').split(',');
const out = process.argv[3] ?? '../shots';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const m of modes) {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = []; p.on('console', (x) => { if (x.type() === 'error' || x.type() === 'warning') logs.push(x.text().slice(0, 200)); }); p.on('response', (r) => { if (r.status() >= 400) logs.push('HTTP' + r.status() + ' ' + r.url()); }); p.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
  const url = m === 'ui' ? 'http://localhost:5201/' : 'http://localhost:5201/?shot=' + m;
  await p.goto(url, { timeout: 120000 });
  if (m === 'ui') await p.waitForTimeout(15000); else { try { await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }); } catch { console.log('TIMEOUT', m); } }
  await p.screenshot({ path: `${out}/${m}.png` }); console.log('shot', m, logs.slice(0, 6).join(' | ')); await p.close();
}
await b.close();
