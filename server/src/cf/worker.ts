/**
 * API Worker (Phase B: LOCAL ONLY via `wrangler dev --local`). Hono routes:
 *  auth (Better Auth), saves, inventory state, room directory + signed single-use tickets, WebSocket upgrade to
 *  room DOs, events (list/create/join/kick), TEST-Gold economy (daily, factory/farm activities with presence
 *  check), authoritative Dominoes tables, admin two-person adjust. Postgres outages -> 503 + Retry-After.
 */
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type pg from 'pg';
import { validateEnv, type AppConfig } from '../core/envSchema';
import { createEconomyGate, toGateError } from '../core/economy';
import { signTicket, verifyTicket, hmac, sha256Hex, type TicketClaims } from '../core/ticket';
import { parseRoom, LOCATIONS } from '../core/rooms';
import { canonicalResult, type TableResult } from '../core/tableGame';
import { DbDown, withClient } from './db';
import { makeAuth } from './auth';
import { makeVerifier, HUMAN_CHECKED, type HumanVerifier } from '../core/humanCheck';
import type { Env } from './env';
import { metricsFor, runOpsCheck } from './ops';
export { RoomDO } from './room-do';
export { DirectoryDO } from './directory-do';
export { TableDO } from './table-do';
export { TradeDO } from './trade-do';
export { PresenceDO } from './presence-do';

interface User { id: string; email: string; emailVerified: boolean; twoFactorEnabled?: boolean | null; updatedAt: Date | string }
interface Session { id: string; createdAt: Date | string; userId: string }
type V = { cfg: AppConfig; user: User; session: Session };
type C = Context<{ Bindings: Env; Variables: V }>;
const app = new Hono<{ Bindings: Env; Variables: V }>();

const RETRY_AFTER_S = 5;
class HttpErr extends Error { constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) { super(code); } }
const STATUS: Record<string, number> = {
  not_owner: 403, forbidden: 403, not_admin: 403, admin_2fa: 403, same_admin: 403, not_seated: 403, forbidden_env: 403,
  version_conflict: 409, already_claimed: 409, result_conflict: 409, already_approved: 409, key_reuse: 409, exists: 409, full: 409,
  not_over: 409, not_started: 409, already_seated: 409, not_your_turn: 409, stale_seq: 409, game_over: 409,
  too_fast: 429, daily_cap: 429, rate_hour: 429, vip_day: 429, vip_active: 429,
  unknown_event: 404, unknown_table: 404, unknown_trade: 404, not_participant: 403, stale_version: 409, bad_state: 409, nothing_to_accept: 409, unknown_request: 404, bad_session: 404,
};
const gateFail = (r: { code?: string; message?: string }) => new HttpErr(STATUS[r.code ?? ''] ?? (r.code === 'internal' ? 500 : 400), r.code ?? 'error', { message: r.message });

// ---------- configuration (validated once per isolate, refused when environments are mixed) ----------
let cfgCache: { src: unknown; r: ReturnType<typeof validateEnv> } | null = null;
const envChecked = new Set<string>();
app.use('*', async (c, next) => {
  if (!cfgCache || cfgCache.src !== c.env) cfgCache = { src: c.env, r: validateEnv(c.env as never) };
  const r = cfgCache.r;
  if (!r.ok) return c.json({ ok: false, code: 'env_invalid', errors: r.errors }, 500);
  c.set('cfg', r.cfg);
  await next();
});
// CORS: the browser client (APP_ORIGIN only, exact match) may call the API with its session cookie. No wildcard.
app.use('/api/*', async (c, next) => cors({
  origin: (o) => (o === c.var.cfg.appOrigin ? o : null), credentials: true, maxAge: 600,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['content-type', 'idempotency-key', 'x-turnstile-token'],
})(c, next));
// CSRF: state-changing API calls must come from the app origin (Better Auth checks its own routes too).
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== c.var.cfg.appOrigin)
    return c.json({ ok: false, code: 'bad_origin' }, 403);
  await next();
});
app.onError((e, c) => {
  if (e instanceof DbDown) { c.header('Retry-After', String(RETRY_AFTER_S)); return c.json({ ok: false, code: 'db_unavailable', retryable: true }, 503); }
  if (e instanceof HttpErr) return c.json({ ok: false, code: e.code, ...e.extra }, e.status as 400);
  console.error('internal', e);
  if (c.var.cfg) metricsFor(c.var.cfg).emit('http.internal_error', 1, { path: new URL(c.req.url).pathname.split('/').slice(0, 3).join('/') });
  return c.json({ ok: false, code: 'internal' }, 500);
});

