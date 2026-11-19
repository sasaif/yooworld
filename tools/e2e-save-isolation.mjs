// P0.A save-isolation e2e (REQUIRED before publishing any test folder). Real Chrome, real localStorage, ONE origin.
// Mimics GitHub Pages: http://127.0.0.1:<PORT>/yooworld/ = prod root build, /yooworld/combined-1/ = test build.
//  A: seed distinctive root (prod) keys -> play/buy/save in /yooworld/combined-1/ (no ?fresh) -> every root key
//     byte-identical, no new un-namespaced key, combined-1 keys created and changed.
//  B: seed distinctive combined-1 keys -> play/buy/save in /yooworld/ -> every combined-1 key byte-identical,
//     no other env key appears, root keys created.
//  C: build guard (a subfolder configured as prod must fail) + ?fresh on combined-1 leaves root untouched.
// usage: node tools/e2e-save-isolation.mjs [--build]   (PORT=5571, OUT=shots/tmp/save-isolation, git-ignored)
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path'; import http from 'http'; import { execSync, spawnSync } from 'child_process';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const PORT = Number(process.env.PORT ?? 5571); const OUT = path.resolve(process.env.OUT ?? 'shots/tmp/save-isolation'); const ROOT_DIR = path.join(OUT, 'yooworld'); const C1_DIR = path.join(ROOT_DIR, 'combined-1');
let failed = 0; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); if (!c) { failed++; process.exitCode = 1; } };

if (process.argv.includes('--build') || !fs.existsSync(path.join(C1_DIR, 'index.html'))) {
  fs.rmSync(OUT, { recursive: true, force: true });
  const run = (env, outDir) => execSync(`npx vite build --outDir ${JSON.stringify(outDir)} --emptyOutDir`, { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...env } });
  console.log('build prod root   GH_PAGES_BASE=/yooworld/'); run({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/', VITE_YW_ENV: '' }, ROOT_DIR);
  console.log('build combined-1  GH_PAGES_BASE=/yooworld/combined-1/'); run({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/combined-1/', VITE_YW_ENV: '' }, C1_DIR);
}
// bundles must carry the right env id (belt and braces: grep the built JS)
const bundleEnv = (dir) => { const js = fs.readdirSync(path.join(dir, 'assets')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, 'assets', f), 'utf8')).join('\n'); return { prodKeys: js.includes('"yooworld:e:"') || js.includes('yooworld:e:'), c1: js.includes('test/combined-1'), prod: /["']prod["']/.test(js) }; };
ok(bundleEnv(C1_DIR).c1, 'combined-1 bundle is built for env test/combined-1');

// --- one-origin static server -------------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>seed</title>'); }
  let f = path.join(OUT, u); if (!f.startsWith(OUT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });

const isProdKey = (k) => (k.startsWith('yooworld:') && !k.startsWith('yooworld:e:')) || k.startsWith('yw.');
const dump = (p) => p.evaluate(() => ({ local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])), session: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])) }));
async function boot(p, url) {
  // unload the previous WebGL page first (headless SwiftShader Chrome sometimes dies on a direct heavy -> heavy reload)
  if (p.url().includes('/yooworld/')) { await p.goto(p.url().split('/yooworld/')[0] + '/__blank'); await p.waitForTimeout(500); }
  await p.goto(url); await p.waitForFunction(() => window.game?.s.ready && window.economy && window.fashion, null, { timeout: 180000 }); await p.waitForTimeout(1500);
}
/** Real writes through the game's own code paths (the UI calls the same methods) + real HUD clicks for prefs. */
async function play(p, tag) {
  const r = await p.evaluate(async (tag) => {
    const g = window.game, eco = window.economy, fa = window.fashion; const log = {};
    g.rename('Iso ' + tag); log.name = g.s.profile.name;
    const def = Object.values(g.cat).filter((d) => d.price > 0 && d.layer !== 'top').sort((a, b) => a.price - b.price)[0];
    const g0 = eco.goldBalance(); g.buyItem(def); if (g.s.placing) g.confirmPlace(); log.furniture = def.id; log.goldAfterFurniture = eco.goldBalance(); log.gold0 = g0;
    try { await eco.checkout(['tee_heart'], 'iso-' + tag + '-' + Date.now()); log.boughtTee = true; } catch (e) { log.teeErr = String(e.message); }
    try { log.daily = await eco.claimDaily(); } catch (e) { log.dailyErr = String(e.message); }
    const look = { ...fa.s.looks.f, slots: { ...fa.s.looks.f.slots, top: 'tee_heart' } }; await eco.saveLook(look);
    log.gold = eco.goldBalance(); return log;
  }, tag);
  // prefs through real HUD buttons
  const click = async (sel) => { const el = await p.$(sel); if (el) { await el.evaluate((e) => e.click()); await p.waitForTimeout(250); return true; } return false; };
  r.cam = await click('.chip.cam');
  r.places = await click('button[aria-label^="Lieux"]'); await p.evaluate(() => window.game.store.set({ panel: null }));
  await p.evaluate(() => window.game.setPanel('chat')); await p.waitForTimeout(200); r.chat = await click('.chat-fold'); await p.evaluate(() => window.game.store.set({ panel: null }));
  await p.evaluate(() => window.game.setPanel('settings')); await p.waitForTimeout(200); r.ctl = await click('.ctl-opt:not(.on)'); await p.evaluate(() => window.game.store.set({ panel: null }));
  r.rotate = await click('.rotate-skip');
  await p.waitForTimeout(800); // GameController.persist debounce (250 ms)
  return r;
}

