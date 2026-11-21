import { createRequire } from 'module'; import fs from 'node:fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Glam collection e2e (LocalDevEconomy / DEV only). usage: [SHOTS=dir] node tools/e2e-fashion-glam.mjs http://127.0.0.1:PORT/
// 1) iPhone 15 landscape: the TEST diamond top-up is 100 000 and one-shot; buy ONE item of each glam type (dress, gothic hair,
//    eye look, glasses) through the real studio UI with diamonds on test-player, equip, persist after reload; the 4 Terrazzo
//    shapes each build with ear-resting temples. 2) shots (default three-quarter camera, avatar scale untouched).
// 3) iPhone SE landscape: per-avatar draw calls / triangles before/after (window.__avatarStats) + whole scene (window.__info).
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5798'}/`; const SHOTS = process.env.SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const errs = [], bad = [];
async function page(w, h, dpr) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); }); return { ctx, p };
}
const ready = (p) => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 120000 });
const bal = (p) => p.evaluate(() => window.economy.snapshot().account.diamond.balance);
const item = (p, id) => p.evaluate((id) => ['dress', 'hair', 'eyes', 'accessory'].flatMap((c) => window.fashion.itemsFor(c, 'f')).find((i) => i.id === id) ?? null, id);
// --- 1) purchase flow
const { ctx, p } = await page(852, 393, 3);
await p.goto(url); await ready(p); await p.evaluate(() => localStorage.clear()); await p.reload(); await ready(p); await p.waitForTimeout(2500);
ok(await bal(p) === 100000, 'test-player starts with 100 000 💎 (TEST top-up) ' + await bal(p));
const env = await p.evaluate(() => [window.__saveEnv, Object.keys(localStorage).filter((k) => (k.startsWith('yooworld:') && !k.startsWith('yooworld:e:')) || k.startsWith('yw.'))]);
ok(env[1].length === 0, 'no production save key written ' + JSON.stringify(env));
await p.reload(); await ready(p); await p.waitForTimeout(1500); ok(await bal(p) === 100000, 'top-up is one-shot (reload keeps 100 000, no second grant)');
const ids = { dress: 'dress_gv1_cerise', hair: 'hair_goth_bob', eyes: 'eyelook_rubis', glasses: 'acc_terrazzo_wayfarer' };
const price = []; for (const id of Object.values(ids)) price.push((await item(p, id))?.price);
ok(price.every((x) => x?.currency === 'diamond' && x.amount >= 20 && x.amount <= 50), 'each picked item is priced 20–50 💎 ' + JSON.stringify(price.map((x) => x?.amount)));
const sum = price.reduce((a, x) => a + (x?.amount ?? 0), 0);
await p.tap('.dock .style-btn'); await p.waitForSelector('.st'); await p.waitForTimeout(2500);
const cat = (l) => p.locator('.st-cats button', { hasText: l }).first().tap();
const tap = async (id) => { const el = p.locator(`[data-item="${id}"]`).first(); await el.scrollIntoViewIfNeeded(); await el.tap(); await p.waitForTimeout(400); };
ok(await p.locator('.st-cats button', { hasText: 'Robes' }).count() === 1, 'shop has a « Robes » category');
await cat('Robes'); await p.waitForTimeout(1500); const nd = await p.locator('[data-item^="dress_"]').count(); ok(nd === 27, '27 dresses listed ' + nd);
await tap(ids.dress); if (SHOTS) { await p.waitForTimeout(2500); await p.screenshot({ path: `${SHOTS}/01_shop_robes_iphone15.png` }); }
await cat('Cheveux'); await p.waitForTimeout(800); await tap(ids.hair);
await cat('Yeux'); await p.waitForTimeout(800); await tap(ids.eyes);
await cat('Accessoires'); await p.waitForTimeout(800); await tap(ids.glasses); if (SHOTS) { await p.waitForTimeout(2500); await p.screenshot({ path: `${SHOTS}/02_shop_terrazzo_iphone15.png` }); }
ok(await p.locator('.ct-chip').count() === 4, 'try-on cart holds the 4 glam items');
ok(await p.locator('.st-cart .pr.diamond', { hasText: String(sum) }).count() === 1, `cart total ${sum} 💎`);
await p.tap('.st-cart .btn.buy'); await p.waitForSelector('.md-card'); await p.tap('.md-card .btn.buy'); await p.waitForTimeout(1200);
ok(await bal(p) === 100000 - sum, `diamonds debited: ${await bal(p)} = 100 000 − ${sum}`);
for (const id of Object.values(ids)) ok(await p.evaluate((id) => window.economy.owns(id), id), `${id} owned`);
await p.tap('.st-back'); await p.waitForTimeout(1500);
const look = await p.evaluate(() => window.fashion.s.looks.f.slots);
ok(look.top === ids.dress && look.hair === ids.hair && look['makeup.eyes'] === ids.eyes && look['acc.glasses'] === ids.glasses, 'all 4 equipped on the avatar ' + JSON.stringify(look));
const st = await p.evaluate(() => window.__avatarStats().find((a) => a.top));
ok(st && st.top === 'gv1' && !st.names.some((n) => /pants|jacket/i.test(n)), 'dress rendered, trousers/jacket hidden ' + JSON.stringify(st?.names));
await p.reload(); await ready(p); await p.waitForTimeout(2500);
const srt = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); const look2 = await p.evaluate(() => window.fashion.s.looks.f.slots);
ok(srt(look2) === srt(look) && await bal(p) === 100000 - sum, 'look, ownership and balance persist after reload ' + (srt(look2) === srt(look) ? '' : srt(look2)) + ' ' + await bal(p));
// the 4 Terrazzo shapes: each builds, temples rest on the ear (TEMPLE_FITS from the procedural fit)
const terra = ['acc_yoville_p1', 'acc_terrazzo_wayfarer', 'acc_terrazzo_pilote', 'acc_terrazzo_demilune'];
const pr = []; for (const id of terra) { const i = await item(p, id); pr.push(i && [i.name, i.price.currency, i.price.amount]); }
ok(pr.every((x) => x && x[1] === 'diamond' && !/ray-?ban|police/i.test(x[0])), 'Terrazzo ×4 in the shop, diamond priced, no brand names ' + JSON.stringify(pr));
await p.evaluate(() => window.fashion.open('f', 'accessory'));
for (const id of terra) { await p.evaluate((id) => window.fashion.tap(id), id); await p.waitForTimeout(1500);
  const m = await p.evaluate(() => [...window.__glam.TEMPLE_FITS.values()].flat());
  ok(m.length >= 2 && m.every((x) => x.insideSamples === 0 && x.minClearance > 0), `${id} built; all fitted temples ride over the ear, none inside the head (${m.length} temples, min clearance ${Math.min(...m.map((x) => x.minClearance)).toFixed(4)} m)`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/03_studio_${id}.png` }); }
await p.evaluate(() => window.fashion.close('keep-owned')); await p.waitForTimeout(800);
// --- 2) in-game looks (default camera; bought through the controller, same checkout path as the UI)
const buyEquip = (pg, ids) => pg.evaluate(async (ids) => { const f = window.fashion; f.open('f', 'accessory'); for (const id of ids) { const it = f.itemsFor('accessory', 'f').concat(f.itemsFor('dress', 'f'), f.itemsFor('hair', 'f'), f.itemsFor('eyes', 'f')).find((i) => i.id === id); if (f.s.studio.draft.slots[it.slot] !== id) f.tap(id); } if (f.cart().length) await f.buyCart(); await f.close('keep-owned'); }, ids);
const proj = () => p.evaluate(() => { const a = window.__avatarStats().find((x) => x.body === 'f'), cam = window.__cam, V = cam.position.constructor;
  const pj = (y) => { const q = new V((a.min[0] + a.max[0]) / 2, y, (a.min[2] + a.max[2]) / 2).project(cam); return [(q.x + 1) / 2 * innerWidth, (1 - q.y) / 2 * innerHeight]; }; return { foot: pj(a.min[1]), top: pj(a.max[1]) }; });
const looks = [['10_goth_corbeau_wayfarer', ['dress_gv1_cerise', 'hair_goth_bob', 'haircol_raven', 'eyelook_rubis', 'acc_terrazzo_wayfarer']],
  ['11_goth_minuit_pilote', ['dress_gv2_violet', 'hair_goth_long', 'haircol_violet_noir', 'eyelook_amethyste', 'acc_terrazzo_pilote']],
  ['12_goth_vampire_demilune', ['dress_gv3_noir', 'hair_goth_pony', 'haircol_raven', 'eyelook_smoky_prune', 'acc_terrazzo_demilune']],
  ['13_sirene_terrazzo_ronde', ['dress_d1_cerise', 'acc_yoville_p1']], ['14_minuit_paillete_bonbon', ['dress_d2_nuit', 'acc_yoville_mauve']], ['15_corset_candy_biba', ['dress_d6_rose', 'acc_biba_rose']]];
for (const [name, l] of looks) { await buyEquip(p, l); await p.waitForTimeout(2500); const s2 = await p.evaluate(() => window.fashion.s.looks.f.slots);
  ok(l.every((id) => Object.values(s2).includes(id)), `${name}: bought + equipped`);
  if (SHOTS) { const hd = await proj(); await p.screenshot({ path: `${SHOTS}/${name}.png` });
    const H = Math.abs(hd.foot[1] - hd.top[1]), cx = hd.foot[0], top = Math.max(0, hd.top[1] - 40);
    await p.screenshot({ path: `${SHOTS}/${name}_crop.png`, clip: { x: Math.max(0, cx - 80), y: top, width: 160, height: Math.min(393 - top, H + 60) } });
    console.log(`  ${name}: avatar on screen ≈ ${Math.round(H)} CSS px (bounding box, feet→top)`); } }
console.log('balance after all looks', await bal(p)); await ctx.close();
// --- 3) perf, iPhone SE landscape (667x375 @2x)
const se = await page(667, 375, 2); const q = se.p;
await q.goto(url); await ready(q); await q.evaluate(() => localStorage.clear()); await q.reload(); await ready(q); await q.waitForTimeout(3500);
const snap = async () => ({ av: await q.evaluate(() => window.__avatarStats().map(({ body, top, hair, calls, tris }) => ({ body, top, hair, calls, tris }))), info: await q.evaluate(() => window.__info) });
console.log('PERF SE before (default looks):', JSON.stringify(await snap()));
for (const [label, l] of [['latex dress + goth bob + eyes + Terrazzo Wayfarer', looks[0][1]], ['latex sirène + goth pony + Terrazzo Demi-lune', looks[2][1]], ['evening dress + Terrazzo round (P1)', looks[3][1]], ['+ Terrazzo Pilote', ['acc_terrazzo_pilote']]]) {
  await buyEquip(q, l); await q.waitForTimeout(3500); console.log(`PERF SE after [${label}]:`, JSON.stringify(await snap())); }
await se.ctx.close();
ok(errs.length === 0, 'no console errors ' + JSON.stringify(errs.slice(0, 3))); ok(bad.length === 0, 'no failed requests ' + JSON.stringify(bad.slice(0, 3)));
await b.close();
