// LOCAL ONLY: create a verified test account on a running `npm run dev` (wrangler on 127.0.0.1:8787) by reading the
// verification link from the local dev outbox (auth.dev_mail, yoland_local). Used for the client `?net=1` dev mode.
//   node scripts/dev-user.mjs <email> <password> [http://127.0.0.1:8787]
import pg from 'pg';
import { conn } from './local-env.mjs';
const [email, password, base = 'http://127.0.0.1:8787'] = process.argv.slice(2);
if (!email || !password) { console.error('usage: node scripts/dev-user.mjs <email> <password> [base]'); process.exit(2); }
const u = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(u.hostname)) { console.error('refused: local wrangler only'); process.exit(2); }
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
const r = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email, password, name: email.split('@')[0] }) });
if (r.status !== 200) { console.error('sign-up', r.status, await r.text()); process.exit(1); }
const pool = new pg.Pool({ ...conn(), max: 1 });
try {
  const m = (await pool.query(`select url from auth.dev_mail where email = $1 and kind = 'verify' order by id desc limit 1`, [email])).rows[0];
  if (!m) { console.log('no verification mail (account probably exists already)'); process.exit(0); }
  const v = await fetch(m.url, { redirect: 'manual' });
  console.log(JSON.stringify({ ok: [200, 302].includes(v.status), email }));
} finally { await pool.end(); }
