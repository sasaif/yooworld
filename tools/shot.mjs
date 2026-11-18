import { chromium } from 'playwright-core';
// usage: node tools/shot.mjs mode[@mobile][,mode2...] [outdir]   (dev server on :5202)
//   mode = overview|close|walk|sit|mobile|ui ; '@mobile' = 390x844 touch viewport
const jobs = (process.argv[2] ?? 'overview').split(',');
const out = process.argv[3] ?? '/workspace/yooville/yooworld/shots';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const job of jobs) {
  const [m, dev] = job.split('@'); const mobile = dev === 'mobile';
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const logs = []; p.on('console', (x) => { if (x.type() === 'error' || x.type() === 'warning') logs.push(x.text().slice(0, 200)); }); p.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
  const extra = process.env.EXTRA ?? '';
  const url = `http://localhost:5202/?shot=${m}&${extra}`;
  await p.goto(url, { timeout: 120000 });
  try { await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }); } catch { console.log('TIMEOUT', m); }
  if (process.env.ACT) { const fn = (await import(process.env.ACT)).default; await fn(p); }
  const name = (process.env.NAME ?? m) + (mobile ? '_mobile' : '');
  await p.screenshot({ path: `${out}/${name}.png` });
  const info = await p.evaluate(() => window.__info ?? null);
  console.log('shot', name, info ? JSON.stringify(info) : '', logs.slice(0, 6).join(' | ')); await ctx.close();
}
await b.close();
