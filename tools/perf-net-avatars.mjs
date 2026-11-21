import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// `?net=1` render budget: Yoo Plage with N remote avatars (the real `Character` renderer, lite crowd mode), same counters
// and warm-up as tools/perf-baseline.mjs (draw calls main + shadow, triangles, frame times; headless SwiftShader, so
// frame times are NOT real-device numbers). No server: N synthetic remotes are injected into the live transport's
// presence table (window.__live.sync, flag-on e2e handle) at fixed spots around the spawn; N = 0 is the flag-on scene
// without remotes, compared to the flag-OFF beach baseline in tools/perf-baseline.json.
// usage: node tools/perf-net-avatars.mjs [url]   NS=0,1,10,25 RUNS=3 FRAMES=30 DEV=desktop|iphone15 OUT=<json>
const url = (process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:5230/').replace(/[?#].*$/, '');
const NS = (process.env.NS ?? '0,1,10,25').split(',').map(Number);
const RUNS = Number(process.env.RUNS ?? 3), FRAMES = Number(process.env.FRAMES ?? 30), STABLE = Number(process.env.STABLE ?? 10);
const DEVS = { desktop: { w: 1440, h: 900, dpr: 1, touch: false }, iphone15: { w: 852, h: 393, dpr: 3, touch: true } };
const devName = process.env.DEV ?? 'desktop'; const dev = DEVS[devName];
const base = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'perf-baseline.json'), 'utf8')).scenes.beach[devName];
const BUDGET = 40;
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const INIT = () => {
  const C = (window.__pb = { draws: 0, off: 0, fb: null });
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!P) continue;
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) { const o = P[f]; if (!o) continue; P[f] = function (...a) { C.draws++; if (C.fb) C.off++; return o.apply(this, a); }; }
    const bf = P.bindFramebuffer; P.bindFramebuffer = function (t, f) { if (t !== 0x8ca8) C.fb = f; return bf.call(this, t, f); };
  }
};
const med = (a) => { const s = [...a].filter((v) => v != null).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const r2 = (v) => (v == null ? v : Math.round(v * 100) / 100);

async function run(n) {
  const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: dev.touch, hasTouch: dev.touch });
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url + '?lieu=plage&fresh=1&perf=1&net=1', { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__cam && window.__gl && window.__live, null, { timeout: 180000 });
  // inject N remotes (3 rings around the spawn, fixed positions), then wait until N remote avatars are in the scene
  await p.evaluate((n) => { window.__live.rc?.stop('perf');   // no server here: stop retries (each retry would reset the presence table)
    const s = window.__live.sync; s.you = 'perf-me';
    for (let i = 0; i < n; i++) { const a = (i / Math.max(1, n)) * Math.PI * 2, rad = 1.6 + (i % 3) * 1.1;
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      s.remotes.set(id, { id, label: `Joueur ${i}`, x: 7.2 + Math.cos(a) * rad, z: 4.2 + Math.sin(a) * rad, at: Date.now() }); }
    s.version++; }, n);
  await p.waitForFunction((n) => { let sc = window.__cam; while (sc.parent) sc = sc.parent; let k = 0; sc.traverse((o) => { if (o.userData?.avatarId?.startsWith?.('net-')) k++; }); return k >= n; }, n, { timeout: 120000, polling: 250 });
  await p.evaluate(async () => { const gl = window.__gl; let sc = window.__cam; while (sc.parent) sc = sc.parent; if (gl.compileAsync) await gl.compileAsync(sc, window.__cam); else gl.compile(sc, window.__cam); });
  await p.evaluate(() => { const gl = window.__gl, C = window.__pb; const rec = (window.__pbRec = { on: false, rows: [], last: 0, d0: 0, o0: 0, stable: 0, prev: null });
    const r = gl.render; gl.render = function (...a) { const out = r.apply(this, a); const now = performance.now(); const sig = gl.info.render.calls + '/' + (gl.info.programs?.length ?? 0);
      rec.stable = sig === rec.prev ? rec.stable + 1 : 0; rec.prev = sig;
      if (rec.on) rec.rows.push({ raw: C.draws - rec.d0, rawOff: C.off - rec.o0, tri: gl.info.render.triangles, dt: rec.last ? now - rec.last : null });
      rec.d0 = C.draws; rec.o0 = C.off; rec.last = now; return out; }; });
  await p.waitForFunction((k) => window.__pbRec.stable >= k, STABLE, { timeout: 90000, polling: 50 });
  await p.evaluate(() => { window.__pbRec.rows = []; window.__pbRec.last = 0; window.__pbRec.on = true; });
  await p.waitForFunction((k) => window.__pbRec.rows.length >= k, FRAMES, { timeout: 180000, polling: 50 });
  const rows = (await p.evaluate(() => { window.__pbRec.on = false; return window.__pbRec.rows; })).slice(0, FRAMES);
  const avatars = await p.evaluate(() => { let sc = window.__cam; while (sc.parent) sc = sc.parent; const s = new Set(); sc.traverse((o) => { const id = o.userData?.avatarId; if (id?.startsWith?.('net-')) s.add(id); }); return s.size; });
  await ctx.close();
  const dts = rows.map((r) => r.dt).filter((v) => v != null);
  return { total: med(rows.map((r) => r.raw)), shadow: med(rows.map((r) => r.rawOff)), main: med(rows.map((r) => r.raw - r.rawOff)), tri: med(rows.map((r) => r.tri)), p50: r2(pct(dts, 0.5)), p95: r2(pct(dts, 0.95)), avatars, errors: errs.slice(0, 3) };
}
const out = [];
for (const n of NS) {
  const runs = []; for (let i = 0; i < RUNS; i++) runs.push(await run(n));
  const row = { n, device: devName, total: med(runs.map((r) => r.total)), main: med(runs.map((r) => r.main)), shadow: med(runs.map((r) => r.shadow)), triangles: med(runs.map((r) => r.tri)),
    p50: med(runs.map((r) => r.p50)), p95: med(runs.map((r) => r.p95)), avatarsRendered: runs.map((r) => r.avatars), spread: [Math.min(...runs.map((r) => r.total)), Math.max(...runs.map((r) => r.total))], errors: [...new Set(runs.flatMap((r) => r.errors))] };
  row.vsBaseline = row.total - base.calls; row.perAvatar = n ? r2((row.total - (out[0]?.total ?? base.calls)) / n) : 0; row.overBudget = row.total >= BUDGET;
  out.push(row);
  console.log(`N=${n} (${devName}, ${RUNS}×${FRAMES}) draw total ${row.total} (principal ${row.main} + ombres ${row.shadow}) [${row.spread}] · tri ${row.triangles} · frame p50/p95 ${row.p50}/${row.p95} ms (SwiftShader) · avatars ${row.avatarsRendered} · vs base flag-off ${base.calls} : ${row.vsBaseline >= 0 ? '+' : ''}${row.vsBaseline} · par avatar ${row.perAvatar}${row.overBudget ? ` · AU-DESSUS DU BUDGET ${BUDGET}` : ''}${row.errors.length ? ' · errors ' + row.errors : ''}`);
}
await b.close();
fs.writeFileSync(process.env.OUT ?? path.join(os.tmpdir(), 'perf-net-avatars.json'), JSON.stringify({ recordedAt: new Date().toISOString(), baselineBeach: base, budget: BUDGET, rows: out }, null, 2));
