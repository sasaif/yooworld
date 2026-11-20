import { createRequire } from 'module'; import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Two-level player map (Carte), real taps. Level 1: 6 district badges + Usine/Ferme pins + Toi; level 2: district cards + Visiter.
// Usage: [DEV=se|iphone15|desktop] [SHOTS=dir] node tools/e2e-player-map.mjs http://127.0.0.1:PORT/
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '54224'}/`;
const DEVS = { se: { width: 667, height: 375, mobile: true }, iphone15: { width: 852, height: 393, mobile: true }, desktop: { width: 1440, height: 900, mobile: false } };
const DEV = process.env.DEV ?? 'iphone15'; const dev = DEVS[DEV];
const SHOTS = process.env.SHOTS ?? 'shots/player-map';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: dev.width, height: dev.height }, deviceScaleFactor: dev.mobile ? 2 : 1, isMobile: dev.mobile, hasTouch: dev.mobile });
const p = await ctx.newPage();
const errs = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } else passes++; };
const shot = (name) => p.screenshot({ path: `${SHOTS}/${DEV}_${name}.png` });
const tap = (sel) => (dev.mobile ? p.tap(sel) : p.click(sel));
const ready = () => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
const level = () => p.locator('[data-map="root"]').getAttribute('data-map-level');
// camera transition .45 s + layer fade, then wait until every finite CSS animation / transition has really finished
// (slow CI runners can lag the 0.4 s open scale-in past a fixed delay and skew the measured boxes)
const settle = async () => {
  await p.waitForTimeout(700);
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming?.().iterations === Infinity), null, { timeout: 8000 }).catch(() => {});
};
const box = (sel) => p.locator(sel).first().boundingBox();
const inView = (r) => !!r && r.x >= 0 && r.y >= 0 && r.x + r.width <= dev.width + 0.5 && r.y + r.height <= dev.height + 0.5;
// ---------- layout guards (QA BUG-1 / BUG-2 / minor): no overlap with the ✕ / title / tabs, no truncation ----------
const layout = () => p.evaluate(() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, n: (e.getAttribute('data-map-district') || e.getAttribute('data-map-pin') || e.getAttribute('data-map-place') || e.getAttribute('data-map') || e.className) + '' }; };
  const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const all = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
  const vw = innerWidth, vh = innerHeight, out = [];
  const safe = all('[data-map="close"], [data-map="title"], [data-map="back"], .pmap-tabs').map(R);
  const strip = all('.pmap-strip').map(R);
  const items = all('[data-map-district], [data-map-pin], .pmap-layer [data-map-place]').map(R);
  const here = all('[data-map="here"]').map(R);
  for (const it of [...items, ...here]) {
    for (const s of [...safe, ...strip]) if (hit(it, s)) out.push(`${it.n} overlaps ${s.n}`);
    if (it.x < -0.5 || it.y < -0.5 || it.x + it.w > vw + 0.5 || it.y + it.h > vh + 0.5) out.push(`${it.n} outside the view`);
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (hit(items[i], items[j])) out.push(`${items[i].n} overlaps ${items[j].n}`);
  for (const h of here) for (const it of items) if (hit(h, it)) out.push(`Toi covers ${it.n}`);
  const trunc = [];
  for (const e of all('[data-map-district] *, [data-map-district], [data-map-pin] *, .pmap-card h3, .pmap-tabs button')) {
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') trunc.push((e.innerText || '').trim().slice(0, 30));
    if (e.matches('.pmap-card h3') && e.scrollHeight > e.clientHeight + 1) trunc.push((e.innerText || '').trim().slice(0, 30));
  }
  const tabs = document.querySelector('.pmap-tabs'), tabsCut = [];
  if (tabs && tabs.offsetParent) { const tr = tabs.getBoundingClientRect(); for (const t of tabs.querySelectorAll('button')) { const r = t.getBoundingClientRect(); if (r.left < tr.left - 0.5 || r.right > tr.right + 0.5 || r.right > vw) tabsCut.push(t.getAttribute('data-map-tab')); } }
  return { overlaps: out, trunc, tabsCut };
});
const guard = async (tag) => {
  const L = await layout();
  ok(L.overlaps.length === 0, `${tag}: no badge/pin/Toi overlaps the ✕, title, tabs, strip or each other` + (L.overlaps.length ? ' — ' + L.overlaps.join('; ') : ''));
  ok(L.trunc.length === 0, `${tag}: no truncated badge / tab / card label` + (L.trunc.length ? ' — ' + L.trunc.join('; ') : ''));
  ok(L.tabsCut.length === 0, `${tag}: every district tab fully visible` + (L.tabsCut.length ? ' — ' + L.tabsCut.join(', ') : ''));
};
// level-2 zoom: when zoom x DPR would upscale the 1x art (> 1.15), the 2x art tiles under the view load lazily
const hdCheck = async (tag) => {
  const sc = await p.evaluate(() => +document.querySelector('.pmap-world').style.transform.match(/scale\(([\d.]+)\)/)[1]);
  const need = sc * (dev.mobile ? 2 : 1) > 1.15;
  if (need) await p.waitForFunction(() => [...document.querySelectorAll('[data-map-hd]')].length > 0 && [...document.querySelectorAll('[data-map-hd]')].every((i) => i.classList.contains('ok')), null, { timeout: 20000 }).catch(() => {});
  const hd = await p.evaluate(() => [...document.querySelectorAll('[data-map-hd]')].map((i) => ({ id: i.dataset.mapHd, w: i.naturalWidth, ok: i.classList.contains('ok') })));
  if (need) ok(hd.length >= 1 && hd.every((t) => t.ok && t.w === 1672), `${tag}: zoom ${sc.toFixed(2)} x DPR ${dev.mobile ? 2 : 1} → 2x art tiles loaded (${hd.map((t) => t.id).join(',') || 'none'})`);
  else if (!hd.length) ok(true, `${tag}: zoom ${sc.toFixed(2)} x DPR ${dev.mobile ? 2 : 1} → 1x art is enough, no 2x tiles requested`);
};
const tapCenter = async (sel) => { const r = await box(sel); const x = r.x + r.width / 2, y = r.y + r.height / 2; await (dev.mobile ? p.touchscreen.tap(x, y) : p.mouse.click(x, y)); };
const openMap = async () => { await tap('.dock button[data-map="dock"]'); await p.waitForSelector('[data-map="root"].visible', { timeout: 10000 }); await settle(); };

await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1');
await ready(); await p.waitForTimeout(2500);
await p.keyboard.press('F9'); await p.waitForTimeout(200);

ok(await p.locator('.dock button[data-map="dock"]').count() === 1, 'dock has a Carte button');
ok(await p.locator('.dock button[data-map="dock"]').innerText().then((t) => t.includes('Carte') && !t.includes('Lieux')), 'dock label is Carte, not Lieux');
await shot('01_closed');

// ---------- level 1 ----------
await openMap();
ok(await level() === '1', 'map opens on level 1 (city)');
ok(await p.locator('[data-map-hd]').count() === 0, 'level 1 never loads the 2x art tiles');
ok(await p.locator('[data-map="root"]').getAttribute('data-map-art') === 'clean', 'clean (text-free) art is loaded, not the fallback');
ok(await p.evaluate(() => { const i = document.querySelector('.pmap-world img.map'); return !!i && i.complete && i.naturalWidth === 1672 && i.currentSrc.endsWith('/playermap/map_clean.webp'); }), 'map_clean.webp decoded at 1672 px');
const names = await p.locator('[data-map-district]').allInnerTexts();
ok(names.length === 6, `6 district badges (${names.length})`);
ok(['Résidentiel', 'Centre-ville', 'Travail', 'Loisirs', 'Plage', 'Nature'].every((n, i) => names[i]?.includes(n)), 'badges are the 6 approved names: ' + names.map((n) => n.replace(/\s+/g, ' ').trim()).join(' / '));
ok(await p.locator('[data-map-place]').count() === 0 && await p.locator('.pmap-dot').count() === 0, 'no per-place markers on level 1 (the 25 hotspots / dots are gone)');
ok(await p.locator('[data-map-pin]').count() === 2, 'exactly 2 big pins on level 1');
for (const id of ['factory', 'farm']) {
  const r = await box(`[data-map-pin="${id}"]`); const t = await p.locator(`[data-map-pin="${id}"]`).innerText();
  ok(inView(r) && r.width >= 44 && r.height >= 44, `${id} pin visible and ≥ 44 px (${r && Math.round(r.width)}×${r && Math.round(r.height)})`);
  ok(t.includes('Bientôt') && (t.includes('Usine') || t.includes('Ferme')), `${id} pin says ${t.replace(/\s+/g, ' ').trim()}`);
}
for (const n of await p.locator('[data-map-district]').all()) { const r = await n.boundingBox(); if (!(inView(r) && r.height >= 44)) ok(false, 'badge in view and ≥ 44 px tall: ' + await n.innerText()); }
ok(true, 'all 6 badges are inside the viewport and ≥ 44 px tall');
ok(await p.locator('[data-map="here"]').count() === 1, '"Toi" marker shown on level 1');
ok(await p.locator('[data-map="title"]').innerText().then((t) => t.includes('YoLand') && !t.includes('YooWorld')), 'title says YoLand');
ok(!(await p.locator('[data-map="root"]').innerText()).includes('YooWorld'), 'no "YooWorld" text in the map');
await guard('level 1');
await shot('02_level1');
// tapping the very centre of the Travail badge opens Travail (on SE it used to sit under the ✕ and close the map)
await tapCenter('[data-map-district="work"]'); await settle();
ok(await level() === '2' && await p.locator('[data-map-tab="work"]').getAttribute('aria-pressed') === 'true', 'tapping the centre of the Travail badge opens Travail (does not close the map)');
await guard('Travail view');
await tap('[data-map="back"]'); await settle();

// ---------- level 2: Travail via the Usine pin ----------
await tap('[data-map-pin="factory"]'); await settle();
ok(await level() === '2', 'Usine pin opens level 2');
ok(await p.locator('[data-map-tab="work"]').getAttribute('aria-pressed') === 'true', 'Travail tab is active');
ok(await p.locator('[data-map-card="factory"].active').count() === 1, 'Usine card is pre-selected');
for (const id of ['factory', 'farm']) {
  const t = await p.locator(`[data-map-card="${id}"]`).innerText();
  ok(t.includes('Bientôt') && !/paie|Gold/i.test(t), `${id} card: Bientôt, no pay promise`);
  ok(await p.locator(`[data-map-go="${id}"]`).isDisabled(), `${id}: no Visiter (disabled)`);
  ok(inView(await box(`[data-map-place="${id}"]`)), `${id} pin visible in the Travail view`);
}
ok(await p.locator('[data-map="future"]').innerText().then((t) => t.includes('Dépôt') && t.includes('Atelier')), 'Travail: Extension future lists Dépôt + Atelier meubles');
await guard('Travail view (Usine selected)');
await hdCheck('Travail view');
await shot('03_work');
await tap('[data-map-place="farm"]'); await p.waitForTimeout(250);
ok(await p.locator('[data-map-card="farm"].active').count() === 1, 'tapping the Ferme pin selects its card');

// switch district from the tabs
await tap('[data-map-tab="center"]'); await settle();
ok(await p.locator('[data-map-tab="center"]').getAttribute('aria-pressed') === 'true', 'tab switches to Centre-ville without going back');
const centerCards = await p.locator('[data-map-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-map-card')));
ok(JSON.stringify(centerCards) === JSON.stringify(['club', 'cafe', 'plaza', 'promenade']), 'Centre-ville cards: ' + centerCards.join(', '));
ok(await p.locator('[data-map-card="club"]').innerText().then((t) => t.includes('Ouvert')), 'Games Club card is Ouvert');
ok(await p.locator('[data-map-go="club"]').isEnabled(), 'Visiter enabled for the Games Club');
ok(await p.locator('[data-map-go="cafe"]').isDisabled(), 'Café Yoo is Bientôt (disabled)');
ok(inView(await box('[data-map-card="club"]')) && inView(await box('[data-map-go="club"]')), 'Games Club card + button fully visible');
await guard('Centre-ville view');
await shot('04_center');

// back to the city, Escape chain
await tap('[data-map="back"]'); await settle();
ok(await level() === '1', '‹ Ville goes back to level 1');
await tap('[data-map-district="beach"]'); await settle();
ok(await level() === '2' && await p.locator('[data-map-card="beach"]').count() === 1, 'Plage badge opens the beach view');
ok(await p.locator('[data-map="future"]').innerText().then((t) => t.includes('Ponton')), 'Ponton de pêche is under Extension future');
await p.keyboard.press('Escape'); await settle();
ok(await level() === '1', 'Escape: level 2 → level 1');
await p.keyboard.press('Escape'); await p.waitForTimeout(450);
ok(await p.locator('[data-map="root"].visible').count() === 0, 'Escape on level 1 closes the map');

// tap a district ZONE (not the badge), then close from level 2
await openMap();
const z = await box('[data-map-zone="nature"]');
await (dev.mobile ? p.touchscreen.tap(z.x + z.width / 2, z.y + z.height * 0.8) : p.mouse.click(z.x + z.width / 2, z.y + z.height * 0.8)); await settle();
ok(await level() === '2' && await p.locator('[data-map-tab="nature"]').getAttribute('aria-pressed') === 'true', 'tapping the Nature area opens Nature');
await tap('[data-map="close"]'); await p.waitForTimeout(450);
ok(await p.locator('[data-map="root"].visible').count() === 0, 'X closes the map from level 2');
await openMap();
ok(await level() === '1', 'reopening always starts on level 1');

// ---------- travel ----------
await tap('[data-map-district="beach"]'); await settle();
await tap('[data-map-go="beach"]');
await p.waitForTimeout(500); await shot('05_transition');
await p.waitForFunction(() => window.game.s.location === 'beach' && !window.game.s.transition, null, { timeout: 30000 })
  .then(() => ok(true, 'Visiter travels to Yoo Plage with the fade'), () => ok(false, 'Visiter travels to Yoo Plage'));
ok(await p.evaluate(() => window.game.s.panel) !== 'places', 'map closes after travel');
await p.waitForTimeout(1200);

await openMap();
await guard('level 1 after arriving at the beach');
ok(await p.locator('[data-map="here"]').count() === 1, '"Toi" marker shown on level 1 at the beach');
await shot('06_beach_arrival');
await tap('[data-map-district="beach"]'); await settle();
await guard('Plage view at the beach');
ok(await p.locator('[data-map-go="beach"]').innerText().then((t) => t.includes('Tu y es')) && await p.locator('[data-map-go="beach"]').isDisabled(), 'Yoo Plage shows "Tu y es" when you are there');
ok(await p.locator('[data-map="here"]').count() === 1, '"Toi" marker shown in the Plage view');
await tap('[data-map="back"]'); await settle();
await tap('[data-map-district="residential"]'); await settle();
await tap('[data-map-go="home"]');
await p.waitForFunction(() => window.game.s.location === 'home' && !window.game.s.transition, null, { timeout: 30000 })
  .then(() => ok(true, 'Visiter travels to Mon appart'), () => ok(false, 'Visiter travels to Mon appart'));
await p.waitForTimeout(1200);

await openMap();
await guard('level 1 at home');
await tap('[data-map-district="residential"]'); await settle(); await guard('Résidentiel view'); await hdCheck('Résidentiel view');
for (const d of ['fun', 'nature']) { await tap(`[data-map-tab="${d}"]`); await settle(); await guard(`${d} view`); }
await tap('[data-map="back"]'); await settle();
await tap('[data-map-district="center"]'); await settle();
await tap('[data-map-go="club"]');
await p.waitForFunction(() => window.game.s.location === 'club' && !window.game.s.transition, null, { timeout: 30000 })
  .then(() => ok(true, 'Visiter travels to the Games Club with the fade'), () => ok(false, 'Visiter travels to the Games Club'));
ok(await p.evaluate(() => window.game.s.panel) !== 'places', 'map closes after travel to the club');

// ---------- fallback art ----------
await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1&mapart=baked'); await ready(); await p.waitForTimeout(1500);
await openMap();
ok(await p.locator('[data-map="root"]').getAttribute('data-map-art') === 'baked' && await p.locator('[data-map-district]').count() === 6, 'fallback (original art) still works with the same UI');

ok(errs.length === 0, 'no console/page errors ' + errs.join(' | '));
ok(bad.length === 0, 'no HTTP errors ' + bad.join(' '));
console.log(`SUMMARY player-map ${DEV} ${fails ? 'FAIL' : 'PASS'} (${passes} passed, ${fails} failed)`);
await b.close();
