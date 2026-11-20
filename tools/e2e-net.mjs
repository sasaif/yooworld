import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * `?net=1` dev mode (Phase B) on the real built game.
 *  OFF (default URL): no request to the game server, no login form, no net-only chunk loaded, same storage keys as the
 *    baseline build (BASE_URL) when given.
 *  ON (two browsers, ?net=1&lieu=beach&server=SERVER): sign in through the dev form, both see each other (presence),
 *    movement of A (keyboard) reaches B, chat both ways, reconnect after the socket drops.
 * usage: node tools/e2e-net.mjs <app url> <server url> <emailA> <emailB> <password> [baseline app url]
 */
const [url, server, emailA, emailB, password, baseUrl] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m }); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = new URL(server);

async function page(u, settle = 1500) {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 640 } });
  const p = await ctx.newPage(); const reqs = []; const errs = [];
  p.on('request', (r) => reqs.push(r.url())); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(u); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(settle); if (settle > 2000) await p.waitForLoadState('networkidle').catch(() => {});
  return { ctx, p, reqs, errs };
}
// storage key NAMES (profile ids are random per fresh profile: normalised) and request paths (bundle hash normalised)
const keys = (p) => p.evaluate(() => ({ local: Object.keys(localStorage).map((k) => k.replace(/p_[a-z0-9]+/, 'p_*')).sort(), session: Object.keys(sessionStorage).sort() }));
const paths = (reqs) => [...new Set(reqs.filter((r) => !r.startsWith('blob:')).map((r) => new URL(r).pathname.replace(/-[A-Za-z0-9_]{8}\./, '-H.')))].sort();

// ---------- flag OFF ----------
const off = await page(url + '?lieu=beach', 12000);
ok(!off.reqs.some((r) => new URL(r).port === srv.port), 'flag off: no request to the game server', off.reqs.filter((r) => new URL(r).port === srv.port));
ok(!off.reqs.some((r) => /RemotePlayers/.test(r)), 'flag off: net-only chunk (RemotePlayers) not loaded');
ok(await off.p.evaluate(() => !document.querySelector('[data-net-login]') && !('__live' in window) && window.game.net.status === 'offline'), 'flag off: no login form, no live transport, status offline');
const offKeys = await keys(off.p);
if (baseUrl) {
  const base = await page(baseUrl + '?lieu=beach', 12000);
  const bk = await keys(base.p);
  ok(JSON.stringify(bk) === JSON.stringify(offKeys), 'flag off: same storage keys as the baseline build', { new: offKeys, base: bk });
  ok(JSON.stringify(paths(base.reqs)) === JSON.stringify(paths(off.reqs)), 'flag off: same requested resources as the baseline build', { onlyNew: paths(off.reqs).filter((x) => !paths(base.reqs).includes(x)), onlyBase: paths(base.reqs).filter((x) => !paths(off.reqs).includes(x)) });
  await base.ctx.close();
}
ok(off.errs.length === 0, 'flag off: no page error', off.errs);
await off.ctx.close();

// ---------- flag ON ----------
const on = `${url}?net=1&lieu=beach&server=${encodeURIComponent(server)}`;
const A = await page(on), B = await page(on);
for (const [P, email] of [[A, emailA], [B, emailB]]) {
  await P.p.waitForSelector('[data-net-login]', { timeout: 15000 });
  await P.p.fill('[data-net-login] input[name=email]', email); await P.p.fill('[data-net-login] input[name=password]', password);
  await P.p.click('[data-net-login] button');
}
const st = (P) => P.p.evaluate(() => ({ status: window.__live.status, you: window.__live.sync.you, remotes: [...window.__live.sync.remotes.values()].map((r) => ({ id: r.id, x: r.x, z: r.z })), corr: window.__live.sync.corrections }));
await A.p.waitForFunction(() => window.__live.status === 'online' && window.__live.sync.remotes.size >= 1, null, { timeout: 20000 }).catch(() => {});
await B.p.waitForFunction(() => window.__live.status === 'online' && window.__live.sync.remotes.size >= 1, null, { timeout: 20000 }).catch(() => {});
let sa = await st(A), sb = await st(B);
const formErr = (P) => P.p.evaluate(() => document.querySelector('[data-net-login] [data-err]')?.textContent ?? null);
ok(sa.status === 'online' && sb.status === 'online', 'flag on: both signed in through the dev form and online (server rate limit: 5 sign-ins / min / IP)', { a: sa.status, b: sb.status, formA: await formErr(A), formB: await formErr(B) });
ok(sa.remotes.some((r) => r.id === sb.you) && sb.remotes.some((r) => r.id === sa.you), 'presence: each sees the other', { a: sa.remotes, b: sb.remotes });
ok(await A.p.evaluate(() => !document.querySelector('[data-net-login]')), 'login form removed after sign-in');

