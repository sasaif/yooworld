import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Fashion studio end-to-end on an iPhone 15 landscape touch viewport (852x393) with real localStorage:
// HUD balances -> Style -> try-on cart -> confirm purchase -> balances/ownership -> equip/unequip -> persistence after reload
// -> local Gold trade between the two TEST accounts -> diamonds never tradable -> back to the game (camera/animations intact) -> perf.
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5217'}/`;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errs = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const ready = () => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 120000 });
const bal = () => p.evaluate(() => { const a = window.economy.snapshot().account; return [a.gold.balance, a.diamond.balance]; });
await p.goto(url); await ready(); await p.evaluate(() => localStorage.clear()); await p.reload(); await ready(); await p.waitForTimeout(3000);
ok(await p.locator('.hud-top .wallet-chip', { hasText: '5 000' }).count() === 1 && await p.locator('.hud-top .wallet-chip', { hasText: '100 000' }).count() === 1, 'HUD shows 5 000 Gold and 100 000 Diamonds (TEST top-up)');
ok(await p.locator('.hud-top .test-tag').count() === 1, 'balances labelled TEST');
await p.tap('.dock .style-btn'); await p.waitForSelector('.st'); await p.waitForTimeout(3000); ok(true, 'Style studio opens from the dock');
ok(await p.locator('.st-cats button').count() === 12, '12 categories on the female body (Barbe hidden, + Robes)');
const tap = async (id) => { const el = p.locator(`[data-item="${id}"]`).first(); await el.scrollIntoViewIfNeeded(); await el.tap(); await p.waitForTimeout(250); };
const cat = (l) => p.locator('.st-cats button', { hasText: l }).first().tap();
await cat('T-shirts'); await tap('tee_star'); await cat('Pantalons'); await tap('pants_jeans'); await cat('Accessoires'); await tap('acc_glasses_heart');
ok(await p.locator('.ct-chip').count() === 3, 'try-on cart holds 3 items');
ok(await p.locator('.st-cart .pr.gold', { hasText: '440' }).count() === 1 && await p.locator('.st-cart .pr.diamond', { hasText: '15' }).count() === 1, 'cart totals per currency (440 🪙 + 15 💎)');
await p.tap('.st-cart .btn.buy'); await p.waitForSelector('.md-card'); await p.tap('.md-card .btn.buy'); await p.waitForTimeout(800);
ok(JSON.stringify(await bal()) === JSON.stringify([4560, 99985]), 'checkout debits both wallets atomically ' + JSON.stringify(await bal()));
ok(await p.locator('[data-item="acc_glasses_heart"] .own').count() === 1, 'item marked Possédé');
await tap('acc_glasses_heart'); ok(await p.evaluate(() => !window.fashion.s.studio.draft.slots['acc.glasses']), 'unequip an owned accessory');
await tap('acc_glasses_heart'); ok(await p.locator('.ct-chip').count() === 0, 're-equip owned item does not go to the cart');
await p.locator('.st-tabs button', { hasText: 'Mes articles' }).tap(); await cat('Accessoires'); ok(await p.locator('.it-card').count() >= 1, 'Mes articles lists owned items');
await p.locator('.st-tabs button', { hasText: 'Équipé' }).tap(); ok(await p.locator('.eq-row').count() > 8, 'Équipé lists the equipped slots');
await p.locator('.st-tabs button', { hasText: 'Échanges' }).tap(); ok(await p.locator('.tr-banner', { hasText: 'Mode test local' }).count() === 1, 'trade lab clearly labelled local test');
await p.locator('.trade .btn.big').tap(); const s = p.locator('.tr-side');
ok(await s.nth(0).locator('input').count() === 1 && await p.locator('.tr-offer input').count() === 2, 'only a Gold amount can be offered');
ok(await p.locator('.tr-lock', { hasText: 'non échangeable' }).count() === 2, 'diamonds shown as non-tradable');
await s.nth(0).locator('input').fill('200'); await s.nth(0).locator('button', { hasText: 'Proposer' }).tap(); await p.waitForTimeout(200);
await s.nth(0).locator('button', { hasText: 'Accepter' }).tap(); await p.waitForTimeout(200); await p.locator('.tr-side').nth(1).locator('button', { hasText: 'Accepter' }).tap(); await p.waitForTimeout(300);
ok((await bal())[0] === 4360, 'gold moved to escrow on double acceptance');
await p.locator('.tr-side').nth(0).locator('button', { hasText: 'Confirmer' }).tap(); await p.waitForTimeout(200); await p.locator('.tr-side').nth(1).locator('button', { hasText: 'Confirmer' }).tap(); await p.waitForTimeout(300);
const friend = await p.evaluate(() => window.economy.snapshot().accounts.find((a) => a.id === 'test-friend').gold.balance);
ok(friend === 2200 && (await bal())[1] === 99985, 'trade executed: B +200 🪙, diamonds untouched');
await p.locator('.st-tabs button', { hasText: 'Portefeuille' }).tap(); ok(await p.locator('.pack:disabled').count() === 4, 'diamond packs disabled (no payment)');
ok(await p.locator('.dev', { hasText: 'aucun paiement réel' }).count() === 1, 'DEV grant labelled « aucun paiement réel »');
await p.tap('.st-back'); await p.waitForTimeout(800); ok(await p.locator('.st').count() === 0, 'studio closes');
await p.reload(); await ready(); await p.waitForTimeout(2500);
ok(await p.evaluate(() => window.fashion.s.looks.f.slots.top) === 'tee_star' && JSON.stringify(await bal()) === JSON.stringify([4360, 99985]), 'look, ownership and balances persist after reload');
// existing systems still alive
await p.evaluate(() => window.game.toggleEmote()); await p.waitForTimeout(800); ok(await p.evaluate(() => !!window.__world.chars[window.game.s.activeChar].emote), 'dance still works with the custom avatar');
await p.evaluate(() => window.game.toggleEmote());
// perf: both avatars fully dressed
await p.waitForTimeout(1500); const base = await p.evaluate(() => window.__info); console.log('PERF default looks (whole apartment scene):', JSON.stringify(base));
await p.evaluate(() => window.__dressAll?.()); await p.waitForTimeout(4000);
const info = await p.evaluate(() => window.__info); console.log('PERF fully dressed (whole apartment scene):', JSON.stringify(info));
ok(errs.length === 0, 'no console errors ' + JSON.stringify(errs.slice(0, 3))); ok(bad.length === 0, 'no failed requests ' + JSON.stringify(bad.slice(0, 3)));
await b.close();