/** API database access (role app_api) with the runtime env-tag check (DB tag must equal ENV_TAG). */
async function db<T>(c: C, fn: (cl: pg.Client) => Promise<T>, url = c.var.cfg.databaseUrl): Promise<T> {
  return withClient(url, async (cl) => {
    if (!envChecked.has(url)) {
      const tag = (await cl.query('select eco.env_check() as t')).rows[0].t;
      if (tag !== c.var.cfg.env) throw new HttpErr(500, 'env_mismatch', { db: tag, worker: c.var.cfg.env });
      envChecked.add(url);
    }
    return fn(cl);
  });
}
async function call(c: C, fn: string, args: unknown[], url?: string): Promise<Record<string, any>> {
  return db(c, async (cl) => {
    try { return (await cl.query(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)).rows[0].r ?? null; }
    catch (e) {
      if ((e as { code?: string }).code === '22P02') throw new HttpErr(400, 'bad_input');
      throw gateFail(toGateError(e) as { code?: string; message?: string });
    }
  }, url);
}
const idem = (c: C) => {
  const k = c.req.header('idempotency-key');
  if (!k || !/^[A-Za-z0-9._:-]{8,128}$/.test(k)) throw new HttpErr(400, 'idempotency_key_required');
  return k;
};
async function body<T = Record<string, any>>(c: C): Promise<T> { try { return await c.req.json(); } catch { throw new HttpErr(400, 'bad_json'); } }

// ---------- session revocation -> open WebSockets closed (4401) ----------
/** Close the player's open realtime sockets for one session (sid) or all sessions (null). Rooms come from the
 *  per-player presence index written when tickets are signed. */
async function kickSessions(env: Env, cfg: AppConfig, userId: string, sid: string | null) {
  const rooms = await env.PRESENCE.get(env.PRESENCE.idFromName(`${cfg.env}:presence:${userId}`)).take(sid);
  const r = await Promise.all(rooms.map((room) => env.ROOM.get(env.ROOM.idFromName(room)).revoke(userId, sid).catch(() => ({ closed: 0 }))));
  return { rooms: rooms.length, closed: r.reduce((n, x) => n + x.closed, 0) };
}
const authFor = (c: C) => makeAuth(c.var.cfg, (userId, sid) => kickSessions(c.env, c.var.cfg, userId, sid));

// ---------- human check (Turnstile hook) on bot-attractive unauthenticated routes ----------
let verifierCache: { cfg: AppConfig; v: HumanVerifier } | null = null;
app.use('/api/auth/*', async (c, next) => {
  if (c.req.method === 'POST' && (HUMAN_CHECKED as readonly string[]).includes(new URL(c.req.url).pathname)) {
    if (!verifierCache || verifierCache.cfg !== c.var.cfg) verifierCache = { cfg: c.var.cfg, v: makeVerifier(c.var.cfg.humanMode, c.var.cfg.turnstileSecret) };
    const r = await verifierCache.v.verify(c.req.header('x-turnstile-token'), c.req.header('cf-connecting-ip'));
    if (!r.ok) return c.json({ ok: false, code: 'human_check_failed', codes: r.codes }, 403);
  }
  await next();
});
// ---------- auth ----------
app.all('/api/auth/*', async (c) => {
  const { auth, close } = authFor(c);
  try {
    let res: Response;
    try { res = await auth.handler(c.req.raw); }
    catch (e) { await db(c, async () => null); throw e; }          // DB down -> DbDown -> 503, else the original error
    if (res.status >= 500) await db(c, async () => null);
    return res;
  } finally { c.executionCtx.waitUntil(close()); }
});
/** eco.players row ensured + account state, cached per auth SESSION and isolate: the state can only leave 'active'
 *  through /me/delete, which revokes every session, so a cached 'active' session can never be a closed account. */
