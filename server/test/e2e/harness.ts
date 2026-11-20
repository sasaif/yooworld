// E2E harness: spawns `wrangler dev --local` (only on 127.0.0.1, no account, metrics off), tracks ONLY the
// processes it started (process group), and provides HTTP / WebSocket / auth helpers.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
// @ts-expect-error plain .mjs helper
import { conn, LOCAL_ROLE_PASSWORDS, PG_PORT } from '../../scripts/local-env.mjs';

export const SERVER = path.resolve(__dirname, '../..');
export const PORT = Number(process.env.E2E_PORT || 18791);
export const BASE = `http://127.0.0.1:${PORT}`, WSB = `ws://127.0.0.1:${PORT}`;
export const ORIGIN = 'http://127.0.0.1:5173';
export const DB = 'yoland_e2e';
const pw = LOCAL_ROLE_PASSWORDS as Record<string, string>;
const url = (role: string) => `postgres://${role}:${pw[role]}@127.0.0.1:${PG_PORT}/${DB}`;
export const VARS: Record<string, string> = {
  ENV_TAG: 'local', DATABASE_URL: url('app_api'), AUTH_DATABASE_URL: url('app_auth'), ADMIN_DATABASE_URL: url('admin_ops'),
  BETTER_AUTH_SECRET: 'local-only-e2e-auth-secret-0000000000000000', TICKET_SECRET: 'local-only-e2e-ticket-secret-00000000000000',
  RESULT_SECRET: 'local-only-e2e-result-secret-00000000000000', BETTER_AUTH_URL: BASE, APP_ORIGIN: ORIGIN,
};
export const su = () => new pg.Pool({ ...conn(undefined, undefined, DB), max: 3 });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let proc: ChildProcess | null = null;
export const startedPids: number[] = [];
export async function startWrangler(extraVars: Record<string, string> = {}, expectStatus = 200) {
  const dir = path.join(SERVER, '.local'); fs.mkdirSync(dir, { recursive: true });
  const envFile = path.join(dir, 'e2e.vars');
  fs.writeFileSync(envFile, Object.entries({ ...VARS, ...extraVars }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  const log = fs.openSync(path.join(dir, 'wrangler-e2e.log'), 'a');
  proc = spawn(path.join(SERVER, 'node_modules/.bin/wrangler'),
    ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 1000), '--persist-to', path.join(dir, 'wrangler-e2e'),
     '--env-file', envFile, '--show-interactive-dev-session=false', '--log-level', 'warn'],
    { cwd: SERVER, detached: true, stdio: ['ignore', log, log], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  startedPids.push(proc.pid!);
  let exited = false; proc.on('exit', () => { exited = true; });
  for (let i = 0; i < 120; i++) {
    if (exited) break;
    try { const r = await fetch(`${BASE}/api/health`); if (r.status === expectStatus) return; } catch { /* not yet */ }
    await sleep(500);
  }
  throw new Error('wrangler did not start (see .local/wrangler-e2e.log)');
}
export async function stopWrangler() {
  if (!proc) return;
  const pid = proc.pid!; proc = null;
  try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
  for (let i = 0; i < 40; i++) { try { process.kill(-pid, 0); await sleep(250); } catch { return; } }
  try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
}
const pgScript = path.join(SERVER, 'scripts/pg-local.mjs');
export const pgStop = () => execFileSync(process.execPath, [pgScript, 'stop'], { stdio: 'ignore' });
export const pgStart = () => execFileSync(process.execPath, [pgScript, 'start'], { stdio: 'ignore' });

// ---------------- HTTP ----------------
let ipN = 1;
export const freshIp = () => `198.18.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;
export interface Client { cookie: string; id: string; email: string; password: string; ip: string }
export async function http(method: string, p: string, o: { body?: unknown; cookie?: string; origin?: string | null; ip?: string; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': o.ip ?? '198.18.200.1', ...(o.headers ?? {}) };
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.cookie) h.cookie = o.cookie;
  const r = await fetch(BASE + p, { method, headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body), redirect: 'manual' });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  if (r.status >= 400) fs.appendFileSync(path.join(SERVER, '.local', 'e2e-http.log'), `${new Date().toISOString()} ${method} ${p} ${r.status} ${text.slice(0, 300)}\n`);
  return { status: r.status, json, headers: r.headers };
}
export const jar = (h: Headers) => h.getSetCookie().map((c) => c.split(';')[0]).join('; ');
export const ikey = () => `e2e-${crypto.randomUUID()}`;

/** Sign up -> read the verification link from the LOCAL dev outbox -> verify -> sign in. */
export async function signUp(pool: pg.Pool, label = 'p'): Promise<Client> {
  const ip = freshIp(); const email = `${label}-${crypto.randomUUID().slice(0, 8)}@e2e.local`; const password = 'correct-horse-battery-9';
  const r1 = await http('POST', '/api/auth/sign-up/email', { body: { email, password, name: label }, ip });
  if (r1.status !== 200) throw new Error(`sign-up ${r1.status} ${JSON.stringify(r1.json)}`);
  const mail = (await pool.query('select url from auth.dev_mail where email=$1 order by id desc limit 1', [email])).rows[0];
  const v = await fetch(mail.url, { redirect: 'manual', headers: { 'cf-connecting-ip': ip } });
  if (![200, 302].includes(v.status)) throw new Error(`verify ${v.status}`);
  return signIn(email, password, ip);
}
export async function signIn(email: string, password: string, ip = freshIp()): Promise<Client> {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': ip }, body: JSON.stringify({ email, password }) });
  const j: any = await r.json();
  if (r.status !== 200) throw new Error(`sign-in ${r.status} ${JSON.stringify(j)}`);
  const cookie = jar(r.headers);
  const gs: any = await (await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie, 'cf-connecting-ip': ip } })).json();
  if (!gs?.user?.id) throw new Error('no session after sign-in');
  return { cookie, id: gs.user.id, email, password, ip };
}
const b32 = (s: string) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export const totp = (sec: string, t = Date.now()) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = crypto.createHmac('sha1', b32(sec)).update(c).digest(); const o = h[h.length - 1] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); };
/** Enable TOTP 2FA, then sign in again through the 2FA challenge. Returns the 2FA-verified client. */
export async function with2fa(c: Client): Promise<Client> {
  const en = await http('POST', '/api/auth/two-factor/enable', { body: { password: c.password }, cookie: c.cookie, ip: c.ip });
  if (en.status !== 200) throw new Error(`2fa enable ${en.status} ${JSON.stringify(en.json)}`);
  const secret = new URL(en.json.totpURI).searchParams.get('secret')!;
  const v = await http('POST', '/api/auth/two-factor/verify-totp', { body: { code: totp(secret) }, cookie: c.cookie, ip: c.ip });
  if (v.status !== 200) throw new Error(`2fa verify ${v.status}`);
  await sleep(1100);                                    // new session strictly after the user update
  const ip = freshIp();
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': ip }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j: any = await r.json(); if (!j.twoFactorRedirect) throw new Error('expected 2FA challenge');
  const r2 = await fetch(`${BASE}/api/auth/two-factor/verify-totp`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': ip, cookie: jar(r.headers) }, body: JSON.stringify({ code: totp(secret) }) });
  if (r2.status !== 200) throw new Error(`2fa challenge ${r2.status}`);
  return { ...c, cookie: jar(r2.headers), ip };
}

// ---------------- WebSocket ----------------
export interface WsClient { ws: WebSocket; msgs: any[]; closed: { code: number; reason: string } | null; bytesIn: number; wait: (pred: (m: any) => boolean, ms?: number) => Promise<any>; send: (m: unknown) => void }
export function openWs(room: string, ticket: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSB}/ws/${room}?ticket=${encodeURIComponent(ticket)}`);
    const c: WsClient = {
      ws, msgs: [], closed: null, bytesIn: 0,
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (pred, ms = 5000) => new Promise((res, rej) => {
        const hit = c.msgs.find(pred); if (hit) return res(hit);
        const t0 = Date.now(); const iv = setInterval(() => { const h = c.msgs.find(pred); if (h) { clearInterval(iv); res(h); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout waiting for message')); } }, 20);
      }),
    };
    ws.on('message', (d) => { c.bytesIn += (d as Buffer).length; try { c.msgs.push(JSON.parse(String(d))); } catch { /* */ } });
    ws.on('close', (code, reason) => { c.closed = { code, reason: String(reason) }; });
    ws.on('open', () => resolve(c));
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error(`ws ${res.statusCode}`), { status: res.statusCode })));
    ws.on('error', (e) => { if (ws.readyState !== WebSocket.OPEN) reject(e); });
  });
}
/** Wait for welcome, then send one real message (a zero-distance move), like the game client does on arrival.
 *  [MESURÉ] Under `wrangler dev --local`, a server-initiated close on a socket that has never sent a message is not
 *  delivered to the client (the room still drops the socket). Real clients always send moves; see README. */
export async function ready(c: WsClient) { const w = await c.wait((m) => m.t === 'welcome'); const me = w.players.find((p: any) => p.id === w.you); c.send({ t: 'move', x: me.pos.x, z: me.pos.z }); await sleep(50); return w; }
export const waitClosed = async (c: WsClient, ms = 5000) => { const t0 = Date.now(); while (!c.closed && Date.now() - t0 < ms) await sleep(20); return c.closed; };
/** Locally-signed ticket (test-only: the harness knows the LOCAL ticket secret) — used by load tests to skip sign-up. */
export async function localTicket(room: string, sub: string, kind = 'public', cap = 30, owner?: string) {
  const { signTicket } = await import('../../src/core/ticket');
  return signTicket(VARS.TICKET_SECRET, { sub, room, env: 'local', kind, cap, owner });
}
