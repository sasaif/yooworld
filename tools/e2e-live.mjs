import { chromium } from 'playwright-core';
// Live checks: each URL loads (200), renders without console/page errors, right location; 🔍 toggle animates + persists.
const base = process.argv[2] ?? 'http://localhost:5231/';
const urls = (process.env.URLS ?? ',?v=2,?v=3,?lieu=plage,?lieu=appart').split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
for (const q of urls) {
  const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = [], bad = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  const r = await p.goto(base + q, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(6000);
  const st = await p.evaluate(() => ({ loc: window.game.s.location, m: window.__metrics?.() }));
  const slug = q.replace(/[^a-z0-9]+/gi, '_') || 'default';
  await p.screenshot({ path: `shots/compare-v/live/${slug}.png` });
  ok(r.status() === 200, `${q || '(default)'} HTTP ${r.status()} · lieu=${st.loc} · zoom=${st.m?.zoom} · avatar ${st.m?.f?.screenH}px`);
  ok(errs.length === 0 && bad.length === 0, `${q || '(default)'} no console/HTTP errors ${errs.concat(bad).join(' | ')}`);
  if (q === '?v=2') {
    const z0 = st.m.zoom; await p.locator('.chip.cam').tap();
    const samples = []; for (let i = 0; i < 30; i++) { samples.push(await p.evaluate(() => window.__cam.zoom)); await p.waitForTimeout(80); }
    await p.waitForTimeout(1500); const z1 = await p.evaluate(() => window.__cam.zoom);
    const mids = samples.filter((z) => z > z0 + 1 && z < z1 - 1);
    ok(mids.length >= 2 && z1 > z0 * 1.5, `🔍 Vue perso: smooth zoom ${z0} → [${mids.slice(0, 4).map((z) => z.toFixed(0)).join(', ')}…] → ${z1.toFixed(1)}`);
    // the pref key depends on the build env (prod yw.camView, else yw:e:<env>:camView)
    const camKey = () => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /(^yw\.|:)camView$/.test(x)); return k ? [k, localStorage.getItem(k)] : null; });
    ok((await camKey())?.[1] === 'avatar', 'Vue perso saved');
    await p.reload(); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(3000);
    // owner decision 21/11: every launch opens in Vue appartement (the saved toggle is not restored)
    ok(Math.abs(await p.evaluate(() => window.__cam.zoom) - z0) < 2 && /Vue perso/.test(await p.locator('.chip.cam').getAttribute('aria-label') ?? ''), 'reload -> opens in Vue appartement (saved Vue perso not restored)');
    ok((await camKey())?.[1] === 'avatar', 'saved pref untouched by the launch (same key, no migration)');
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/(^yw\.|:)camView$/.test(k)) localStorage.removeItem(k); });
  }
  await ctx.close();
}
await b.close(); process.exitCode = fail ? 1 : 0;