const ensured = new Map<string, { state: string; due: string | null }>();
const PENDING_ALLOWED = new Set(['/api/me', '/api/me/export', '/api/me/restore']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuidParam = (c: C, name: string) => { const v = c.req.param(name) ?? ''; if (!UUID.test(v)) throw new HttpErr(400, 'bad_' + name); return v; };
async function requireUser(c: C, next: () => Promise<void>) {
  const { auth, close } = authFor(c);
  try {
    let s = null as { user: User; session: Session } | null;
    try { s = (await auth.api.getSession({ headers: c.req.raw.headers })) as unknown as typeof s; } catch { s = null; }
    if (!s) { if (c.req.header('cookie')) await db(c, async () => null); throw new HttpErr(401, 'unauthenticated'); }
    if (!s.user.emailVerified) throw new HttpErr(403, 'email_not_verified');
    c.set('user', s.user); c.set('session', s.session);
  } finally { c.executionCtx.waitUntil(close()); }
  let st = ensured.get(c.var.session.id);
  if (!st) {
    const r = await call(c, 'eco.ensure_player', [c.var.user.id]);
    st = { state: String(r.state ?? 'active'), due: (r.deletion_due_at as string | null) ?? null };
    if (ensured.size > 10_000) ensured.clear();
    if (st.state === 'active') ensured.set(c.var.session.id, st);   // only 'active' is cached (restore is re-checked)
  }
  if (st.state !== 'active' && !PENDING_ALLOWED.has(new URL(c.req.url).pathname))
    throw new HttpErr(403, st.state === 'deleted' ? 'account_deleted' : 'account_pending_deletion', { deletion_due_at: st.due });
  await next();
}
/** Admin = Better Auth session of a user with 2FA enabled, created AFTER the last user update (fail closed).
 *  The DB re-checks the admins table and twoFactorEnabled (audit._admin_ok). */
async function requireAdmin(c: C, next: () => Promise<void>) {
  const u = c.var.user;
  if (!u.twoFactorEnabled) throw new HttpErr(403, 'admin_2fa');
  if (new Date(c.var.session.createdAt).getTime() < new Date(u.updatedAt).getTime()) throw new HttpErr(403, 'admin_session_stale');
  if (!c.var.cfg.adminDatabaseUrl) throw new HttpErr(503, 'admin_disabled');
  await next();
}

app.get('/api/health', (c) => c.json({ ok: true, env: c.var.cfg.env, service: 'yoland-api' }));
app.get('/api/health/db', async (c) => { const r = await db(c, async (cl) => (await cl.query('select eco.env_check() t, current_user r')).rows[0]); return c.json({ ok: true, db: r.t, role: r.r }); });

const api = new Hono<{ Bindings: Env; Variables: V }>();
api.use('*', requireUser);
api.get('/me', async (c) => {
  const r = await call(c, 'eco.ensure_player', [c.var.user.id]);
  return c.json({ ok: true, id: c.var.user.id, email: c.var.user.email, twoFactor: !!c.var.user.twoFactorEnabled, state: r.state, deletion_due_at: r.deletion_due_at });
});

// ---------- account: 2FA backup-code count, personal-data export, self-service deletion ----------
/** Remaining 2FA backup codes (count only; the codes themselves are shown once, at generation, and stored encrypted). */
api.get('/me/2fa/backup-codes', async (c) => {
  if (!c.var.user.twoFactorEnabled) return c.json({ ok: true, enabled: false, remaining: 0 });
  const { auth, close } = authFor(c);
  try {
    const r = await auth.api.viewBackupCodes({ body: { userId: c.var.user.id } }) as { backupCodes?: string[] };
    return c.json({ ok: true, enabled: true, remaining: r.backupCodes?.length ?? 0 });
  } finally { c.executionCtx.waitUntil(close()); }
});
/** Export of the caller's OWN data: account (no password hash, tokens or 2FA secret) + every game/economy row. */
api.get('/me/export', async (c) => {
  const me = c.var.user.id;
  const account = await withClient(c.var.cfg.authDatabaseUrl, async (cl) => ({
    user: (await cl.query('select id, name, email, "emailVerified", image, "createdAt", "updatedAt", "twoFactorEnabled" from auth."user" where id = $1', [me])).rows[0],
    sessions: (await cl.query('select id, "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent" from auth.session where "userId" = $1 order by "createdAt"', [me])).rows,
    accounts: (await cl.query('select "providerId", "accountId", "createdAt", "updatedAt" from auth.account where "userId" = $1', [me])).rows,
  }));
  const game = await call(c, 'eco.export_player', [me]);
  c.header('content-disposition', `attachment; filename="yoland-export-${me}.json"`);
  c.header('cache-control', 'no-store');
  return c.json({ ok: true, ...game, account });
});
const FRESH_MS = 10 * 60_000;
/** Self-service deletion REQUEST, policy (a): password + a session signed in less than 10 minutes ago + explicit
 *  confirmation. Economy side: eco.close_account (closed, restorable until deletion_due_at = now + grace). Every
 *  session is revoked and every open WebSocket closed (4401). Credentials are KEPT during the grace period so the
 *  player can sign in and POST /api/me/restore; the scheduled job finalises and erases afterwards. Idempotent. */
api.post('/me/delete', async (c) => {
  const b = await body(c); const me = c.var.user.id;
  if (b.confirm !== 'DELETE') throw new HttpErr(400, 'confirm_required');
  if (Date.now() - new Date(c.var.session.createdAt).getTime() > FRESH_MS) throw new HttpErr(403, 'reauth_required');
  const { auth, close } = authFor(c);
  try {
    try { await auth.api.verifyPassword({ body: { password: String(b.password ?? '') }, headers: c.req.raw.headers }); }
    catch { throw new HttpErr(403, 'bad_password'); }
  } finally { c.executionCtx.waitUntil(close()); }
  const eco = await call(c, 'eco.close_account', [`delete:${me}:${c.var.session.id}`, me]);
  const sids = await withClient(c.var.cfg.authDatabaseUrl, async (cl) =>
    (await cl.query('delete from auth.session where "userId" = $1 returning id', [me])).rows.map((r) => String(r.id)));
  const ws = await kickSessions(c.env, c.var.cfg, me, null);
  for (const sid of [...sids, c.var.session.id]) ensured.delete(sid);
  c.header('set-cookie', '__Secure-better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  return c.json({ ok: true, deletion_requested: true, deletion_due_at: eco.deletion_due_at, sessions_revoked: sids.length, websockets_closed: ws.closed, economy: eco });
});
/** Cancel a deletion request during the grace period (sign in again first). */
api.post('/me/restore', async (c) => {
  const r = await call(c, 'eco.restore_account', [`restore:${c.var.user.id}:${c.var.session.id}`, c.var.user.id]);
  ensured.delete(c.var.session.id);
  return c.json(r);
});

// ---------- server saves + inventory ----------
const SAVE_KINDS = ['look', 'apartment', 'profile', 'prefs'] as const;
api.get('/save', async (c) => {
  const me = c.var.user.id;
  const out = await db(c, async (cl) => {
    const saves: Record<string, unknown> = {};
    for (const k of SAVE_KINDS) saves[k] = (await cl.query('select app.save_load($1,$2,$3) r', [me, k, 'default'])).rows[0].r;
    const items = (await cl.query('select * from eco.list_items($1)', [me])).rows;
    const balances = (await cl.query('select eco.get_balances($1) r', [me])).rows[0].r;
    return { saves, items, balances };
  });
  return c.json({ ok: true, ...out });
});
api.put('/save/:kind/:key', async (c) => {
  const b = await body(c);
  const r = await call(c, 'app.save_put', [c.var.user.id, c.req.param('kind'), c.req.param('key'), b.base_version ?? 0, JSON.stringify(b.data ?? null), b.schema ?? 1]);
  return c.json(r);
});
api.post('/items/:id/state', async (c) => {
  const b = await body(c);
  return c.json(await call(c, 'eco.item_set_state', [c.var.user.id, uuidParam(c, 'id'), b.state]));
});

// ---------- rooms: directory + tickets ----------
async function roomCaps(c: C) {
  return db(c, async (cl) => {
    const rows = (await cl.query('select key, value from eco.get_config()')).rows as { key: string; value: string }[];
    const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
    const soft = m['room.public_soft_cap'], hard = m['room.public_hard_cap'];
    if (!(soft >= 1 && hard >= soft)) throw new HttpErr(500, 'bad_room_config');
    return { soft, hard, apt: m['room.apartment_visitors'], event: m['event.capacity_default'] };
  });
}
/** Signs a single-use room ticket bound to the auth session, and records (session, room) in the player's presence
 *  index so a revocation can close that socket. */
async function ticketFor(c: C, claims: TicketClaims) {
  const sid = c.var.session.id;
  await c.env.PRESENCE.get(c.env.PRESENCE.idFromName(`${c.var.cfg.env}:presence:${claims.sub}`)).record(sid, claims.room, c.var.cfg.wsMaxLifetimeMs);
  return signTicket(c.var.cfg.ticketSecret, { ...claims, sid });
}
api.post('/rooms/apt/:owner/join', async (c) => {
  const me = c.var.user.id, owner = c.req.param('owner');
  if (!/^[0-9a-f-]{36}$/.test(owner)) throw new HttpErr(400, 'bad_owner');
  const caps = await roomCaps(c);
  const room = `${c.var.cfg.env}:apt:${owner}`;
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(room));
  if (me === owner && (await stub.members()).filter((x) => x !== owner).length === 0)
    return c.json({ ok: true, realtime: false, reason: 'alone' });               // no realtime room for a player alone
  const ticket = await ticketFor(c, { sub: me, room, env: c.var.cfg.env, kind: 'apartment', cap: caps.apt + 1, owner });
  return c.json({ ok: true, realtime: true, room, ticket });
});
api.post('/rooms/:location/join', async (c) => {
  const loc = c.req.param('location'); const me = c.var.user.id;
  if (!LOCATIONS[loc]?.sharded) throw new HttpErr(404, 'unknown_location');
  const caps = await roomCaps(c);
  const b = await c.req.json().catch(() => ({})) as { friends?: string[] };
  const dir = c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName(`${c.var.cfg.env}:dir:${loc}`));
  const p = await dir.place(me, { soft: caps.soft, hard: caps.hard }, Array.isArray(b.friends) ? b.friends.slice(0, 50).map(String) : []);
  const room = `${c.var.cfg.env}:${loc}:${p.shard}`;
  const ticket = await ticketFor(c, { sub: me, room, env: c.var.cfg.env, kind: 'public', cap: caps.hard });
  return c.json({ ok: true, room, shard: p.shard, reason: p.reason, ticket });
});

