import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const pw = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * ?net=1 against the LIVE uat Worker, from the uat FRONT ORIGIN (cross-site: vercel.app -> workers.dev).
 * The page really runs on FRONT_ORIGIN for the browser: every request to that origin is answered from a local build
 * (DIST, built with VITE_YW_API_URL=<uat api>) through page routing, so Origin, cookies (SameSite / Partitioned /
 * third-party rules) and CORS are the browser's real cross-site behaviour; requests to the API go to the network.
 * Flow: A and B sign in through the dev form -> online, see each other -> A's session is revoked FROM ANOTHER CONTEXT
 * (Node: second sign-in of A, then revoke-other-sessions / revoke-sessions) -> A's UI offline < 2 s (HUD chip not
 * "En ligne" + no net-* avatar + remotes empty), no reconnect, sign-in form back. Also reports which auth path the
 * engine used: cross-site cookie alone (fetch without bearer) and/or the in-memory bearer token.
 * usage: ENGINE=chromium|webkit DIST=/tmp/dist-uat ACCOUNT_A=a.json ACCOUNT_B=b.json [REPS=2] node tools/e2e-net-uat.mjs
 * accounts: JSON files {email,password} (never printed). Rate limit: 5 sign-ins / IP, window restarted by each request.
 */
const API = 'https://yoland-api-uat.yoland.workers.dev', FRONT = process.env.FRONT_ORIGIN ?? 'https://yooworld-git-uat-saifeddine1.vercel.app';
const ENGINE = process.env.ENGINE ?? 'chromium', DIST = process.env.DIST ?? '/tmp/dist-uat', REPS = Number(process.env.REPS ?? 2), LIMIT_MS = 2000;
const accA = JSON.parse(fs.readFileSync(process.env.ACCOUNT_A, 'utf8')), accB = JSON.parse(fs.readFileSync(process.env.ACCOUNT_B, 'utf8'));
const launch = ENGINE === 'webkit' ? pw.webkit.launch() : pw.chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const b = await launch;
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + `[${ENGINE}] ` + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m }); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
async function page() {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 640 } });
  await ctx.route(`${FRONT}/**`, (route) => {
    const u = new URL(route.request().url()); let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' } });
  });
  const p = await ctx.newPage(); const errs = []; const sockets = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('websocket', (w) => sockets.push(w.url()));
  await p.goto(`${FRONT}/?net=1&lieu=beach`); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 240000 }); await p.waitForTimeout(1500);
  return { ctx, p, errs, sockets };
}
const signIn = async (P, acc) => {
  await P.p.waitForSelector('[data-net-login]', { timeout: 30000 });
  await P.p.fill('[data-net-login] input[name=email]', acc.email); await P.p.fill('[data-net-login] input[name=password]', acc.password);
  await P.p.click('[data-net-login] button');
};
const online = (P) => P.p.waitForFunction(() => window.__live.status === 'online' && window.__live.sync.remotes.size >= 1 && /En ligne/.test(document.querySelector('.chip.net')?.textContent ?? ''), null, { timeout: 30000 }).then(() => true, () => false);
const hasAvatar = (P, id) => P.p.evaluate((id) => { let sc = window.__cam; while (sc?.parent) sc = sc.parent; let f = false; sc?.traverse((o) => { if (o.userData?.avatarId === 'net-' + id) f = true; }); return f; }, id);
const authPaths = (P) => P.p.evaluate(async (api) => {
  const cookieOnly = await (await fetch(api + '/api/auth/get-session', { credentials: 'include' })).json().catch(() => null);
  return { cookieWorks: !!cookieOnly?.user?.id, bearerHeld: !!window.__live['bearer'] };
}, API);
async function nodeSession(acc) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: FRONT }, body: JSON.stringify({ email: acc.email, password: acc.password }) });
  if (r.status !== 200) throw new Error('node sign-in ' + r.status);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const A = await page(), B = await page();
