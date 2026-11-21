import { createRequire } from 'module'; import fs from 'node:fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Black-dress bug (Alessandro, uat 21/11): he bought 'Short rose' (180 🪙) and the avatar ended up in a long shiny black dress,
// kept in the apartment. Dresses live in the 'top' slot (they hide the jacket and paint the legs), so a dress left in the
// look hides the bought shorts. Real studio UI, iPhone 15 landscape, test-player, any build (TEST balances).
//  A) dress already OWNED, tried on again from « Mes articles », then the shorts bought ALONE (« Acheter »), studio closed
//  B) dress NOT owned, tried on, shorts bought alone, then ‹ -> « Articles en essai » -> « Acheter » -> « Confirmer »
//  C) dress NOT owned, tried on, shorts bought alone, ‹ -> « Quitter sans acheter »
//  D) double-tap on « Acheter » and two concurrent buy() calls -> one purchase, one debit
// Each: reload -> saved look = shorts equipped, no dress; only 180 🪙 debited (no 💎). usage: [SHOTS=dir] node tools/e2e-dress-draft.mjs URL
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5790'}/`; const SHOTS = process.env.SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const DRESS = 'dress_gv3_noir', SHORTS = 'pants_pink_shorts';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0, passes = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x) : '')); if (c) passes++; else { fails++; process.exitCode = 1; } };
const errs = []; const evidence = {};
const ready = (p) => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
const state = (p) => p.evaluate(([D, S]) => {
  const k = Object.keys(localStorage).find((x) => /look:test-player:f$/.test(x)); const a = window.economy.snapshot().account;
  return { lookKey: k, saved: k ? JSON.parse(localStorage.getItem(k)) : null, live: window.fashion.s.looks.f.slots, gold: a.gold.balance, diamond: a.diamond.balance, ownsDress: window.economy.owns(D), ownsShorts: window.economy.owns(S) };
}, [DRESS, SHORTS]);
async function fresh(pre) {
  const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  await ctx.addInitScript(() => { try { sessionStorage.setItem('yw:e:dev:portrait', '1'); for (const k of Object.keys(sessionStorage)) if (k.endsWith(':portrait')) sessionStorage.setItem(k, '1'); } catch {} });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await ready(p); await p.evaluate(() => localStorage.clear()); await p.reload(); await ready(p); await p.waitForTimeout(1500);
  await p.evaluate(() => { for (const k of Object.keys(sessionStorage)) if (k.endsWith(':portrait')) sessionStorage.setItem(k, '1'); });
  if (pre) { await p.evaluate(pre, [DRESS, SHORTS]); await p.reload(); await ready(p); await p.waitForTimeout(1500); }
  return { ctx, p };
}
const ui = (p) => ({
  open: async (tab) => { await p.evaluate((tab) => window.fashion.open(window.game.s.activeChar, 'dress', tab), tab); await p.waitForSelector('.st'); await p.waitForTimeout(1200); },
  cat: async (l) => { await p.locator('.st-cats button', { hasText: l }).first().tap(); await p.waitForTimeout(500); },
  tab: async (l) => { await p.locator('.st-tabs button', { hasText: l }).first().tap(); await p.waitForTimeout(400); },
  tap: async (id) => { const el = p.locator(`[data-item="${id}"]`).first(); await el.scrollIntoViewIfNeeded(); await el.tap(); await p.waitForTimeout(400); },
  buyOne: async () => { await p.locator('.st-detail .btn.buy').tap(); await p.waitForTimeout(700); },
  back: async () => { await p.locator('.st-back').tap(); await p.waitForTimeout(700); },
});
async function check(name, p, g0, d0, shot) {
  await p.reload(); await ready(p); await p.waitForTimeout(2500);
  const s = await state(p); evidence[name] = s;
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${shot}_after_reload.png` });
  ok(s.saved?.slots?.pants === SHORTS && s.live.pants === SHORTS, `${name}: reload -> Short rose equipped (saved + live)`, s.saved?.slots);
  ok(!String(s.saved?.slots?.top ?? '').startsWith('dress_') && !String(s.live.top ?? '').startsWith('dress_'), `${name}: reload -> no dress in the look (top = ${s.saved?.slots?.top})`, s.saved?.slots);
  ok(g0 - s.gold === 180 && d0 - s.diamond === 0, `${name}: only the shorts were charged (🪙 -${g0 - s.gold}, 💎 -${d0 - s.diamond})`);
  return s;
}
// A) dress already owned (bought earlier, then back to a tee), tried on again, shorts bought alone
{ const { ctx, p } = await fresh(async ([D]) => { window.fashion.open('f', 'dress'); window.fashion.tap(D); await window.fashion.buy([D]); window.fashion.open('f', 'top'); window.fashion.tap('tee_cheese'); await window.fashion.close(); });
  const s0 = await state(p); evidence.A_before = s0; const u = ui(p);
  ok(s0.ownsDress && s0.saved?.slots?.top === 'tee_cheese', 'A setup: dress owned, tee worn', s0.saved?.slots);
  await u.open('owned'); await u.tap(DRESS); if (SHOTS) await p.screenshot({ path: `${SHOTS}/A_1_owned_dress_tried.png` });
  await u.tab('Boutique'); await u.cat('Pantalons'); await u.tap(SHORTS); if (SHOTS) await p.screenshot({ path: `${SHOTS}/A_2_shorts_tapped.png` });
  await u.buyOne(); if (SHOTS) await p.screenshot({ path: `${SHOTS}/A_3_shorts_bought.png` });
  await u.back(); if (await p.locator('.st-modal').count()) await p.locator('.st-modal .btn', { hasText: 'Quitter sans acheter' }).tap(); await p.waitForTimeout(700);
  await check('A owned dress tried + shorts bought alone', p, s0.gold, s0.diamond, 'A'); await ctx.close(); }
// B) dress not owned, tried on, shorts bought alone, then « Acheter » in the leaving modal + confirm
{ const { ctx, p } = await fresh(); const s0 = await state(p); evidence.B_before = s0; const u = ui(p);
  await u.open('shop'); await u.tap(DRESS); await u.cat('Pantalons'); await u.tap(SHORTS); if (SHOTS) await p.screenshot({ path: `${SHOTS}/B_1_dress_and_shorts_tried.png` });
  await u.buyOne(); await u.back();
  const modal = await p.locator('.st-modal').count(); evidence.B_leavingModal = modal > 0;
  if (modal) { if (SHOTS) await p.screenshot({ path: `${SHOTS}/B_2_leaving_modal.png` }); await p.locator('.st-modal .btn.buy', { hasText: 'Acheter' }).tap(); await p.waitForTimeout(500);
    if (await p.locator('.st-modal .btn.buy', { hasText: 'Confirmer' }).count()) { if (SHOTS) await p.screenshot({ path: `${SHOTS}/B_3_confirm_modal.png` }); await p.locator('.st-modal .btn.buy', { hasText: 'Confirmer' }).tap(); await p.waitForTimeout(800); }
    if (await p.locator('.st').count()) { await u.back(); } }
  await check('B unowned dress tried + shorts bought alone, then « Acheter » on leaving', p, s0.gold, s0.diamond, 'B'); await ctx.close(); }
// C) dress not owned, tried on, shorts bought alone, quit without buying
{ const { ctx, p } = await fresh(); const s0 = await state(p); const u = ui(p);
  await u.open('shop'); await u.tap(DRESS); await u.cat('Pantalons'); await u.tap(SHORTS); await u.buyOne(); await u.back();
  if (await p.locator('.st-modal').count()) await p.locator('.st-modal .btn', { hasText: 'Quitter sans acheter' }).tap(); await p.waitForTimeout(700);
  await check('C unowned dress tried + shorts bought alone, quit without buying', p, s0.gold, s0.diamond, 'C'); await ctx.close(); }
// D) double tap / concurrent purchases
{ const { ctx, p } = await fresh(); const s0 = await state(p); const u = ui(p);
  await u.open('shop'); await u.cat('Pantalons'); await u.tap(SHORTS);
  await p.evaluate(() => { const bt = document.querySelector('.st-detail .btn.buy'); bt.click(); bt.click(); });
  await p.waitForTimeout(1000);
  const s1 = await state(p); ok(s0.gold - s1.gold === 180 && s1.ownsShorts, `D: double tap on « Acheter » -> one purchase (🪙 -${s0.gold - s1.gold})`);
  const r = await p.evaluate(async () => { const f = window.fashion; const g = window.economy.snapshot().account.gold.balance;
    const it = ['top', 'shoes', 'hair'].flatMap((c) => f.itemsFor(c, 'f')).find((i) => i.price?.currency === 'gold' && i.price.amount <= g && !f.owns(i.id));
    f.open('f', it.category); f.tap(it.id);
    const res = await Promise.all([f.buy([it.id]), f.buy([it.id])]); return { id: it.id, res, debit: g - window.economy.snapshot().account.gold.balance, price: it.price.amount }; });
  ok(r.res.filter(Boolean).length === 1 && r.debit === r.price, `D: two concurrent buy() of ${r.id} -> exactly one succeeds, one debit (${JSON.stringify(r)})`);
  await ctx.close(); }
ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
if (SHOTS) fs.writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify(evidence, null, 1));
console.log(`\n${fails ? 'FAILED' : 'ALL PASS'} (${passes} PASS, ${fails} FAIL)`);
await b.close();
