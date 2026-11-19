import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Render-lifecycle regression e2e (QA phase 2): draw-call accounting incl. shadow pass, GPU buffers across
// apartment <-> beach trips (InstancedMesh disposal), studio open/close (DOM / WebGL context released, re-open works).
// Instruments WebGL from an init script only; app code is untouched. Headless SwiftShader: counts are meaningful,
// timings are not real-device numbers.
// Every step waits on observable state (location, steady render, studio canvas drawing, contexts lost), never on a
// fixed sleep, so a slow / loaded machine only makes it slower, not flaky.
// usage: node tools/e2e-lifecycle.mjs [url] ; DEV=desktop|iphone15 (default desktop), TRIPS=4, STUDIO=4
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5230'}/`;
const DEVS = { desktop: { viewport: { width: 1440, height: 900 } }, iphone15: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
const devName = process.env.DEV ?? 'desktop'; const TRIPS = Number(process.env.TRIPS ?? 4), STUDIO = Number(process.env.STUDIO ?? 4);
const STEADY = 8; // frames with identical draw count / program count / live buffers = settled scene
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(DEVS[devName]);
await ctx.addInitScript(() => {
  sessionStorage.setItem('yw.portrait', '1');
  const C = (window.__lc = { buf: 0, ctx: [] });
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!P) continue;
    // draws are counted per context (a property on the context object) so the game and the studio never mix
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) { const o = P[f]; if (!o) continue; P[f] = function (...a) { this.__lcDraws = (this.__lcDraws ?? 0) + 1; return o.apply(this, a); }; }
    const cb = P.createBuffer, db = P.deleteBuffer; P.createBuffer = function () { const r = cb.call(this); if (r) C.buf++; return r; }; P.deleteBuffer = function (x) { if (x) C.buf--; return db.call(this, x); };
  }
  const gc = HTMLCanvasElement.prototype.getContext; // WeakRefs: the probe itself must not keep contexts alive
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { const r = gc.call(this, t, ...a); if (r && /webgl/.test(t) && !C.ctx.some((w) => w.deref() === r)) C.ctx.push(new WeakRef(r)); return r; };
});
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Context Lost/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
let fails = 0; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); if (!c) fails++; };
const gcMetrics = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const { metrics } = await cdp.send('Performance.getMetrics'); const o = Object.fromEntries(metrics.map((x) => [x.name, x.value])); return { nodes: o.Nodes, listeners: o.JSEventListeners }; };
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

await p.goto(url + (url.includes('?') ? '&' : '?') + 'lieu=appart&fresh=1&perf=1', { timeout: 120000 });
await p.waitForFunction(() => window.game?.s.ready && window.__gl && window.__cam, null, { timeout: 180000 });
// per-frame recorder on the game renderer (outermost wrapper): exact values of the frame that just rendered
await p.evaluate(() => { const gl = window.__gl, ctxGL = gl.getContext(), C = window.__lc;
  const R = (window.__lcR = { rows: [], d0: 0, steady: 0, prev: '', mark: null, changed: true });
  const r = gl.render; gl.render = function (...a) { const out = r.apply(this, a); const d = ctxGL.__lcDraws ?? 0;
    const row = { calls: gl.info.render.calls, raw: d - R.d0, prog: gl.info.programs?.length ?? 0, buf: C.buf, loc: window.game.s.location };
    R.d0 = d; const sig = `${row.calls}/${row.prog}/${row.buf}`; R.steady = sig === R.prev ? R.steady + 1 : 0; R.prev = sig; if (R.mark !== null && sig !== R.mark) R.changed = true; R.rows.push(row); if (R.rows.length > 120) R.rows.shift(); return out; }; });