await signIn(A, accA); await signIn(B, accB);
const okA = await online(A), okB = await online(B);
ok(okA && okB, 'setup: A and B signed in from the front origin (cross-site), online, see each other', { a: await A.p.evaluate(() => [window.__live.status, window.__live.lastError]), b: await B.p.evaluate(() => [window.__live.status, window.__live.lastError]) });
if (!(okA && okB)) { await b.close(); process.exit(1); }
const ap = await authPaths(A); console.log(`AUTH [${ENGINE}] cross-site cookie alone works: ${ap.cookieWorks}; bearer token held (memory): ${ap.bearerHeld}`);
ok(A.sockets.every((u) => u.startsWith('wss://yoland-api-uat.yoland.workers.dev/ws/')), 'WebSocket goes to the uat Worker (wss)', A.sockets.map((u) => u.split('?')[0]));
const bId = await B.p.evaluate(() => window.__live.sync.you), aId = await A.p.evaluate(() => window.__live.sync.you);
const times = [];
for (let rep = 0; rep < REPS; rep++) {
  const how = rep % 2 ? 'revoke-sessions' : 'revoke-other-sessions';
  if (rep) { await sleep(Number(process.env.REP_GAP_MS ?? 65000)); await signIn(A, accA); if (!(await online(A))) { ok(false, `rep ${rep + 1}: A back online after re-sign-in`, await A.p.evaluate(() => [window.__live.status, window.__live.lastError, document.querySelector('[data-net-login] [data-err]')?.textContent ?? null])); break; } }
  await A.p.waitForFunction((id) => { let sc = window.__cam; while (sc?.parent) sc = sc.parent; let f = false; sc?.traverse((o) => { if (o.userData?.avatarId === 'net-' + id) f = true; }); return f; }, bId, { timeout: 30000 }).catch(() => {});
  ok(await hasAvatar(A, bId), `rep ${rep + 1}: before revoke, A shows B's avatar`);
  const cookie = await nodeSession(accA); const wsBefore = A.sockets.length;
  await A.p.evaluate(() => {
    const w = (window.__u5 = { hudOff: 0, avatarsGone: 0, status: 0, wsClose: 0 });
    window.__live['rc'].ws?.addEventListener('close', () => { w.wsClose = Date.now(); });
    const check = () => { const now = Date.now();
      if (!w.status && window.__live.status !== 'online') w.status = now;
      if (!w.hudOff && !/En ligne/.test(document.querySelector('.chip.net')?.textContent ?? '')) w.hudOff = now;
      if (!w.avatarsGone) { let sc = window.__cam; while (sc?.parent) sc = sc.parent; let f = false; sc?.traverse((o) => { if (String(o.userData?.avatarId ?? '').startsWith('net-')) f = true; }); if (!f && window.__live.sync.remotes.size === 0) w.avatarsGone = now; } };
    const raf = () => { check(); if (!(w.hudOff && w.avatarsGone && w.wsClose)) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
    const iv = setInterval(() => { check(); if (w.hudOff && w.avatarsGone && w.wsClose) clearInterval(iv); }, 5);
  });
  const t0 = Date.now();
  const r = await fetch(`${API}/api/auth/${how}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: FRONT, cookie }, body: '{}' });
  const tResp = Date.now();
  await A.p.waitForFunction(() => window.__u5.hudOff && window.__u5.avatarsGone && (window.__u5.wsClose || true), null, { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const u = await A.p.evaluate(() => window.__u5); const d = (t) => (t ? t - t0 : null);
  const m = { how, http: r.status, response: tResp - t0, hudOff: d(u.hudOff), avatarsGone: d(u.avatarsGone), nativeClose: d(u.wsClose) };
  times.push(m);
  ok(r.status === 200 && m.hudOff != null && m.hudOff < LIMIT_MS && m.avatarsGone != null && m.avatarsGone < LIMIT_MS, `rep ${rep + 1}: ${how} -> A offline (HUD) and remote avatars gone in < ${LIMIT_MS} ms`, m);
  await sleep(2000);
  const s = await A.p.evaluate(() => ({ status: window.__live.status, why: window.__live.lastError, rc: window.__live['rc'].state, form: !!document.querySelector('[data-net-login]'), bearer: !!window.__live['bearer'] }));
  ok(s.status === 'offline' && s.rc === 'stopped' && A.sockets.length === wsBefore && s.form && !s.bearer, `rep ${rep + 1}: no auto-reconnect, sign-in form back, bearer token dropped`, { ...s, newSockets: A.sockets.length - wsBefore });
  ok(!(await hasAvatar(B, aId)) && await B.p.evaluate(() => window.__live.status === 'online'), `rep ${rep + 1}: B stays online and no longer shows A`);
}
const st = (k) => { const v = times.map((t) => t[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? { min: v[0], median: v[Math.floor((v.length - 1) / 2)], max: v.at(-1) } : null; };
console.log(`TIMES [${ENGINE}] ms from the revoke request start:`, JSON.stringify({ n: times.length, response: st('response'), hudOff: st('hudOff'), avatarsGone: st('avatarsGone'), nativeClose: st('nativeClose') }));
ok(A.errs.length === 0 && B.errs.length === 0, 'no page error', [...A.errs, ...B.errs].slice(0, 5));
await b.close();
console.log(`SUMMARY net-uat ${ENGINE}: ${results.filter((r) => r.ok).length}/${results.length} passed`);