// ---------- events ----------
api.get('/events', async (c) => {
  const cat = c.req.query('category') || null;
  const rows = await db(c, async (cl) => (await cl.query('select id, category_id, title, starts_at, ends_at, capacity, status, owner_id from social.list_events($1, null, null, $2)', [cat, Number(c.req.query('limit') ?? 20)])).rows);
  return c.json({ ok: true, events: rows });
});
api.post('/events', async (c) => {
  const b = await body(c);
  return c.json(await call(c, 'social.create_event', [c.var.user.id, b.category, String(b.title ?? '').slice(0, 80), 'event', b.start ?? new Date().toISOString(), b.minutes ?? 60]));
});
api.post('/events/:id/join', async (c) => {
  const id = c.req.param('id'); const me = c.var.user.id;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpErr(400, 'bad_event');
  const r = await call(c, 'social.can_join', [id, me]);
  if (!r.ok) throw new HttpErr(r.reason === 'kicked' ? 403 : 409, r.reason, { until: r.until });
  const room = `${c.var.cfg.env}:event:${id}`;
  const ticket = await ticketFor(c, { sub: me, room, env: c.var.cfg.env, kind: 'event', cap: r.capacity, owner: r.owner });
  return c.json({ ok: true, room, ticket });
});
api.post('/events/:id/kick', async (c) => {
  const id = uuidParam(c, 'id'); const b = await body(c);
  if (!UUID.test(String(b.target ?? ''))) throw new HttpErr(400, 'bad_target');
  const r = await call(c, 'social.kick', [id, c.var.user.id, b.target, String(b.reason ?? '')]);   // owner check in Postgres
  const until = new Date(r.banned_until).getTime();
  const room = `${c.var.cfg.env}:event:${id}`;
  const k = await c.env.ROOM.get(c.env.ROOM.idFromName(room)).kick(String(b.target), until, c.var.user.id);
  return c.json({ ok: true, until, wasPresent: k.wasPresent });
});

