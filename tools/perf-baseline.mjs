import { createRequire } from 'module'; import fs from 'fs'; import path from 'path'; import os from 'os';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Headless renderer counters for apartment + beach (desktop & iPhone 15 landscape), repeatable.
// Headless Chrome + SwiftShader (CPU GL): counts are meaningful, frame times are NOT real-device numbers.
// Draw calls are the REAL per-frame total: main pass + shadow pass (src/render/perf/drawCounter.ts; three's own
// renderer.info drops the shadow pass). Main / shadow / total are recorded and printed separately.
//
// Repeatability: every scene x profile is measured RUNS times, each in a fresh browser context (fresh=1: in-memory save,
// default spawn + default camera), after a state-based warm-up (game ready -> all shaders compiled with compileAsync ->
// draw calls and program count unchanged for STABLE consecutive frames). Each run then records FRAMES consecutive frames
// (per-frame values read right after each renderer.render(), plus raw WebGL draws counted on the context as a
// cross-check), the GPU buffer count, the JS heap after GC and frame-time percentiles. Per run the frame median is kept;
// across runs min / median / max / stddev are reported. The guard uses the median of the runs.
// usage: node tools/perf-baseline.mjs [url] [--write] [--check] [--table]
//   RUNS=3 FRAMES=30 STABLE=10 DEVS=desktop,iphone15 SCENES=apartment,beach OUT=<json>
//   --write  updates tools/perf-baseline.json with the run medians (and their spread)
//   --check  fails if the median total draw calls exceed the saved baseline by more than 20 %,
//            or if a scene with a HARD budget (apartment: total < 120) is not strictly under it
//   --table  prints a Markdown variance table (min / median / max / stddev per metric)
// The soft budgets of docs/10 (apartment 120, beach 40, total incl. shadows) are reported, never hidden; going over a
// budget is printed as AU-DESSUS DU BUDGET but does not fail the run (the guard is about regressions).
const url = process.argv.find((a) => a.startsWith('http')) ?? `http://127.0.0.1:${process.env.PORT ?? '5230'}/`;
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check') || !WRITE;
const BASE = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'perf-baseline.json');
const DEVS = {
  desktop: { w: 1440, h: 900, dpr: 1, touch: false, label: 'Ordinateur 1440×900' },
  iphone15: { w: 852, h: 393, dpr: 3, touch: true, label: 'iPhone 15 paysage' },
};
const BUDGETS = { apartment: 120, beach: 40 }; // docs/10-performance-foundations.md, total draw calls incl. shadow pass
const HARD_BUDGETS = { apartment: 120 }; // --check fails unless total < budget (met since feature/qa-drawcalls: 94 / 90)
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const SCENES = [
  { id: 'apartment', query: 'lieu=appart&fresh=1&perf=1', label: 'Appartement' },
  { id: 'beach', query: 'lieu=plage&fresh=1&perf=1', label: 'Yoo Plage' },
];
const RUNS = Number(process.env.RUNS ?? 3), FRAMES = Number(process.env.FRAMES ?? 30), STABLE = Number(process.env.STABLE ?? 10);
const onlyDevs = (process.env.DEVS ?? Object.keys(DEVS).join(',')).split(','), onlyScenes = (process.env.SCENES ?? SCENES.map((x) => x.id).join(',')).split(',');
const TABLE = process.argv.includes('--table');
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const b = await chromium.launch({ executablePath: CHROME, args });

// injected before the app (tool-side only): raw WebGL draws, split by target (default framebuffer = main pass,
// any bound framebuffer = offscreen, i.e. the shadow maps in the game), and live WebGL buffers.
const INIT = () => {
  const C = (window.__pb = { draws: 0, off: 0, buf: 0, fb: null });
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!P) continue;
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) { const o = P[f]; if (!o) continue; P[f] = function (...a) { C.draws++; if (C.fb) C.off++; return o.apply(this, a); }; }
    const bf = P.bindFramebuffer; P.bindFramebuffer = function (t, f) { if (t !== 0x8ca8) C.fb = f; return bf.call(this, t, f); }; // ignore READ_FRAMEBUFFER
    const cb = P.createBuffer, db = P.deleteBuffer; P.createBuffer = function () { const r = cb.call(this); if (r) C.buf++; return r; }; P.deleteBuffer = function (x) { if (x) C.buf--; return db.call(this, x); };
  }
};
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const sd = (a) => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const r2 = (v) => (v == null ? v : Math.round(v * 100) / 100);

