import { chromium } from 'playwright-core';
// End-to-end smoke test on a 390x844 touch viewport with real localStorage persistence.
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
await p.goto('http://localhost:5202/'); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 120000 }); await p.waitForTimeout(6000);
// 1. touch tap on the floor -> the active character walks
await p.touchscreen.tap(195, 500); await p.waitForTimeout(2500);
const moved = await p.evaluate(() => { const w = window.__world; return w ? w.chars[window.game.s.activeChar].pos.toArray() : null; });
ok(moved && (Math.abs(moved[0] - 3.0) > 0.2 || Math.abs(moved[2] - 2.85) > 0.2), 'tap-to-walk moved the character ' + JSON.stringify(moved));
// 2. place an item from the bag, 3. rotate, 4. store it back
const n0 = await p.evaluate(() => window.game.s.apartment.items.length);
await p.evaluate(() => { const g = window.game; g.setMode('edit'); g.startPlace('chair'); g.confirmPlace(); });
const n1 = await p.evaluate(() => window.game.s.apartment.items.length);
ok(n1 === n0 + 1, `place from inventory (${n0} -> ${n1})`);
const rot = await p.evaluate(() => { const g = window.game; const uid = g.s.selItem; g.rotateSelected(); return g.s.apartment.items.find((i) => i.uid === uid).rot; });
ok(rot === 1, 'rotate selected item');
await p.evaluate(() => window.game.setFinish('floor', 'mint'));
await p.waitForTimeout(600);
// 5. reload -> layout, finish and inventory persisted through the repository
await p.reload(); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 120000 });
const after = await p.evaluate(() => ({ n: window.game.s.apartment.items.length, floor: window.game.s.apartment.floor, coins: window.game.s.inventory.coins, chairs: window.game.s.inventory.items.chair ?? 0 }));
ok(after.n === n1 && after.floor === 'mint' && after.coins === 420 && after.chairs === 0, 'persisted after reload ' + JSON.stringify(after));
await p.evaluate(() => { const g = window.game; g.setMode('edit'); const it = g.s.apartment.items.find((i) => i.defId === 'chair' && !i.uid.startsWith('start_')); g.store.set({ selItem: it.uid }); g.storeSelected(); });
ok(await p.evaluate(() => window.game.s.inventory.items.chair === 1), 'store back into the bag');
// 6. interaction: toggle the TV
const on = await p.evaluate(() => { const g = window.game; g.setMode('play'); const tv = g.s.apartment.items.find((i) => i.defId === 'televisionModern'); g.interact(tv.uid, 'toggle'); return g.s.apartment.items.find((i) => i.uid === tv.uid).on; });
ok(on === true, 'TV toggles on');
await p.evaluate(() => localStorage.clear());
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
await b.close();