// ---------- economy (TEST currencies outside prod) ----------
api.get('/economy/balance', async (c) => c.json({ ok: true, ...(await call(c, 'eco.get_balances', [c.var.user.id])) }));
api.post('/economy/test-grant', async (c) => {
  if (c.var.cfg.env === 'prod') throw new HttpErr(403, 'forbidden_env');
  const b = await body(c);
  return c.json(await call(c, 'eco.test_grant_gold', [idem(c), c.var.user.id, b.amount]));
});
api.post('/economy/daily', async (c) => c.json(await call(c, 'eco.claim_daily', [idem(c), c.var.user.id])));
const ACTIVITY_LOCATION: Record<string, string> = { factory: 'factory', farm: 'farm' };
async function presentIn(c: C, room: string) {
  const r = parseRoom(room);
  if (!r || r.env !== c.var.cfg.env) return false;
  return c.env.ROOM.get(c.env.ROOM.idFromName(room)).isPresent(c.var.user.id);
}
api.post('/activities/:def/start', async (c) => {
  const def = c.req.param('def'); const b = await body(c); const room = String(b.room ?? '');
  if (!ACTIVITY_LOCATION[def]) throw new HttpErr(404, 'unknown_activity');
  if (parseRoom(room)?.location !== ACTIVITY_LOCATION[def] || !(await presentIn(c, room))) throw new HttpErr(403, 'not_in_room');
  return c.json(await call(c, 'eco.activity_start', [idem(c), c.var.user.id, def, room]));
});
api.post('/activities/sessions/:sid/task', async (c) => {
  const sid = uuidParam(c, 'sid'); const key = idem(c);
  const room = await db(c, async (cl) => (await cl.query('select eco.activity_room($1,$2) r', [c.var.user.id, sid])).rows[0].r as string | null);
  if (!room) throw new HttpErr(404, 'bad_session');
  if (!(await presentIn(c, room))) throw new HttpErr(403, 'not_in_room');       // anti-farming: must be in the room now
  return c.json(await call(c, 'eco.activity_complete_task', [key, c.var.user.id, sid]));
});
api.post('/activities/sessions/:sid/end', async (c) => c.json(await call(c, 'eco.activity_end', [c.var.user.id, uuidParam(c, 'sid')])));