// settled = expected location, the rendered frame has changed since the travel call (game.s.location flips at once,
// but React/R3F commits the new world a few frames later: the old world keeps rendering meanwhile; this was the flake),
// and then STEADY identical frames (draw count / programs / live GPU buffers) in a row
const settle = (loc) => p.waitForFunction(([l, n]) => window.game.s.location === l && !window.game.s.transition && window.__lcR.changed && window.__lcR.steady >= n, [loc, STEADY], { timeout: 120000, polling: 50 });
async function accounting(where, loc) {
  await settle(loc);
  // the app-side split (window.__info) refreshes every 500 ms: wait until it reflects the settled frame
  await p.waitForFunction(() => window.__info && window.__info.calls === window.__lcR.rows.at(-1).calls, null, { timeout: 10000, polling: 50 });
  const { rows, info } = await p.evaluate((n) => ({ rows: window.__lcR.rows.slice(-n), info: window.__info }), STEADY);
  const m = { gl: med(rows.map((x) => x.raw)), calls: med(rows.map((x) => x.calls)), main: info.callsMain, shadow: info.callsShadow };
  ok(rows.every((x) => x.raw === x.calls), `${where}: reported draw calls == raw WebGL draws on every sampled frame (shadow pass included)`, m);
  ok(m.main + m.shadow === m.calls, `${where}: main + shadow == total`, m);
  return m;
}
const travel = async (to) => { await p.evaluate((t) => { const R = window.__lcR; R.mark = R.prev; R.changed = false; R.steady = 0; if (!window.game.travel(t)) throw new Error('travel refused: ' + t); }, to); await settle(to); };

const apt = await accounting('apartment', 'home'); ok(apt.shadow > 0, 'apartment: shadow pass is counted', apt);
await travel('beach'); await accounting('beach', 'beach'); await travel('home');

// GPU buffers across round trips: must plateau (InstancedMesh instance buffers freed). Read on a settled frame.
const bufs = [];
for (let i = 0; i < TRIPS; i++) { await travel('beach'); await travel('home'); bufs.push(await p.evaluate(() => window.__lcR.rows.at(-1).buf)); }
ok(Math.max(...bufs.slice(1)) - bufs[1] <= 2 && bufs.at(-1) - bufs[1] <= 2, `GPU buffers stable over ${TRIPS} apartment<->beach trips`, bufs);

// studio open/close: DOM and WebGL context released, re-open renders
const nodes = []; let reopen = 0;
for (let i = 0; i < STUDIO; i++) {
  await p.evaluate(() => window.fashion.open('f'));
  // opened = the studio canvas is in the DOM and its own context draws the same non-zero count STEADY frames in a row
  const drawn = await p.waitForFunction((n) => {
    const g = window.__gl.getContext(); const c = window.__lc.ctx.map((w) => w.deref()).find((x) => x && x !== g && !x.isContextLost()); const cv = document.querySelector('.st-preview canvas');
    if (!window.fashion.s.studio || !cv || !cv.width || !c) return false;
    const s = (window.__lcS ??= { last: -1, d: -1, k: 0 }); const now = c.__lcDraws ?? 0;
    if (s.last >= 0) { const d = now - s.last; s.k = d > 0 && d === s.d ? s.k + 1 : 0; s.d = d; } s.last = now; return s.k >= n;
  }, 4, { timeout: 60000, polling: 'raf' }).then(() => true).catch(() => false);
  await p.evaluate(() => { delete window.__lcS; });
  if (drawn) reopen++;
  await p.evaluate(() => window.fashion.close('keep-owned'));
  // closed = studio state cleared, its DOM gone, R3F has released (lost) every non-game context, game back to steady
  await p.waitForFunction(() => { const g = window.__gl.getContext(); return !window.fashion.s.studio && !document.querySelector('.st-preview') && window.__lc.ctx.map((w) => w.deref()).every((c) => !c || c === g || c.isContextLost()); }, null, { timeout: 30000, polling: 50 });
  await settle('home');
  nodes.push((await gcMetrics()).nodes);
}
ok(reopen === STUDIO, `studio opened and rendered ${STUDIO}/${STUDIO} times`, reopen);
ok(nodes.at(-1) - nodes[0] <= 60, `DOM nodes stable over ${STUDIO} studio cycles (was +~325/cycle)`, nodes);
await gcMetrics();
const gl = await p.evaluate(() => { const cs = window.__lc.ctx.map((w) => w.deref()); return { created: cs.length, live: cs.filter((c) => c && !c.isContextLost()).length, reachableLost: cs.filter((c) => c && c.isContextLost()).length }; });
ok(gl.live === 1, 'only the game WebGL context is still live after closing the studio', gl);
ok(gl.reachableLost <= 1, 'closed studio contexts are garbage-collected (at most the last one, held by React until the next commit)', gl);
ok(errs.length === 0, 'no page errors', errs.slice(0, 5));
await b.close(); console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
