import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Headless renderer.info snapshot for apartment + beach (desktop & iPhone 15 landscape).
// FPS under SwiftShader is not representative — we record draw calls / triangles / geometries / textures / programs.
// usage: node tools/perf-baseline.mjs [url] [--write] [--check]
//   --write  updates tools/perf-baseline.json with the measured numbers
//   --check  fails if draw calls exceed the saved baseline by more than 20 %
const url = process.argv.find((a) => a.startsWith('http')) ?? `http://127.0.0.1:${process.env.PORT ?? '5230'}/`;
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check') || !WRITE;
const BASE = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'perf-baseline.json');
const DEVS = {
  desktop: { w: 1440, h: 900, dpr: 1, touch: false, label: 'Ordinateur 1440×900' },
  iphone15: { w: 852, h: 393, dpr: 3, touch: true, label: 'iPhone 15 paysage' },
};
const SCENES = [
  { id: 'apartment', query: 'lieu=appart&fresh=1&perf=1', label: 'Appartement' },
  { id: 'beach', query: 'lieu=plage&fresh=1&perf=1', label: 'Yoo Plage' },
];
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args });

async function measure(devName, scene) {
  const dev = DEVS[devName];
  const ctx = await b.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: dev.touch, hasTouch: dev.touch });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const sep = url.includes('?') ? '&' : '?';
  const dest = url.replace(/[?#].*$/, ''); // drop any existing query (we'll add our own)
  await p.goto(dest + sep + scene.query, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__cam, null, { timeout: 180000 });
  await p.waitForTimeout(4500);
  // wait until __perf has a few samples (overlay is on via ?perf=1)
  await p.waitForFunction(() => (window.__perf?.()?.samples ?? 0) >= 5 || window.__info?.calls > 0, null, { timeout: 20000 }).catch(() => {});
  const data = await p.evaluate(() => {
    const perf = typeof window.__perf === 'function' ? window.__perf() : null;
    const info = window.__info ?? null;
    return {
      perf, info,
      location: window.game?.s.location ?? null,
      size: [innerWidth, innerHeight],
    };
  });
  const src = data.perf && data.perf.calls ? data.perf : data.info;
  const row = {
    device: devName, scene: scene.id, location: data.location, size: data.size,
    fps: data.perf?.fps ?? null, msAvg: data.perf?.msAvg ?? null, msWorst: data.perf?.msWorst ?? null,
    calls: src?.calls ?? 0, triangles: src?.triangles ?? 0, geometries: src?.geometries ?? 0,
    textures: src?.textures ?? 0, programs: src?.programs ?? 0,
    uniqueGeometries: data.perf?.uniqueGeometries ?? null, uniqueMaterials: data.perf?.uniqueMaterials ?? null,
    samples: data.perf?.samples ?? 0, errors: errs.slice(0, 4),
  };
  await ctx.close();
  return row;
}

const results = [];
for (const scene of SCENES) {
  for (const dev of Object.keys(DEVS)) {
    const row = await measure(dev, scene);
    results.push(row);
    console.log(`${scene.label} · ${DEVS[dev].label}: draw ${row.calls}  tri ${row.triangles}  geo ${row.geometries}  tex ${row.textures}  prog ${row.programs}  mat ${row.uniqueMaterials}  fps ${row.fps} (SwiftShader, non représentatif)`);
    if (row.errors.length) console.log('  errors', row.errors);
  }
}
await b.close();

const report = { recordedAt: new Date().toISOString(), url, results };
const outPath = process.env.OUT ?? '/tmp/perf-measured.json';
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('wrote', outPath);

if (WRITE) {
  // store a compact baseline keyed by scene+device
  const baseline = { recordedAt: report.recordedAt, note: 'Headless SwiftShader FPS is not representative. Guard uses draw calls only (+20 %).', scenes: {} };
  for (const r of results) {
    (baseline.scenes[r.scene] ??= {})[r.device] = { calls: r.calls, triangles: r.triangles, geometries: r.geometries, textures: r.textures, programs: r.programs, uniqueGeometries: r.uniqueGeometries, uniqueMaterials: r.uniqueMaterials };
  }
  fs.writeFileSync(BASE, JSON.stringify(baseline, null, 2));
  console.log('updated baseline', BASE);
}

if (CHECK && fs.existsSync(BASE)) {
  const baseline = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  let failed = 0;
  for (const r of results) {
    const b0 = baseline.scenes?.[r.scene]?.[r.device];
    if (!b0) { console.log(`SKIP ${r.scene}/${r.device} — pas encore dans la baseline`); continue; }
    const limit = Math.ceil(b0.calls * 1.2);
    const ok = r.calls <= limit;
    console.log((ok ? 'PASS' : 'FAIL') + ` ${r.scene}/${r.device} draw ${r.calls} (baseline ${b0.calls}, limite ${limit})`);
    if (!ok) { failed++; process.exitCode = 1; }
  }
  if (failed) console.log(`FAIL ${failed} scène(s) dépassent +20 % de draw calls`);
  else console.log('PASS garde draw calls ≤ baseline + 20 %');
} else if (CHECK && !fs.existsSync(BASE)) {
  console.log('SKIP --check : pas de tools/perf-baseline.json (lancer avec --write une première fois)');
}