// ---------- authoritative mini-game tables (Dominoes) ----------
const tableStub = (c: C, id: string) => { if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpErr(400, 'bad_table'); return c.env.TABLE.get(c.env.TABLE.idFromName(`${c.var.cfg.env}:table:${id}`)); };
const unwrap = <T extends { error?: string }>(r: T) => { if (r.error) throw new HttpErr(STATUS[r.error] ?? 400, r.error); return r; };
api.post('/tables', async (c) => { const id = crypto.randomUUID(); unwrap(await tableStub(c, id).create(id, c.var.user.id)); return c.json({ ok: true, table: id, game: 'dominoes' }); });
api.post('/tables/:id/join', async (c) => c.json(unwrap(await tableStub(c, c.req.param('id')).join(c.var.user.id))));
api.get('/tables/:id', async (c) => c.json(unwrap(await tableStub(c, c.req.param('id')).view(c.var.user.id))));
api.post('/tables/:id/move', async (c) => { const b = await body(c); return c.json(unwrap(await tableStub(c, c.req.param('id')).move(c.var.user.id, b.move, b.seq))); });
/** The result is pulled from the table room and its signature checked; the request body is ignored entirely. */
api.post('/tables/:id/claim', async (c) => {
  const r = unwrap(await tableStub(c, c.req.param('id')).result(c.var.user.id)) as { result: TableResult; hash: string; sig: string };
  if ((await hmac(c.var.cfg.resultSecret, canonicalResult(r.result))) !== r.sig) throw new HttpErr(500, 'result_signature');
  const res = r.result;
  return c.json(await call(c, 'prog.record_match', [res.table, res.game, res.players, res.winners, res.scores, res.moves, r.hash]));
});

