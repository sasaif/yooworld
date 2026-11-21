import { createRequire } from 'module'; import fs from 'node:fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// QA fashion-glam (Expert 21/11): when the balance is too low, « Acheter la tenue » / the single « Acheter » are DISABLED and say
// « Il te manque X 💎 » instead of a negative « Après achat : 💎 -100 ». Needs a PRODUCTION build (test-player seeded with 100 💎:
// Rétro Bonbon = 200 💎). Real studio UI, iPhone 15 landscape. usage: [SHOTS=dir] node tools/e2e-glam-shortfall.mjs URL
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5791'}/`; const SHOTS = process.env.SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const GLASSES = 'acc_yoville_mauve', CHEAP = 'acc_terrazzo_demilune';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0, passes = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x) : '')); if (c) passes++; else { fails++; process.exitCode = 1; } };
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ready = () => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
const bal = () => p.evaluate(() => { const a = window.economy.snapshot().account; return { gold: a.gold.balance, diamond: a.diamond.balance }; });
const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
const tap = async (id) => { const el = p.locator(`[data-item="${id}"]`).first(); await el.scrollIntoViewIfNeeded(); await el.tap(); await p.waitForTimeout(500); };
await p.goto(url); await ready(); await p.evaluate(() => localStorage.clear()); await p.reload(); await ready(); await p.waitForTimeout(1500);
const b0 = await bal(); ok(b0.diamond === 100, 'production build: test-player has 100 💎 (precondition)', b0);
ok(await p.evaluate(() => typeof window.__avatarStats === 'undefined' && typeof window.__glam === 'undefined'), 'prod build: no window.__avatarStats / window.__glam');
await p.evaluate(() => window.fashion.open(window.game.s.activeChar, 'accessory', 'shop')); await p.waitForSelector('.st'); await p.waitForTimeout(1500);
// 1) single item too expensive -> detail « Acheter » disabled, says what is missing
await tap(GLASSES);
const one = p.locator('.st-detail .btn.buy');
ok(await one.isDisabled(), 'single-item buy disabled (200 💎 > 100 💎)');
ok((await one.innerText()).trim() === 'Il te manque 100 💎', 'single-item button: « Il te manque 100 💎 »', await one.innerText());
// 2) try-on cart over budget -> « Acheter la tenue » replaced by a disabled « Il te manque … »
const cart = p.locator('.st-cart .btn.buy');
ok(await cart.isDisabled(), '« Acheter la tenue » disabled when the cart costs more than the balance');
ok((await cart.innerText()).trim() === 'Il te manque 100 💎', 'cart button: « Il te manque 100 💎 »', await cart.innerText());
ok(await p.locator('.st-cart', { hasText: 'Acheter la tenue' }).count() === 0, 'no « Acheter la tenue » label while unaffordable');
await shot('after_1_cart_short'); await cart.tap({ force: true }).catch(() => {}); await p.waitForTimeout(400);
const opened = await p.locator('.md-card').count(); ok(opened === 0, 'tapping the disabled button opens no confirm', opened ? await p.locator('.md-card').innerText() : undefined);
if (opened) { await shot('after_1b_confirm_opened'); await p.evaluate(() => window.fashion.askConfirm(false)); await p.waitForTimeout(300); }
// 3) the leaving prompt: its « Acheter » is disabled with the shortfall too; the confirm sheet (if ever opened, e.g. the balance
//    dropped meanwhile) shows the shortfall instead of a negative « Après achat »
await p.locator('.st-back').tap(); await p.waitForTimeout(600);
const lb = p.locator('.md-card .btn.buy'); ok(await p.locator('.md-card h3', { hasText: 'Articles en essai' }).count() === 1, 'leaving prompt shown');
ok(await lb.isDisabled() && (await lb.innerText()).trim() === 'Il te manque 100 💎', 'leaving prompt « Acheter » -> disabled « Il te manque 100 💎 »', await lb.innerText());
await shot('after_2_leaving_short');
await p.locator('.md-card .btn.ghost', { hasText: 'Continuer' }).tap(); await p.waitForTimeout(400);
await p.evaluate(() => window.fashion.askConfirm(true)); await p.waitForSelector('.md-card'); await p.waitForTimeout(300);
const mdText = await p.locator('.md-card').innerText();
ok(/Il te manque 100 💎/.test(mdText) && !/Après achat/.test(mdText) && !/-\s?100/.test(mdText), 'confirm: « Il te manque 100 💎 », no « Après achat : -100 »', mdText);
ok(await p.locator('.md-card .btn.buy').isDisabled(), 'confirm button disabled');
await shot('after_3_confirm_short');
const b1 = await bal(); ok(b1.diamond === 100 && b1.gold === b0.gold, 'nothing debited', b1);
await p.evaluate(() => window.fashion.askConfirm(false)); await p.waitForTimeout(300);
// 4) affordable again (cheap item instead) -> normal « Acheter la tenue » + « Après achat »
await tap(CHEAP);
ok((await p.locator('.st-cart .btn.buy').innerText()).trim() === 'Acheter la tenue' && !(await p.locator('.st-cart .btn.buy').isDisabled()), 'affordable cart (40 💎): « Acheter la tenue » enabled');
await p.locator('.st-cart .btn.buy').tap(); await p.waitForSelector('.md-card'); await p.waitForTimeout(300);
ok(/Après achat/.test(await p.locator('.md-card').innerText()) && !/Il te manque/.test(await p.locator('.md-card').innerText()), 'affordable confirm keeps « Après achat »');
await shot('after_4_affordable_confirm');
ok(errs.length === 0, 'no page errors', errs);
console.log(`\n${passes} passed, ${fails} failed`); await b.close();
