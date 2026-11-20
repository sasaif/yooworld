import { createRequire } from 'module'; import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Player map (Carte) on iPhone 15 landscape, real taps. Usage:
//   SHOTS=dir node tools/e2e-player-map.mjs http://127.0.0.1:PORT/
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '54224'}/`;
const SHOTS = process.env.SHOTS ?? 'shots/player-map';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = [], bad = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } else passes++; };
const shot = (name) => p.screenshot({ path: `${SHOTS}/${name}.png` });
const ready = () => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });

await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1');
await ready(); await p.waitForTimeout(2500);
await p.keyboard.press('F9'); await p.waitForTimeout(200);

ok(await p.locator('.dock button[data-map="dock"]').count() === 1, 'dock has a Carte button');
ok(await p.locator('.dock button[data-map="dock"]').innerText().then((t) => t.includes('Carte') && !t.includes('Lieux')), 'dock label is Carte, not Lieux');
ok(await p.locator('.dock button', { hasText: 'Lieux' }).count() === 0, 'no second Lieux button');
await shot('01_map_closed');

await p.tap('.dock button[data-map="dock"]');
await p.waitForSelector('[data-map="root"].visible', { timeout: 10000 });
await p.waitForTimeout(500);
ok(await p.locator('[data-map="root"].visible').count() === 1, 'map opens as a full overlay');
const nPlaces = await p.locator('[data-map-place]').count();
ok(nPlaces === 25, `25 place hotspots (${nPlaces})`);
const beachVisible = await p.evaluate(() => {
  const root = document.querySelector('[data-map="view"]');
  const hs = document.querySelector('[data-map-place="beach"]');
  if (!root || !hs) return false;
  const a = root.getBoundingClientRect(), b = hs.getBoundingClientRect();
  const midY = (b.top + b.bottom) / 2, midX = (b.left + b.right) / 2;
  return midX >= a.left && midX <= a.right && midY >= a.top && midY <= a.bottom;
});
ok(beachVisible, 'Yoo Plage is visible in the opening full-city view');
ok(await p.locator('[data-map="close"]').count() === 1, 'baked close (X) hotspot is present');
ok(await p.locator('[data-map="zin"]').count() === 1 && await p.locator('[data-map="zout"]').count() === 1, 'baked +/- zoom hotspots are present');
await shot('02_map_open');

// Close at city-fit first: after zoom the painted X leaves the viewport (known art limitation).
await p.tap('[data-map="close"]');
await p.waitForTimeout(450);
ok(await p.locator('[data-map="root"].visible').count() === 0, 'baked X closes the map in the full-city view');

await p.tap('.dock button[data-map="dock"]');
await p.waitForSelector('[data-map="root"].visible');

await p.tap('[data-map-place="beach"]');
await p.waitForSelector('[data-map="card"]', { timeout: 5000 });
ok(await p.locator('[data-map="card"]').count() === 1, 'location card opens on tap');
ok(await p.locator('[data-map="card"]').innerText().then((t) => t.includes('Yoo Plage') && t.includes('Ouvert')), 'card shows Yoo Plage / Ouvert');
ok(await p.locator('[data-map="go"]').isEnabled(), 'Visiter is enabled for Yoo Plage');
await shot('03_location_card');

await p.locator('[data-map="card-x"]').tap();
await p.waitForTimeout(200);
ok(await p.locator('[data-map="card"]').count() === 0, 'card close button works');

await p.tap('[data-map-place="club"]');
await p.waitForSelector('[data-map="card"]');
ok(await p.locator('[data-map="card"]').innerText().then((t) => t.includes('Yoo Games Club') && t.includes('Ouvert')), 'Games Club card is Ouvert');
ok(await p.locator('[data-map="go"]').isEnabled(), 'Visiter is enabled for Games Club');
await p.locator('[data-map="card-x"]').tap();

const s0 = await p.evaluate(() => getComputedStyle(document.querySelector('.pmap-world')).transform);
await p.tap('[data-map="zin"]');
await p.waitForTimeout(400);
const s1 = await p.evaluate(() => getComputedStyle(document.querySelector('.pmap-world')).transform);
ok(s0 !== s1, 'baked + button zooms the map');
await p.keyboard.press('Escape');
await p.waitForTimeout(450);
ok(await p.locator('[data-map="root"].visible').count() === 0, 'Escape closes the map after zoom');

await p.tap('.dock button[data-map="dock"]');
await p.waitForSelector('[data-map="root"].visible');
await p.tap('[data-map-place="beach"]');
await p.waitForSelector('[data-map="go"]:not([disabled])');
await p.tap('[data-map="go"]');
await p.waitForTimeout(500);
await shot('04_transition');
await p.waitForFunction(() => window.game.s.location === 'beach' && !window.game.s.transition, null, { timeout: 30000 })
  .then(() => ok(true, 'Visiter travels to Yoo Plage with the fade'), () => ok(false, 'Visiter travels to Yoo Plage'));
ok(await p.evaluate(() => window.game.s.panel) !== 'places', 'map closes after travel');

await p.tap('.dock button[data-map="dock"]');
await p.waitForSelector('[data-map="root"].visible');
await p.tap('[data-map-place="club"]');
await p.waitForSelector('[data-map="go"]:not([disabled])');
await p.tap('[data-map="go"]');
await p.waitForFunction(() => window.game.s.location === 'club' && !window.game.s.transition, null, { timeout: 30000 })
  .then(() => ok(true, 'Visiter travels to the Games Club with the fade'), () => ok(false, 'Visiter travels to the Games Club'));
ok(await p.evaluate(() => window.game.s.panel) !== 'places', 'map closes after travel to the club');

ok(errs.length === 0, 'no console/page errors ' + errs.join(' | '));
ok(bad.length === 0, 'no HTTP errors ' + bad.join(' '));
console.log(`SUMMARY player-map ${fails ? 'FAIL' : 'PASS'} (${passes} passed, ${fails} failed)`);
await b.close();
