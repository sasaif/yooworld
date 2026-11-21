#!/usr/bin/env node
// Renders infra/cloudflare/wrangler.phase-c.template.jsonc -> .local/wrangler.phase-c.jsonc (git-ignored).
// Parameters come from the environment or from a KEY=VALUE file given as argv[2] (never committed).
// Offline: no network call, nothing is created. Refuses missing / placeholder values.
//   node infra/cloudflare/render-wrangler.mjs .local/phase-c.params
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, '../..');
const tpl = fs.readFileSync(path.join(here, 'wrangler.phase-c.template.jsonc'), 'utf8');
const params = { ...process.env };
if (process.argv[2]) for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) params[m[1]] = m[2];
}
const names = [...new Set([...tpl.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]))];
const bad = names.filter((n) => !params[n] || /changeme|example|todo|xxx|placeholder/i.test(params[n]));
const rules = {
  CF_ACCOUNT_ID: /^[0-9a-f]{32}$/, EMAIL_PROVIDER: /^(resend|postmark|ses|mailgun|smtp)$/,
  UAT_API_HOST: /^[a-z0-9.-]+\.[a-z]{2,}$/, PROD_API_HOST: /^[a-z0-9.-]+\.[a-z]{2,}$/, UAT_APP_HOST: /^[a-z0-9.-]+\.[a-z]{2,}$/, PROD_APP_HOST: /^[a-z0-9.-]+\.[a-z]{2,}$/,
};
for (const n of names) if (params[n] && /_HYPERDRIVE_.*_ID$/.test(n) && !/^[0-9a-f]{32}$/.test(params[n])) bad.push(`${n} (32 hex chars)`);
for (const [n, re] of Object.entries(rules)) if (params[n] && !re.test(params[n])) bad.push(`${n} (format)`);
if (params.UAT_API_HOST && params.UAT_API_HOST === params.PROD_API_HOST) bad.push('UAT_API_HOST must differ from PROD_API_HOST');
if (bad.length) { console.error('missing/invalid parameters:\n  ' + [...new Set(bad)].join('\n  ')); process.exit(2); }
const out = tpl.replace(/\$\{([A-Z0-9_]+)\}/g, (_, n) => params[n]);
fs.mkdirSync(path.join(server, '.local'), { recursive: true });
const dst = path.join(server, '.local', 'wrangler.phase-c.jsonc');
fs.writeFileSync(dst, out.replace('"main": "../../src/cf/worker.ts"', '"main": "../src/cf/worker.ts"'));
console.log(`rendered ${names.length} parameters -> ${path.relative(server, dst)} (review, then: npx wrangler deploy -c ${path.relative(server, dst)} --env uat --dry-run)`);