// ---------- trades: negotiation in a trade room (DO), settlement through the existing SQL functions ----------
const tradeStub = (c: C, id: string) => { if (!UUID.test(id)) throw new HttpErr(400, 'bad_trade'); return c.env.TRADE.get(c.env.TRADE.idFromName(`${c.var.cfg.env}:trade:${id}`)); };
type Pending = { ecoId: string; settler: string; a: string; b: string; version: number; lines: unknown[]; canonical: string };
/** Lock + settle the version both players accepted. Idempotent: the same eco trade id, actor and keys are reused
 *  if the settlement is re-driven after a crash (DO left in 'settling'). A business refusal (item moved, not
 *  enough Gold...) sends the negotiation back to 'open'; both players must accept again. */
async function driveSettlement(c: C, stub: ReturnType<typeof tradeStub>, p: Pending) {
  const hash = await sha256Hex(p.canonical);
  try {
    await call(c, 'eco.trade_lock', [`tlock-${p.ecoId}`, p.ecoId, p.settler, p.a, p.b, p.version, hash, JSON.stringify(p.lines)]);
  } catch (e) {
    if (e instanceof HttpErr && e.status < 500) { const f = await stub.failed(p.ecoId, e.code); throw new HttpErr(409, e.code, { state: f.state }); }
    throw e;
  }
  const s = await call(c, 'eco.trade_settle', [`tsettle-${p.ecoId}`, p.ecoId, p.settler]);
  const m = metricsFor(c.var.cfg); m.emit('trade.settled', 1, { lines: p.lines.length });
  if (m.shouldFlush) c.executionCtx.waitUntil(m.flush());
  return unwrap(await stub.settled(p.ecoId, (s.tx as number) ?? null));
}
api.post('/trades', async (c) => {
  const b = await body(c); const other = String(b.with ?? '');
  if (!UUID.test(other)) throw new HttpErr(400, 'bad_target');
  const id = crypto.randomUUID();
  return c.json(unwrap(await tradeStub(c, id).create(id, c.var.user.id, other)));
});
api.get('/trades/:id', async (c) => {
  const stub = tradeStub(c, c.req.param('id'));
  const v = unwrap(await stub.view(c.var.user.id)) as { pending: Pending | null; state: { status: string } };
  if (v.pending) return c.json(await driveSettlement(c, stub, v.pending));      // resume an interrupted settlement
  return c.json({ ok: true, state: v.state });
});
api.post('/trades/:id/offer', async (c) => { const b = await body(c); return c.json(unwrap(await tradeStub(c, c.req.param('id')).offer(c.var.user.id, Number(b.version), b.lines))); });
api.post('/trades/:id/cancel', async (c) => c.json(unwrap(await tradeStub(c, c.req.param('id')).cancel(c.var.user.id))));
api.post('/trades/:id/accept', async (c) => {
  const b = await body(c); const stub = tradeStub(c, c.req.param('id'));
  const r = unwrap(await stub.accept(c.var.user.id, Number(b.version))) as { state: unknown; settle: Pending | null };
  if (!r.settle) return c.json({ ok: true, waiting: true, state: r.state });
  return c.json(await driveSettlement(c, stub, r.settle));
});