// ---------- A: combined-1 must not touch root --------------------------------------------------------------
const ROOT_SEED = {
  'yooworld:eco:dev': '{"version":1,"ROOT_SENTINEL":"eco ✓ é 💎","accounts":{"test-player":{"gold":{"balance":4242}}}}',
  'yooworld:profile': '{"schema":1,"savedAt":1,"data":{"version":1,"id":"p_root","name":"RootJuanita ✓","appearance":{"body":"f"},"homeId":"home_p_root","friends":[],"createdAt":1}}',
  'yooworld:apt:home_isolation': '{"schema":1,"savedAt":1,"data":{"ROOT_SENTINEL":"apt"}}',
  'yooworld:apt:home_p_root': '{"schema":1,"savedAt":1,"data":{"ROOT_SENTINEL":"apt2","items":[]}}',
  'yooworld:inv:p_isolation': '{"schema":1,"savedAt":1,"data":{"ROOT_SENTINEL":"inv"}}',
  'yooworld:look:test-player:f': '{"v":1,"body":"f","slots":{"hair":"ROOT_SENTINEL_hair"}}',
  'yw.camView': 'avatar', 'yw.controls.v1': '{"touchTapToMove":true,"ROOT":1}', 'yw.chatCollapsed': '1', 'yw.placesSeen': 'ROOT', 'yw.lieuDefaultUsed': 'ROOT', 'yw.hairSheen': 'ROOT-on',
};
const ROOT_SESSION = { 'yw.portrait': 'ROOT-1', 'yw.lieuDefaultUsed': 'ROOT-1' };
{
  console.log('--- A: /yooworld/combined-1/ vs root keys');
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('crash', () => console.log('!! renderer crashed (headless Chrome), rerun the script'));
  await p.goto(BASE + '/__blank');
  await p.evaluate(([l, s]) => { localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(l)) localStorage.setItem(k, v); for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, v); }, [ROOT_SEED, ROOT_SESSION]);
  const before = await dump(p);
  await boot(p, BASE + '/yooworld/combined-1/');
  const env = await p.evaluate(() => window.__saveEnv); ok(env.id === 'test/combined-1' && !env.isProd, 'page reports env test/combined-1', env);
  const r = await play(p, 'A'); console.log('     played:', JSON.stringify(r));
  ok(r.gold < r.gold0, 'Gold spent in combined-1', { from: r.gold0, to: r.gold });
  await boot(p, BASE + '/yooworld/combined-1/'); // reload: the test env's own save persisted
  const re = await p.evaluate(() => ({ name: window.game.s.profile.name, gold: window.economy.goldBalance(), owns: window.economy.owns('tee_heart') }));
  ok(re.name === 'Iso A' && re.owns && re.gold === r.gold, 'combined-1 progress persisted in its own keyspace after reload', re);
  const after = await dump(p);
  for (const [k, v] of Object.entries(ROOT_SEED)) ok(after.local[k] === v, `root key byte-identical: ${k}`);
  for (const [k, v] of Object.entries(ROOT_SESSION)) ok(after.session[k] === v, `root session key byte-identical: ${k}`);
  const newRoot = Object.keys(after.local).filter((k) => isProdKey(k) && !(k in before.local)); ok(newRoot.length === 0, 'no new un-namespaced localStorage key', newRoot);
  const newRootS = Object.keys(after.session).filter((k) => isProdKey(k) && !(k in before.session)); ok(newRootS.length === 0, 'no new un-namespaced sessionStorage key', newRootS);
  const foreign = [...Object.keys(after.local), ...Object.keys(after.session)].filter((k) => !isProdKey(k) && !k.startsWith('yooworld:e:test.combined-1:') && !k.startsWith('yw:e:test.combined-1:'));
  ok(foreign.length === 0, 'combined-1 wrote only its own prefixes', foreign);
  const c1 = Object.keys(after.local).filter((k) => k.startsWith('yooworld:e:test.combined-1:') || k.startsWith('yw:e:test.combined-1:')).sort();
  for (const k of ['yooworld:e:test.combined-1:eco:dev', 'yooworld:e:test.combined-1:profile', 'yooworld:e:test.combined-1:look:test-player:f', 'yw:e:test.combined-1:camView', 'yw:e:test.combined-1:placesSeen', 'yw:e:test.combined-1:chatCollapsed', 'yw:e:test.combined-1:controls.v1'])
    ok(c1.includes(k), `combined-1 key written: ${k}`);
  ok(c1.some((k) => k.startsWith('yooworld:e:test.combined-1:apt:')) && c1.some((k) => k.startsWith('yooworld:e:test.combined-1:inv:')), 'combined-1 apartment + inventory written');
  const eco = JSON.parse(after.local['yooworld:e:test.combined-1:eco:dev']); ok(eco.accounts['test-player'].gold.balance === r.gold && !!eco.accounts['test-player'].owned.tee_heart, 'combined-1 economy changed (Gold + owned tee)', { gold: eco.accounts['test-player'].gold.balance });
  ok(after.session['yw:e:test.combined-1:lieuDefaultUsed'] === '1', 'session flag namespaced (yw:e:test.combined-1:lieuDefaultUsed)');
  console.log('     combined-1 keys:', c1.join(', '));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  // C2: ?fresh on combined-1 leaves root untouched too
  await boot(p, BASE + '/yooworld/combined-1/?fresh'); await p.evaluate(() => { window.game.rename('FreshOnly'); }); await p.waitForTimeout(600);
  const af = await dump(p); ok(Object.entries(ROOT_SEED).every(([k, v]) => af.local[k] === v), 'C: ?fresh on combined-1 leaves every root key byte-identical');
  fs.mkdirSync(path.join(OUT, 'report'), { recursive: true }); fs.writeFileSync(path.join(OUT, 'report', 'A-keys.json'), JSON.stringify({ before, after }, null, 1));
  await ctx.close();
}

