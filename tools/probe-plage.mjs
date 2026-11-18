import { chromium } from 'playwright-core';
// Task A probe: how does the live /plage/ behave on phones, incl. a save left by / and /polish/ (same origin => shared localStorage)
const BASE = process.env.BASE ?? 'https://sasaif.github.io/yooworld/';
const PLAGE = process.env.PLAGE ?? BASE + 'plage/';
const out = process.argv[2] ?? 'shots/taskA';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const dev = {
  iphone_land: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  iphone_port: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  pixel_land: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  pixel_port: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
};
const scen = (process.env.SCEN ?? 'fresh,fromroot,frompolish').split(',');
for (const [dn, opts] of Object.entries(dev)) for (const sc of scen) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push('PAGE ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  const ready = () => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 150000 }).then(() => true, () => false);
  if (sc === 'fromroot' || sc === 'frompolish') {
    await p.goto(sc === 'fromroot' ? BASE : BASE + 'polish/'); await ready(); await p.waitForTimeout(2500);
    // simulate play: move the active avatar's furniture / edit save
    await p.evaluate(() => { try { const g = window.game; const a = g.s.apartment; g.store.set({ apartment: { ...a, wall: a.wall } }); g.persist?.(); } catch (e) { console.error('sim ' + e.message); } });
  }
  const keys0 = await p.evaluate(() => Object.keys(localStorage)).catch(() => []);
  await p.goto(PLAGE + (process.env.Q ?? '')); const ok = await ready(); await p.waitForTimeout(6000);
  const st = await p.evaluate(() => ({ loc: window.game?.s.location, rotate: !!document.querySelector('.rotate'), dock: [...document.querySelectorAll('.dock button')].map((x) => x.textContent), canvas: !!document.querySelector('canvas') })).catch((e) => ({ err: e.message }));
  await p.screenshot({ path: `${out}/${dn}_${sc}.png` });
  console.log(dn, sc, 'ready=' + ok, JSON.stringify(st), 'keys=' + keys0.join(','), errs.slice(0, 4).join(' | '));
  await ctx.close();
}
await b.close();
