// Also: the DEV-only probes window.__avatarStats / window.__glam (services.ts) must be absent from prod, present in dev.
// Proves the DEV-only 100 000 💎 test-player top-up (src/economy/devTopUp.ts + the DEV seed in bank.ts) is compiled OUT of
// production bundles. usage: node tools/check-prod-no-dev-topup.mjs   (TMPDIR = scratch dir; both builds are deleted after)
// 1) `vite build` (mode production: import.meta.env.DEV === false)  -> every marker must be ABSENT from dist/**/*.js
// 2) `vite build --mode development` (import.meta.env.DEV === true) -> the markers must be PRESENT (the check is not vacuous)
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = process.env.TMPDIR; if (!tmp || tmp.startsWith('/tmp')) { console.error('set TMPDIR to a scratch dir outside /tmp'); process.exit(2); }
const MARKERS = [
  ['top-up txId', /topup:test-player:diamond/],
  ['top-up ledger memo', /Solde de TEST port/],
  ['100 000 literal (seed / top-up amount)', /(?<![\w.])(?:100000|1e5|100_000)(?![\w.])/],
  ['DEV probe window.__avatarStats', /__avatarStats/],
  ['DEV probe window.__glam', /__glam(?![\w$])/],
];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const vite = path.join(root, 'node_modules/.bin/vite');
function scan(mode) {
  const out = path.join(tmp, `topup-check-${mode}-${process.pid}`);
  const env = { ...process.env }; for (const k of ['VERCEL', 'VERCEL_ENV', 'GH_PAGES_BASE', 'VITE_YW_ENV']) delete env[k];
  env.NODE_ENV = mode; // vite build forces NODE_ENV=production (=> DEV false) unless it is set explicitly
  const r = spawnSync(vite, ['build', '--mode', mode, '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], { cwd: root, env, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); fs.rmSync(out, { recursive: true, force: true }); throw new Error(`vite build --mode ${mode} failed`); }
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(m?js|html)$/.test(e.name)) files.push(p); } }; walk(out);
  const hits = MARKERS.map(([name, re]) => { const where = files.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(out, f)); return { name, where }; });
  const kb = Math.round(files.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024);
  fs.rmSync(out, { recursive: true, force: true }); return { hits, n: files.length, kb };
}
const prod = scan('production'); console.log(`production build: ${prod.n} js/html files, ${prod.kb} KB`);
for (const h of prod.hits) ok(h.where.length === 0, `prod bundle has NO ${h.name}${h.where.length ? ' -> found in ' + h.where.join(', ') : ''}`);
const dev = scan('development'); console.log(`development build: ${dev.n} js/html files, ${dev.kb} KB`);
for (const h of dev.hits) ok(h.where.length > 0, `dev bundle DOES contain ${h.name} (${h.where.join(', ') || 'missing'})`);