// ---------- B: root must not touch combined-1 ----------------------------------------------------------------
const C1_SEED = {
  'yooworld:e:test.combined-1:eco:dev': '{"version":1,"C1_SENTINEL":"eco ✓ 💎","accounts":{}}',
  'yooworld:e:test.combined-1:profile': '{"schema":1,"savedAt":1,"data":{"C1_SENTINEL":"profile"}}',
  'yooworld:e:test.combined-1:apt:home_x': '{"C1_SENTINEL":"apt"}', 'yooworld:e:test.combined-1:inv:p_x': '{"C1_SENTINEL":"inv"}',
  'yooworld:e:test.combined-1:look:test-player:f': '{"C1":"look"}', 'yooworld:e:test.combined-1:backup:snap': '[]',
  'yw:e:test.combined-1:camView': 'avatar', 'yw:e:test.combined-1:controls.v1': '{"C1":1}', 'yw:e:test.combined-1:chatCollapsed': 'C1', 'yw:e:test.combined-1:placesSeen': 'C1', 'yw:e:test.combined-1:hairSheen': 'C1',
};
const C1_SESSION = { 'yw:e:test.combined-1:portrait': 'C1', 'yw:e:test.combined-1:lieuDefaultUsed': 'C1' };
{
  console.log('--- B: /yooworld/ (prod root) vs combined-1 keys');
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('crash', () => console.log('!! renderer crashed (headless Chrome), rerun the script'));
  await p.goto(BASE + '/__blank');
  await p.evaluate(([l, s]) => { localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(l)) localStorage.setItem(k, v); for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, v); }, [C1_SEED, C1_SESSION]);
  await boot(p, BASE + '/yooworld/');
  const env = await p.evaluate(() => window.__saveEnv); ok(env.id === 'prod' && env.isProd, 'page reports env prod', env);
  const r = await play(p, 'B'); console.log('     played:', JSON.stringify(r));
  const after = await dump(p);
  for (const [k, v] of Object.entries(C1_SEED)) ok(after.local[k] === v, `combined-1 key byte-identical: ${k}`);
  for (const [k, v] of Object.entries(C1_SESSION)) ok(after.session[k] === v, `combined-1 session key byte-identical: ${k}`);
  const envKeys = [...Object.keys(after.local), ...Object.keys(after.session)].filter((k) => !isProdKey(k) && !(k in C1_SEED) && !(k in C1_SESSION));
  ok(envKeys.length === 0, 'prod root wrote no env-namespaced key', envKeys);
  for (const k of ['yooworld:eco:dev', 'yooworld:profile', 'yooworld:look:test-player:f', 'yw.camView', 'yw.placesSeen', 'yw.chatCollapsed', 'yw.controls.v1']) ok(k in after.local, `root (legacy) key written by prod: ${k}`);
  ok(after.session['yw.lieuDefaultUsed'] === '1', 'prod session flag keeps its legacy name (yw.lieuDefaultUsed)');
  ok(JSON.parse(after.local['yooworld:eco:dev']).accounts['test-player'].gold.balance === r.gold && r.gold < r.gold0, 'root economy changed', { gold: r.gold });
  console.log('     root keys:', Object.keys(after.local).filter(isProdKey).sort().join(', '));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  fs.writeFileSync(path.join(OUT, 'report', 'B-keys.json'), JSON.stringify(after, null, 1));
  await ctx.close();
}