// ---------- admin (2FA + second-admin approval; role admin_ops) ----------
api.post('/admin/adjust', requireAdmin, async (c) => {
  const b = await body(c);
  return c.json(await call(c, 'audit.admin_request', [c.var.user.id, 'admin_adjust', JSON.stringify({ player: b.player, base: b.base ?? 'GOLD', amount: b.amount }), b.reason ?? ''], c.var.cfg.adminDatabaseUrl));
});
api.post('/admin/approvals/:id/approve', requireAdmin, async (c) =>
  c.json(await call(c, 'audit.admin_approve', [c.var.user.id, Number(c.req.param('id'))], c.var.cfg.adminDatabaseUrl)));

app.route('/api', api);

// ---------- WebSocket: verify the ticket BEFORE waking the room ----------
app.get('/ws/:room', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ ok: false, code: 'upgrade_required' }, 426);
  const room = c.req.param('room');
  const r = parseRoom(room); if (!r) return c.json({ ok: false, code: 'bad_room' }, 400);
  const t = await verifyTicket(c.var.cfg.ticketSecret, c.req.query('ticket') ?? '', room, c.var.cfg.env);
  if ('error' in t) return c.json({ ok: false, code: t.error }, 401);
  if (!t.sid) return c.json({ ok: false, code: 'no_session' }, 401);
  const admitted = await c.env.PRESENCE.get(c.env.PRESENCE.idFromName(`${c.var.cfg.env}:presence:${t.sub}`)).admit(t.sid, room, t.iat, c.var.cfg.wsMaxLifetimeMs);
  if (!admitted) return c.json({ ok: false, code: 'session_revoked' }, 401);
  const h = new Headers(c.req.raw.headers);
  h.set('x-room', room); h.set('x-sub', t.sub); h.set('x-jti', t.jti); h.set('x-exp', String(t.exp)); h.set('x-cap', String(t.cap ?? 0)); h.set('x-owner', t.owner ?? ''); h.set('x-sid', t.sid ?? ''); h.set('x-wsmax', String(c.var.cfg.wsMaxLifetimeMs));
  return c.env.ROOM.get(c.env.ROOM.idFromName(room)).fetch(new Request(c.req.raw.url, { headers: h }));
});

// ---------- local-only observability (cost harness, tests). Disabled outside ENV_TAG=local. ----------
app.get('/dev/rooms/:room/stats', async (c) => {
  if (c.var.cfg.env !== 'local') return c.json({ ok: false }, 404);
  return c.json(await c.env.ROOM.get(c.env.ROOM.idFromName(c.req.param('room'))).stats());
});
app.get('/dev/directory/:loc', async (c) => {
  if (c.var.cfg.env !== 'local') return c.json({ ok: false }, 404);
  return c.json(await c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName(`${c.var.cfg.env}:dir:${c.req.param('loc')}`)).snapshot());
});

app.get('/dev/ops/check', async (c) => {
  if (c.var.cfg.env !== 'local') return c.json({ ok: false }, 404);
  return c.json({ ok: true, ...(await runOpsCheck(c.env, c.var.cfg)) });
});
app.get('/dev/ops/alerts', async (c) => {
  if (c.var.cfg.env !== 'local') return c.json({ ok: false }, 404);
  return c.json({ ok: true, alerts: await call(c, 'ops.open_alerts', []) });
});

/** Cron entry (uat/prod once a trigger is configured in Phase C): same check as /dev/ops/check. */
async function scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
  const r = validateEnv(env as never);
  if (!r.ok) { console.error('ops.check env_invalid', r.errors); return; }
  ctx.waitUntil(runOpsCheck(env, r.cfg).then((rep) => console.log(JSON.stringify({ ops_check: rep })), (e) => console.error('ops.check failed', e)));
}
export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
