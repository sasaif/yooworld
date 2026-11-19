import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Render-lifecycle regression e2e (QA phase 2): draw-call accounting incl. shadow pass, GPU buffers across
// apartment <-> beach trips (InstancedMesh disposal), studio open/close (DOM / WebGL context released, re-open works).
// Instruments WebGL from an init script only; app code is untouched. Headless SwiftShader: counts are meaningful,
// timings are not real-device numbers.
// usage: node tools/e2e-lifecycle.mjs [url] ; DEV=desktop|iphone15 (default desktop), TRIPS=4, STUDIO=4
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5230'}/`;
const DEVS = { desktop: { viewport: { width: 1440, height: 900 } }, iphone15: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
const devName = process.env.DEV ?? 'desktop'; const TRIPS = Number(process.env.TRIPS ?? 4), STUDIO = Number(process.env.STUDIO ?? 4);
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(DEVS[devName]);
await ctx.addInitScript(() => {
  sessionStorage.setItem('yw.portrait', '1');
  const C = (window.__lc = { draws: 0, buf: 0, ctx: [] }); const P = WebGL2RenderingContext.prototype;
  for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) { const o = P[f]; P[f] = function (...a) { C.draws++; return o.apply(this, a); }; }
  const cb = P.createBuffer, db = P.deleteBuffer; P.createBuffer = function () { const r = cb.call(this); if (r) C.buf++; return r; }; P.deleteBuffer = function (x) { if (x) C.buf--; return db.call(this, x); };
  const gc = HTMLCanvasElement.prototype.getContext; // WeakRefs: the probe itself must not keep contexts alive
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { const r = gc.call(this, t, ...a); if (r && /webgl/.test(t) && !C.ctx.some((w) => w.deref() === r)) C.ctx.push(new WeakRef(r)); return r; };
});
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Context Lost/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
let fails = 0; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); if (!c) fails++; };
const gcMetrics = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const { metrics } = await cdp.send('Performance.getMetrics'); const o = Object.fromEntries(metrics.map((x) => [x.name, x.value])); return { nodes: o.Nodes, listeners: o.JSEventListeners }; };
// per-frame raw GL draws vs what the game reports (window.__info, total = main + shadow)
const frames = () => p.evaluate(() => new Promise((res) => { const rows = []; let k = 0; const tick = () => { const n = window.__lc.draws; window.__lc.draws = 0; const i = window.__info; if (k++ > 2) rows.push({ gl: n, calls: i?.calls, main: i?.callsMain, shadow: i?.callsShadow }); if (rows.length < 15) requestAnimationFrame(tick); else res(rows); }; requestAnimationFrame(tick); }));
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
async function accounting(where) {
  const r = await frames(); const m = { gl: med(r.map((x) => x.gl)), calls: med(r.map((x) => x.calls)), main: med(r.map((x) => x.main)), shadow: med(r.map((x) => x.shadow)) };
  ok(m.calls === m.gl, `${where}: reported draw calls == raw WebGL draws (shadow pass included)`, m);
  ok(m.main + m.shadow === m.calls, `${where}: main + shadow == total`, m);
  return m;
}
const travel = async (to) => { await p.evaluate((t) => window.game.travel(t), to); await p.waitForTimeout(3000); };

await p.goto(url + (url.includes('?') ? '&' : '?') + 'lieu=appart&fresh=1&perf=1', { timeout: 120000 });
await p.waitForFunction(() => window.game?.s.ready && window.__info, null, { timeout: 180000 }); await p.waitForTimeout(3500);
const apt = await accounting('apartment'); ok(apt.shadow > 0, 'apartment: shadow pass is counted', apt);
await travel('beach'); await accounting('beach'); await travel('home');

// GPU buffers across round trips: must plateau (InstancedMesh instance buffers freed)
const bufs = [];
for (let i = 0; i < TRIPS; i++) { await travel('beach'); await travel('home'); bufs.push(await p.evaluate(() => window.__lc.buf)); }
ok(Math.max(...bufs.slice(1)) - bufs[1] <= 2 && bufs.at(-1) - bufs[1] <= 2, `GPU buffers stable over ${TRIPS} apartment<->beach trips`, bufs);

// studio open/close: DOM and WebGL context released, re-open renders
const nodes = []; let reopen = 0;
for (let i = 0; i < STUDIO; i++) {
  await p.evaluate(() => window.fashion.open('f')); await p.waitForTimeout(4500);
  if (await p.evaluate(() => !!window.fashion.s.studio && document.querySelectorAll('.st-preview canvas').length === 1 && document.querySelector('.st-preview canvas').width > 0)) reopen++;
  await p.evaluate(() => window.fashion.close('keep-owned')); await p.waitForTimeout(2500);
  nodes.push((await gcMetrics()).nodes);
}
ok(reopen === STUDIO, `studio opened and rendered ${STUDIO}/${STUDIO} times`, reopen);
ok(nodes.at(-1) - nodes[0] <= 60, `DOM nodes stable over ${STUDIO} studio cycles (was +~325/cycle)`, nodes);
await p.waitForTimeout(1000); await gcMetrics();
const gl = await p.evaluate(() => { const cs = window.__lc.ctx.map((w) => w.deref()); return { created: cs.length, live: cs.filter((c) => c && !c.isContextLost()).length, reachableLost: cs.filter((c) => c && c.isContextLost()).length }; });
ok(gl.live === 1, 'only the game WebGL context is still live after closing the studio', gl);
ok(gl.reachableLost <= 1, 'closed studio contexts are garbage-collected (at most the last one, held by React until the next commit)', gl);
ok(errs.length === 0, 'no page errors', errs.slice(0, 5));
await b.close(); console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