// ---------- D: safe load on the prod root: unreadable saves -> recovery panel, nothing written --------------------
{
  console.log('--- D: prod root with corrupt / newer-schema saves (P0.B)');
  const SEED = {
    'yooworld:profile': '{"schema":1,"savedAt":1,"data":{"version":1,"id":"p_d","name":"D ✓","appearance":{"body":"f"},"homeId":"home_p_d","friends":[],"createdAt":1}}',
    'yooworld:apt:home_p_d': '{"schema":1,"savedAt":1,"data":{"items":[{"uid":"x"', // truncated JSON
    'yooworld:inv:p_d': '{"schema":9,"savedAt":1,"data":{"ownerId":"p_d","items":{}}}', // written by a "newer" build
    'yooworld:eco:dev': '{"version":2,"accounts":{"test-player":{}}}',
  };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('crash', () => console.log('!! renderer crashed (headless Chrome), rerun the script'));
  await p.goto(BASE + '/__blank'); await p.evaluate((l) => { localStorage.clear(); for (const [k, v] of Object.entries(l)) localStorage.setItem(k, v); }, SEED);
  await p.goto(BASE + '/yooworld/'); await p.waitForSelector('[data-testid="save-recovery"]', { timeout: 180000 }); await p.waitForTimeout(1500);
  const txt = await p.textContent('[data-testid="save-recovery"]'); ok(/Rien n’a été effacé/.test(txt) && /apt:home_p_d/.test(txt) && /inv:p_d/.test(txt) && /eco:dev/.test(txt), 'recovery panel lists the 3 unreadable records', txt.slice(0, 160));
  ok(await p.evaluate(() => !window.game.s.ready), 'game not started on top of an unreadable save');
  fs.mkdirSync(path.join(OUT, 'report'), { recursive: true }); await p.screenshot({ path: path.join(OUT, 'report', 'D-recovery.png') });
  let d = await dump(p); for (const [k, v] of Object.entries(SEED)) ok(d.local[k] === v, `untouched while panel is open: ${k}`);
  ok(['yooworld:apt:home_p_d', 'yooworld:inv:p_d', 'yooworld:eco:dev'].every((k) => JSON.parse(d.local['yooworld:backup:raw:' + k.slice('yooworld:'.length)] ?? '[]')[0]?.raw === SEED[k]), 'raw copies kept in yooworld:backup:raw:*');
  await p.click('text=Continuer en session temporaire'); await p.waitForFunction(() => window.game.s.ready, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(async () => { window.game.rename('Temp'); await window.economy.checkout(['tee_heart'], 'tmp-1'); }); await p.waitForTimeout(800);
  ok(await p.isVisible('.save-temp'), 'temporary-session badge shown');
  d = await dump(p); for (const [k, v] of Object.entries(SEED)) ok(d.local[k] === v, `still byte-identical after playing a temporary session: ${k}`);
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await ctx.close();
}

// ---------- C: build guard ---------------------------------------------------------------------------------
{
  const bad = spawnSync(process.execPath, ['tools/check-save-env.mjs'], { env: { ...process.env, GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/combined-1/', VITE_YW_ENV: 'prod' }, encoding: 'utf8' });
  ok(bad.status !== 0, 'C: subfolder build configured as prod exits non-zero', (bad.stderr || '').trim());
  const nobase = spawnSync(process.execPath, ['tools/check-save-env.mjs'], { env: { ...process.env, GH_PAGES: '1', GH_PAGES_BASE: '', VITE_YW_ENV: '' }, encoding: 'utf8' });
  ok(nobase.status !== 0, 'C: gh-pages build without GH_PAGES_BASE exits non-zero', (nobase.stderr || '').trim());
  const vb = spawnSync('npx', ['vite', 'build', '--outDir', path.join(OUT, 'should-not-exist')], { env: { ...process.env, GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/combined-1/', VITE_YW_ENV: 'prod' }, encoding: 'utf8' });
  ok(vb.status !== 0 && !fs.existsSync(path.join(OUT, 'should-not-exist', 'index.html')), 'C: vite build itself fails closed (subfolder as prod)');
}
await b.close(); server.close();
console.log(failed ? `\nSAVE ISOLATION: ${failed} FAILED` : '\nSAVE ISOLATION: ALL PASS');