async function measureRun(devName, scene) {
  const dev = DEVS[devName];
  const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: dev.touch, hasTouch: dev.touch });
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const dest = url.replace(/[?#].*$/, ''); // fixed query: always exactly the scene's own parameters
  await p.goto(dest + '?' + scene.query, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__cam && window.__gl, null, { timeout: 180000 });
  const t0 = Date.now();
  // warm-up 1: compile every shader of the current scene graph up front (no first-use compile hitch inside the sample)
  const warm = await p.evaluate(async () => { const gl = window.__gl; let sc = window.__cam; while (sc.parent) sc = sc.parent;
    if (gl.compileAsync) { await gl.compileAsync(sc, window.__cam); return 'compileAsync'; } gl.compile(sc, window.__cam); return 'compile'; });
  // install the per-frame recorder: wraps the (outermost) renderer.render, reads values right after each frame
  await p.evaluate(() => { const gl = window.__gl, C = window.__pb; const rec = (window.__pbRec = { on: false, rows: [], last: 0, d0: 0, o0: 0, stable: 0, prev: null });
    const r = gl.render; gl.render = function (...a) { const out = r.apply(this, a); const now = performance.now(); const sig = gl.info.render.calls + '/' + (gl.info.programs?.length ?? 0);
      rec.stable = sig === rec.prev ? rec.stable + 1 : 0; rec.prev = sig;
      if (rec.on) rec.rows.push({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, raw: C.draws - rec.d0, rawOff: C.off - rec.o0, dt: rec.last ? now - rec.last : null });
      rec.d0 = C.draws; rec.o0 = C.off; rec.last = now; return out; }; });
  // warm-up 2: wait for a steady state (same draw count and program count for STABLE frames in a row)
  await p.waitForFunction((n) => window.__pbRec.stable >= n, STABLE, { timeout: 60000, polling: 50 });
  const warmMs = Date.now() - t0;
  const cam = await p.evaluate(() => { const c = window.__cam; return [...c.position.toArray(), ...c.quaternion.toArray()].map((v) => Math.round(v * 1000) / 1000).join(','); });
  await p.evaluate(() => { window.__pbRec.rows = []; window.__pbRec.last = 0; window.__pbRec.on = true; });
  await p.waitForFunction((n) => window.__pbRec.rows.length >= n, FRAMES, { timeout: 120000, polling: 50 });
  const rows = (await p.evaluate(() => { window.__pbRec.on = false; return window.__pbRec.rows; })).slice(0, FRAMES);
  const info = await p.evaluate(() => window.__info ?? null); // app-side split (main / shadow), refreshed every 500 ms
  const perf = await p.evaluate(() => (typeof window.__perf === 'function' ? window.__perf() : null));
  const buffers = await p.evaluate(() => window.__pb.buf);
  await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
  const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576;
  const loc = await p.evaluate(() => window.game?.s.location ?? null);
  await ctx.close();
  const col = (k) => rows.map((r) => r[k]).filter((v) => v != null);
  const dts = col('dt');
  return {
    location: loc, cam, warm, warmMs, frames: rows.length,
    calls: med(col('calls')), callsFrameMin: Math.min(...col('calls')), callsFrameMax: Math.max(...col('calls')),
    rawDraws: med(col('raw')), rawOffscreen: med(col('rawOff')), rawMain: med(rows.map((r) => r.raw - r.rawOff)),
    callsMain: info?.callsMain ?? null, callsShadow: info?.callsShadow ?? null,
    triangles: med(col('triangles')), trianglesShadow: info?.trianglesShadow ?? null,
    geometries: info?.geometries ?? 0, textures: info?.textures ?? 0, programs: info?.programs ?? 0,
    uniqueGeometries: perf?.uniqueGeometries ?? null, uniqueMaterials: perf?.uniqueMaterials ?? null,
    buffers, heapMB: r2(heap), p50: r2(pct(dts, 0.5)), p95: r2(pct(dts, 0.95)), p99: r2(pct(dts, 0.99)), errors: errs.slice(0, 4),
  };
}

const METRICS = ['calls', 'callsMain', 'callsShadow', 'rawDraws', 'rawMain', 'rawOffscreen', 'triangles', 'trianglesShadow', 'buffers', 'heapMB', 'p50', 'p95', 'p99'];
const stat = (vals) => { const v = vals.filter((x) => typeof x === 'number'); return v.length ? { min: r2(Math.min(...v)), median: r2(med(v)), max: r2(Math.max(...v)), stddev: r2(sd(v)) } : null; };
const results = [];
for (const scene of SCENES.filter((x) => onlyScenes.includes(x.id))) {
  for (const dev of Object.keys(DEVS).filter((d) => onlyDevs.includes(d))) {
    const runs = []; for (let i = 0; i < RUNS; i++) runs.push(await measureRun(dev, scene));
    const stats = Object.fromEntries(METRICS.map((m) => [m, stat(runs.map((r) => r[m]))]));
    const m = (k) => stats[k]?.median ?? null;
    const row = {
      device: dev, scene: scene.id, location: runs[0].location, runs: RUNS, framesPerRun: FRAMES,
      calls: m('calls'), callsMain: m('callsMain'), callsShadow: m('callsShadow'), triangles: m('triangles'), trianglesShadow: m('trianglesShadow'),
      geometries: med(runs.map((r) => r.geometries)), textures: med(runs.map((r) => r.textures)), programs: med(runs.map((r) => r.programs)),
      uniqueGeometries: runs[0].uniqueGeometries, uniqueMaterials: runs[0].uniqueMaterials,
      stats, sameCamera: new Set(runs.map((r) => r.cam)).size === 1, frameCallsSpread: [Math.min(...runs.map((r) => r.callsFrameMin)), Math.max(...runs.map((r) => r.callsFrameMax))],
      rawMatchesReported: runs.every((r) => r.rawDraws === r.calls), warmMs: runs.map((r) => r.warmMs), errors: [...new Set(runs.flatMap((r) => r.errors))].slice(0, 4), perRun: runs,
    };
    results.push(row);
    const sc = stats.calls;
    console.log(`${scene.label} · ${DEVS[dev].label} (${RUNS} runs × ${FRAMES} frames): draw total médiane ${row.calls} [min ${sc.min} · max ${sc.max} · σ ${sc.stddev}] (principal ${row.callsMain} + ombres ${row.callsShadow})  tri ${row.triangles} (dont ombres ${row.trianglesShadow})  buffers GPU ${m('buffers')}  tas ${m('heapMB')} Mo  frame p50/p95/p99 ${m('p50')}/${m('p95')}/${m('p99')} ms (SwiftShader, non représentatif)`);
    if (!row.sameCamera) console.log('  ATTENTION caméra différente entre les runs', runs.map((r) => r.cam));
    if (!row.rawMatchesReported) console.log('  ATTENTION draws WebGL bruts ≠ draws déclarés', runs.map((r) => [r.rawDraws, r.calls]));
    if (row.frameCallsSpread[0] !== row.frameCallsSpread[1]) console.log('  NOTE draw calls variables d\'une frame à l\'autre', row.frameCallsSpread);
    if (row.errors.length) console.log('  errors', row.errors);
  }
}
await b.close();

if (TABLE) {
  console.log('\n| Scène · profil | Métrique | min | médiane | max | σ |\n|---|---|---:|---:|---:|---:|');
  for (const r of results) for (const k of METRICS) { const s = r.stats[k]; if (s) console.log(`| ${r.scene} · ${r.device} | ${k} | ${s.min} | ${s.median} | ${s.max} | ${s.stddev} |`); }
}

const report = { recordedAt: new Date().toISOString(), url, note: 'Headless Chrome + SwiftShader: counts are meaningful, frame times / heap are NOT real-device numbers.', runs: RUNS, framesPerRun: FRAMES, results };
const outPath = process.env.OUT ?? path.join(os.tmpdir(), 'perf-measured.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('wrote', outPath);

if (WRITE) {
  // store a compact baseline keyed by scene+device
  const baseline = { recordedAt: report.recordedAt, note: 'Headless SwiftShader FPS is not representative. calls = total draw calls per frame (main + shadow pass), median of RUNS fresh runs x FRAMES frames. Guard: median total draw calls +20 %. Budgets (docs/10): apartment 120, beach 40, reported only.', runs: RUNS, framesPerRun: FRAMES, budgets: BUDGETS, scenes: {} };
  for (const r of results) {
    (baseline.scenes[r.scene] ??= {})[r.device] = { calls: r.calls, callsMain: r.callsMain, callsShadow: r.callsShadow, trianglesShadow: r.trianglesShadow, triangles: r.triangles, geometries: r.geometries, textures: r.textures, programs: r.programs, uniqueGeometries: r.uniqueGeometries, uniqueMaterials: r.uniqueMaterials, spread: { calls: r.stats.calls, triangles: r.stats.triangles, buffers: r.stats.buffers } };
  }
  fs.writeFileSync(BASE, JSON.stringify(baseline, null, 2));
  console.log('updated baseline', BASE);
}

for (const r of results) {
  const bud = BUDGETS[r.scene]; if (!bud) continue;
  console.log(`${r.calls > bud ? 'AU-DESSUS DU BUDGET' : 'BUDGET OK'} ${r.scene}/${r.device}: ${r.calls} draw calls (principal ${r.callsMain} + ombres ${r.callsShadow}) pour un budget de ${bud}` + (r.calls > bud ? ` (+${r.calls - bud})` : ''));
}

if (CHECK && fs.existsSync(BASE)) {
  const baseline = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  let failed = 0;
  for (const r of results) {
    const b0 = baseline.scenes?.[r.scene]?.[r.device];
    if (!b0) { console.log(`SKIP ${r.scene}/${r.device} — pas encore dans la baseline`); continue; }
    const limit = Math.ceil(b0.calls * 1.2);
    const ok = r.calls <= limit;
    console.log((ok ? 'PASS' : 'FAIL') + ` ${r.scene}/${r.device} draw total (médiane de ${r.runs} runs) ${r.calls} = ${r.callsMain} + ombres ${r.callsShadow} (baseline ${b0.calls}, limite ${limit})`);
    if (!ok) { failed++; process.exitCode = 1; }
    if (b0.callsShadow === undefined) console.log(`  NOTE baseline ${r.scene}/${r.device} enregistrée sans la passe d'ombres : relancer avec --write`);
  }
  if (failed) console.log(`FAIL ${failed} scène(s) dépassent +20 % de draw calls`);
  else console.log('PASS garde draw calls ≤ baseline + 20 %');
  let over = 0;
  for (const r of results) {
    const hard = HARD_BUDGETS[r.scene]; if (!hard) continue;
    const ok = r.calls < hard; if (!ok) { over++; process.exitCode = 1; }
    console.log((ok ? 'PASS' : 'FAIL') + ` budget dur ${r.scene}/${r.device}: total ${r.calls} (principal ${r.callsMain} + ombres ${r.callsShadow}) doit rester < ${hard}`);
  }
  if (over) console.log(`FAIL ${over} scène(s) au-dessus du budget dur`);
} else if (CHECK && !fs.existsSync(BASE)) {
  console.log('SKIP --check : pas de tools/perf-baseline.json (lancer avec --write une première fois)');
}