const before = sb.remotes.find((r) => r.id === sa.you);
const localA0 = await A.p.evaluate(() => { const c = window.__world.chars[window.game.s.activeChar]; return { x: c.pos.x, z: c.pos.z }; });
await A.p.keyboard.down('ArrowRight'); await sleep(3000); await A.p.keyboard.up('ArrowRight'); await sleep(1500);
const localA1 = await A.p.evaluate(() => { const c = window.__world.chars[window.game.s.activeChar]; return { x: c.pos.x, z: c.pos.z }; });
sb = await st(B); const after = sb.remotes.find((r) => r.id === sa.you) ?? { x: NaN, z: NaN };
const moved = Math.hypot(localA1.x - localA0.x, localA1.z - localA0.z);
const gap = Math.hypot(after.x - localA1.x, after.z - localA1.z);
ok(moved > 0.3, 'movement: A walked locally (keyboard, unchanged controls)', { moved: +moved.toFixed(2) });
ok(gap < 0.15, 'movement: B sees A where A really is (≤ 15 cm after settling)', { before, after, localA1, gap: +gap.toFixed(3), corrections: (await st(A)).corr });

const tag = `net-${Date.now()}`;
await A.p.evaluate((t) => window.game.sendChat(t + ' A'), tag);
await B.p.waitForFunction((t) => window.game.chat.history().some((m) => m.text === t + ' A'), tag, { timeout: 5000 }).catch(() => {});
const hb = await B.p.evaluate((t) => window.game.chat.history().filter((m) => m.text.startsWith(t)), tag);
ok(hb.length === 1 && !hb[0].local && /^Joueur /.test(hb[0].from), 'chat: A -> B delivered once, shown as a remote player', hb);
await B.p.evaluate((t) => window.game.chat.history && window.game.sendChat(t + ' B'), tag);
await A.p.waitForFunction((t) => window.game.chat.history().some((m) => m.text === t + ' B'), tag, { timeout: 5000 }).catch(() => {});
const ha = await A.p.evaluate((t) => window.game.chat.history().filter((m) => m.text.startsWith(t)), tag);
ok(ha.length === 2 && ha.filter((m) => m.local).length === 1, 'chat: B -> A delivered once; own message not duplicated by the echo', ha.map((m) => [m.from, m.text, m.local]));

// reconnect: drop B's socket from the page (network blip) -> Reconnector gets a fresh ticket and rejoins
await B.p.evaluate(() => { window.__live['rc'].ws?.close(4000, 'test drop'); });
await B.p.waitForFunction(() => window.__live.status === 'online' && window.__live.sync.remotes.size >= 1, null, { timeout: 15000 }).catch(() => {});
sb = await st(B);
ok(sb.status === 'online' && sb.remotes.some((r) => r.id === sa.you), 'reconnect: B back online with a fresh ticket, still sees A', sb);
const histB = await B.p.evaluate((t) => window.game.chat.history().filter((m) => m.text.startsWith(t)).length, tag);
ok(histB === 2, 'reconnect: replayed history deduplicated (no duplicate chat lines)', { histB });
ok(A.errs.length === 0 && B.errs.length === 0, 'flag on: no page error', [...A.errs, ...B.errs]);
await b.close();
const pass = results.filter((r) => r.ok).length; console.log(`SUMMARY net: ${pass}/${results.length} passed`);
