// Better Auth gaps (owner's adopt decision): 2FA backup codes, immediate session revocation, account enumeration
// (generic answers + timing), self-service deletion (close + anonymise, ledger intact) and personal-data export.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { startWrangler, stopWrangler, su, signUp, signIn, http, ikey, openWs, ready, waitClosed, sleep, freshIp, totp, jar, BASE, ORIGIN, SERVER, type Client } from './harness';

const pool = su();
beforeAll(async () => { await startWrangler(); });
afterAll(async () => { await stopWrangler(); await pool.end(); });

const post = (p: string, body: unknown, o: { cookie?: string; ip?: string } = {}) =>
  fetch(BASE + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': o.ip ?? freshIp(), ...(o.cookie ? { cookie: o.cookie } : {}) }, body: JSON.stringify(body) });
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2); };
const results: Record<string, unknown> = {};
afterAll(() => { fs.mkdirSync(path.join(SERVER, 'test-results'), { recursive: true }); fs.writeFileSync(path.join(SERVER, 'test-results/auth-gaps.json'), JSON.stringify(results, null, 2)); });

describe('2FA backup codes', () => {
  it('10 codes, stored encrypted; one code works once; reuse refused; count decreases only on success', async () => {
    const u = await signUp(pool, 'bk');
    const en = await http('POST', '/api/auth/two-factor/enable', { body: { password: u.password }, cookie: u.cookie, ip: u.ip });
    expect(en.status).toBe(200);
    const codes: string[] = en.json.backupCodes; const secret = new URL(en.json.totpURI).searchParams.get('secret')!;
    expect(codes).toHaveLength(10);
    expect((await http('POST', '/api/auth/two-factor/verify-totp', { body: { code: totp(secret) }, cookie: u.cookie, ip: u.ip })).status).toBe(200);
    const stored = (await pool.query('select "backupCodes" b from auth."twoFactor" where "userId" = $1', [u.id])).rows[0].b as string;
    for (const c of codes) expect(stored.includes(c)).toBe(false);                               // encrypted at rest
    await sleep(1100);
    const fresh = await signIn(u.email, u.password).catch((e) => e);                               // 2FA challenge, no session yet
    expect(String(fresh)).toMatch(/no session|sign-in/);
    const challenge = async () => { const r = await post('/api/auth/sign-in/email', { email: u.email, password: u.password }); const j: any = await r.json(); expect(j.twoFactorRedirect).toBe(true); return jar(r.headers); };
    const ip = freshIp();
    let ch = await challenge();
    const ok = await post('/api/auth/two-factor/verify-backup-code', { code: codes[0] }, { cookie: ch, ip });
    expect(ok.status).toBe(200);
    const cookie = jar(ok.headers);
    expect((await http('GET', '/api/me', { cookie })).json).toMatchObject({ ok: true, id: u.id, twoFactor: true });
    expect((await http('GET', '/api/me/2fa/backup-codes', { cookie })).json).toMatchObject({ enabled: true, remaining: 9 });
    ch = await challenge();
    const reuse = await post('/api/auth/two-factor/verify-backup-code', { code: codes[0] }, { cookie: ch, ip: freshIp() });
    expect(reuse.status).toBe(401);
    expect(reuse.headers.getSetCookie().some((c) => c.includes('session_token=') && !c.includes('session_token=;'))).toBe(false);
    const wrong = await post('/api/auth/two-factor/verify-backup-code', { code: 'AAAAA-BBBBB' }, { cookie: ch, ip: freshIp() });
    expect(wrong.status).toBe(401);
    expect((await http('GET', '/api/me/2fa/backup-codes', { cookie })).json).toMatchObject({ remaining: 9 });
    const second = await post('/api/auth/two-factor/verify-backup-code', { code: codes[1] }, { cookie: ch, ip: freshIp() });
    expect(second.status).toBe(200);
    expect((await http('GET', '/api/me/2fa/backup-codes', { cookie })).json).toMatchObject({ remaining: 8 });
    results.backup_codes = { generated: 10, after_one_use: 9, reuse_status: reuse.status, wrong_status: wrong.status, after_second_use: 8, stored_encrypted: true };
  });
});

describe('session revocation is immediate', () => {
  it('revoked session -> 401 on the next request, including ticket issuance; sign-out; password reset revokes all', async () => {
    const u = await signUp(pool, 'rv');
    const s2 = await signIn(u.email, u.password);
    expect((await http('GET', '/api/me', { cookie: s2.cookie })).status).toBe(200);
    const j0 = await http('POST', '/api/rooms/beach/join', { cookie: s2.cookie, body: {} });
    expect(j0.status).toBe(200);
    const ws = await openWs(j0.json.room, j0.json.ticket); await ready(ws);         // live socket opened BEFORE revocation
    const rv = await http('POST', '/api/auth/revoke-other-sessions', { cookie: u.cookie, body: {}, ip: u.ip });
    expect(rv.status).toBe(200);
    const t0 = performance.now();
    const me2 = await http('GET', '/api/me', { cookie: s2.cookie });
    const ms = +(performance.now() - t0).toFixed(1);
    expect(me2.status).toBe(401);
    expect((await http('POST', '/api/rooms/beach/join', { cookie: s2.cookie, body: {} })).status).toBe(401);
    expect((await http('POST', '/api/economy/daily', { cookie: s2.cookie, headers: { 'idempotency-key': ikey() } })).status).toBe(401);
    expect((await http('GET', '/api/me', { cookie: u.cookie })).status).toBe(200);                  // the revoking session survives
    // M4: the WebSocket opened with the revoked session is closed immediately (4401)
    const wsClosed = await waitClosed(ws, 3000);
    expect(wsClosed).toMatchObject({ code: 4401 });
    const wsCloseMs = +(performance.now() - t0).toFixed(1);
    // sign-out closes the signing-out session's socket too
    const ju = await http('POST', '/api/rooms/beach/join', { cookie: u.cookie, body: {} });
    const wsu = await openWs(ju.json.room, ju.json.ticket); await ready(wsu);
    expect((await http('POST', '/api/auth/sign-out', { cookie: u.cookie, body: {}, ip: u.ip })).status).toBe(200);
    expect(await waitClosed(wsu, 3000)).toMatchObject({ code: 4401 });
    expect((await http('GET', '/api/me', { cookie: u.cookie })).status).toBe(401);
    expect((await http('POST', '/api/rooms/beach/join', { cookie: u.cookie, body: {} })).status).toBe(401);
    // password reset revokes every session
    const a = await signIn(u.email, u.password), b = await signIn(u.email, u.password);
    const ja = await http('POST', '/api/rooms/beach/join', { cookie: a.cookie, body: {} });
    const wsa = await openWs(ja.json.room, ja.json.ticket); await ready(wsa);
    expect((await http('POST', '/api/auth/request-password-reset', { body: { email: u.email }, ip: freshIp() })).status).toBe(200);
    const mail = (await pool.query(`select url from auth.dev_mail where email=$1 and kind='reset' order by id desc limit 1`, [u.email])).rows[0];
    const token = new URL(mail.url).pathname.split('/').pop()!;
    const rp = await http('POST', '/api/auth/reset-password', { body: { token, newPassword: 'another-horse-battery-7' }, ip: freshIp() });
    expect(rp.status).toBe(200);
    expect((await http('GET', '/api/me', { cookie: a.cookie })).status).toBe(401);
    expect((await http('GET', '/api/me', { cookie: b.cookie })).status).toBe(401);
    expect(await waitClosed(wsa, 3000)).toMatchObject({ code: 4401 });             // reset -> socket closed
    expect((await http('POST', '/api/auth/reset-password', { body: { token, newPassword: 'third-horse-battery-77' }, ip: freshIp() })).status).toBe(400);   // token single-use
    await signIn(u.email, 'another-horse-battery-7');
    results.revocation = { revoked_me_status: me2.status, revoked_first_request_ms: ms, ticket_after_revoke: 401, ws_closed_on_revoke: 4401, ws_close_ms_after_revoke: wsCloseMs, ws_closed_on_sign_out: 4401, ws_closed_on_reset: 4401, reset_revokes_all: true, reset_token_single_use: true };
  });
});

describe('account enumeration', () => {
  it('sign-in / sign-up / reset answers are identical for existing and unknown e-mails; timing measured', async () => {
    const u = await signUp(pool, 'en');
    const unknown = () => `nobody-${crypto.randomUUID().slice(0, 8)}@e2e.local`;
    const strip = (j: any) => JSON.stringify(j, (k, v) => (['id', 'email', 'createdAt', 'updatedAt', 'name'].includes(k) ? typeof v : v));
    // shapes
    const si1 = await http('POST', '/api/auth/sign-in/email', { body: { email: u.email, password: 'wrong-password-zz' }, ip: freshIp() });
    const si2 = await http('POST', '/api/auth/sign-in/email', { body: { email: unknown(), password: 'wrong-password-zz' }, ip: freshIp() });
    expect([si1.status, si2.status]).toEqual([401, 401]); expect(si1.json).toEqual(si2.json);
    const su1 = await http('POST', '/api/auth/sign-up/email', { body: { email: u.email, password: 'whatever-pass-123', name: 'x' }, ip: freshIp() });
    const su2 = await http('POST', '/api/auth/sign-up/email', { body: { email: unknown(), password: 'whatever-pass-123', name: 'x' }, ip: freshIp() });
    expect([su1.status, su2.status]).toEqual([200, 200]); expect(strip(su1.json)).toEqual(strip(su2.json));
    const rs1 = await http('POST', '/api/auth/request-password-reset', { body: { email: u.email }, ip: freshIp() });
    const rs2 = await http('POST', '/api/auth/request-password-reset', { body: { email: unknown() }, ip: freshIp() });
    expect([rs1.status, rs2.status]).toEqual([200, 200]); expect(rs1.json).toEqual(rs2.json);
    // timing: N interleaved trials per endpoint (fresh IP each: rate limits are per IP)
    const N = Number(process.env.ENUM_N || 50);
    const time = async (p: string, b: unknown) => { const t = performance.now(); const r = await post(p, b); await r.arrayBuffer(); return performance.now() - t; };
    const timing: Record<string, unknown> = { N };
    for (const [name, p, mk] of [
      ['sign_in', '/api/auth/sign-in/email', (e: string) => ({ email: e, password: 'wrong-password-zz' })],
      ['sign_up', '/api/auth/sign-up/email', (e: string) => ({ email: e, password: 'whatever-pass-123', name: 'x' })],
      ['reset',   '/api/auth/request-password-reset', (e: string) => ({ email: e })],
    ] as const) {
      const ex: number[] = [], un: number[] = [];
      for (let i = 0; i < N; i++) { ex.push(await time(p, mk(u.email))); un.push(await time(p, mk(unknown()))); }
      timing[name] = { existing: { p50: pct(ex, 50), p95: pct(ex, 95) }, unknown: { p50: pct(un, 50), p95: pct(un, 95) }, p50_diff_ms: +(pct(ex, 50) - pct(un, 50)).toFixed(2) };
    }
    results.enumeration = { generic_bodies: true, timing_ms: timing };
    console.log('[MESURÉ] enumeration timing (ms)', JSON.stringify(timing));
  }, 300_000);
});

describe('self-service deletion + export', () => {
  it('export = own data without secrets; delete = re-auth, grace + restore, WS kicked, expiry via scheduled job: sweep to system, erase, ledger intact', async () => {
    const d = await signUp(pool, 'del'); const e = await signUp(pool, 'cpt');
    await http('PUT', '/api/save/look/default', { cookie: d.cookie, body: { base_version: 0, data: { hair: 7 }, schema: 1 } });
    await http('POST', '/api/economy/test-grant', { cookie: d.cookie, body: { amount: 300 }, headers: { 'idempotency-key': ikey() } });
    await http('POST', '/api/economy/test-grant', { cookie: e.cookie, body: { amount: 300 }, headers: { 'idempotency-key': ikey() } });
    // economy fixture through the real functions (superuser only to age the accounts and define an item)
    await pool.query(`update eco.players set created_at = now() - interval '30 days' where id = any($1)`, [[d.id, e.id]]);
    const def = `itm_${crypto.randomUUID().slice(0, 8)}`;
    await pool.query(`insert into eco.item_definitions(id, kind, price_gold, price_diamond) values ($1, 'furniture', 50, 5)`, [def]);
    const item = (await pool.query(`select eco.shop_buy($1,$2,$3,'GOLD') r`, [ikey(), d.id, def])).rows[0].r.item;
    const trade = crypto.randomUUID();
    await pool.query(`select eco.trade_lock($1,$2,$3,$4,$5,1,'h',$6)`, [ikey(), trade, d.id, d.id, e.id, JSON.stringify([{ side: 'a', item }, { side: 'b', gold: 40 }])]);
    expect((await http('GET', '/api/economy/balance', { cookie: e.cookie })).json).toMatchObject({ gold: 260, gold_in_escrow: 40 });
    // export
    const ex = await http('GET', '/api/me/export', { cookie: d.cookie });
    expect(ex.status).toBe(200); expect(ex.headers.get('content-disposition')).toMatch(/attachment/);
    expect(ex.json.account.user).toMatchObject({ id: d.id, email: d.email });
    expect(ex.json.data.saves[0]).toMatchObject({ kind: 'look', data: { hair: 7 } });
    expect(ex.json.data.ledger.length).toBeGreaterThanOrEqual(2);
    expect(ex.json.data.items.map((i: any) => i.id)).toContain(item);
    expect(ex.json.data.purchases).toHaveLength(1);
    const keys = new Set<string>(); JSON.stringify(ex.json, (k, v) => { keys.add(k); return v; });
    for (const bad of ['password', 'token', 'secret', 'backupCodes', 'accessToken', 'refreshToken', 'idem_key']) expect(keys.has(bad)).toBe(false);
    expect(JSON.stringify(ex.json)).not.toContain(e.email);
    // deletion guards
    expect((await http('POST', '/api/me/delete', { cookie: d.cookie, body: { password: d.password } })).status).toBe(400);
    expect((await http('POST', '/api/me/delete', { cookie: d.cookie, body: { password: 'not-my-password', confirm: 'DELETE' } })).status).toBe(403);
    await pool.query(`update auth.session set "createdAt" = now() - interval '1 hour' where "userId" = $1`, [d.id]);
    expect((await http('POST', '/api/me/delete', { cookie: d.cookie, body: { password: d.password, confirm: 'DELETE' } })).json.code).toBe('reauth_required');
    const d2 = await signIn(d.email, d.password);
    const jd = await http('POST', '/api/rooms/beach/join', { cookie: d2.cookie, body: {} });
    const wsd = await openWs(jd.json.room, jd.json.ticket); await ready(wsd);
    const ledgerBefore = Number((await pool.query('select count(*) n from eco.ledger_entries')).rows[0].n);
    const del = await http('POST', '/api/me/delete', { cookie: d2.cookie, body: { password: d.password, confirm: 'DELETE' } });
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ deletion_requested: true, economy: { closed: true, grace_days: 30, trades_cancelled: 1, items_frozen: 1 } });
    expect(new Date(del.json.deletion_due_at).getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
    expect(await waitClosed(wsd, 3000)).toMatchObject({ code: 4401 });              // open socket closed
    expect((await http('GET', '/api/me', { cookie: d2.cookie })).status).toBe(401);  // every session revoked
    expect((await http('GET', '/api/me', { cookie: d.cookie })).status).toBe(401);
    expect(Number((await pool.query('select count(*) n from eco.ledger_entries')).rows[0].n)).toBe(ledgerBefore + 2);   // escrow 40 -> E only
    expect((await http('GET', '/api/economy/balance', { cookie: e.cookie })).json).toMatchObject({ gold: 300, gold_in_escrow: 0 });
    // grace period: credentials kept, account visible but locked, restorable
    const g = await signIn(d.email, d.password);
    const meG = await http('GET', '/api/me', { cookie: g.cookie });
    expect(meG.json).toMatchObject({ state: 'pending_deletion' });
    const locked = await http('GET', '/api/economy/balance', { cookie: g.cookie });
    expect(locked.status).toBe(403); expect(locked.json.code).toBe('account_pending_deletion');
    expect((await http('POST', '/api/rooms/beach/join', { cookie: g.cookie, body: {} })).status).toBe(403);
    expect((await http('GET', '/api/me/export', { cookie: g.cookie })).status).toBe(200);
    expect(Number((await pool.query('select count(*) n from app.saves where player_id = $1', [d.id])).rows[0].n)).toBe(1);   // kept during grace
    const rs = await http('POST', '/api/me/restore', { cookie: g.cookie, body: {} });
    expect(rs.json).toMatchObject({ ok: true, restored: true });
    expect((await http('GET', '/api/economy/balance', { cookie: g.cookie })).json).toMatchObject({ ok: true, gold: 250 });
    expect((await pool.query('select closed_at, trade_frozen from eco.players where id = $1', [d.id])).rows[0]).toMatchObject({ closed_at: null, trade_frozen: false });
    // second request, then expiry -> scheduled job (same runOpsCheck as the cron) finalises + erases
    const del2 = await http('POST', '/api/me/delete', { cookie: g.cookie, body: { password: d.password, confirm: 'DELETE' } });
    expect(del2.status).toBe(200);
    const ledgerSnap = (await pool.query(`select md5(string_agg(id::text || ':' || amount || ':' || wallet_id, ',' order by id)) h, count(*) n from eco.ledger_entries`)).rows[0];
    await pool.query(`update eco.players set deletion_due_at = now() - interval '1 second' where id = $1`, [d.id]);
    const ops = (await http('GET', '/dev/ops/check')).json;
    expect(ops.retention.finalized).toBeGreaterThanOrEqual(1); expect(ops.retention.failed).toBe(0); expect(ops.retention.authErased).toBeGreaterThanOrEqual(1);
    const pl = (await pool.query('select closed_at, finalized_at, auth_erased_at from eco.players where id = $1', [d.id])).rows[0];
    expect(pl.finalized_at).not.toBeNull(); expect(pl.auth_erased_at).not.toBeNull();
    // ledger: old rows untouched (same ids/amounts), sweep appended (250 GOLD -> system sink), pseudonymised by uuid only
    const sameOld = (await pool.query(`select md5(string_agg(id::text || ':' || amount || ':' || wallet_id, ',' order by id)) h from (select * from eco.ledger_entries order by id limit $1) x`, [ledgerSnap.n])).rows[0];
    expect(sameOld.h).toBe(ledgerSnap.h);
    const sweep = (await pool.query(`select t.op_type, e.amount, w.purpose, w.player_id from prog.player_events pe join eco.ledger_tx t on t.id = pe.ledger_tx
                                      join eco.ledger_entries e on e.tx_id = t.id join eco.wallets w on w.id = e.wallet_id
                                      where pe.player_id = $1 and pe.type_id = 'account_finalized' order by e.amount`, [d.id])).rows;
    expect(sweep.map((r) => [r.op_type, Number(r.amount), r.purpose, r.player_id])).toEqual([['account_sweep', -250, 'main', d.id], ['account_sweep', 250, 'sink:account_closed', null]]);
    expect((await pool.query('select owner_id, state from eco.item_instances where id = $1', [item])).rows[0]).toMatchObject({ owner_id: '00000000-0000-0000-0000-000000000000', state: 'owned' });
    expect(Number((await pool.query('select count(*) n from app.saves where player_id = $1', [d.id])).rows[0].n)).toBe(0);
    const au = (await pool.query('select email, name, image, "emailVerified" from auth."user" where id = $1', [d.id])).rows[0];
    expect(au).toMatchObject({ email: `deleted+${d.id}@deleted.invalid`, name: 'deleted', image: null, emailVerified: false });
    for (const t of ['session', 'account', '"twoFactor"']) expect(Number((await pool.query(`select count(*) n from auth.${t} where "userId" = $1`, [d.id])).rows[0].n)).toBe(0);
    expect((await http('POST', '/api/auth/sign-in/email', { body: { email: d.email, password: d.password }, ip: freshIp() })).status).toBe(401);
    expect((await pool.query('select audit.verify_chain() r')).rows[0].r).toMatchObject({ broken: 0 });
    const acts = (await pool.query(`select action from audit.log where target = $1 order by id`, [d.id])).rows.map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['account_deletion_requested', 'account_restored', 'account_finalized', 'account_auth_erased']));
    const recon = (await pool.query('select eco.recon_summary() r')).rows[0].r;
    expect(Object.values(recon).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
    // a re-run is a no-op, and the e-mail address is free again (a NEW account with a new id)
    expect((await http('GET', '/dev/ops/check')).json.retention).toMatchObject({ failed: 0 });
    const re = await http('POST', '/api/auth/sign-up/email', { body: { email: d.email, password: 'brand-new-pass-123', name: 'n' }, ip: freshIp() });
    expect(re.status).toBe(200);
    const newId = (await pool.query('select id from auth."user" where email = $1', [d.email])).rows[0]?.id;
    expect(newId).toBeTruthy(); expect(newId).not.toBe(d.id);
    results.deletion = { policy: 'a', grace_days: 30, ws_closed: 4401, pending_api_status: 403, restored: true, swept_gold: 250, item_to_system: true,
      old_ledger_rows_unchanged: true, recon_nonzero: 0, audit_chain_broken: 0, auth_anonymised: true, email_reusable: true };
  });
});

describe('BUG-U5: revocation closes the open WebSocket inside the sign-out / revoke request (workerd, < 2 s)', () => {
  it('sign-out, revoke-sessions, revoke-other-sessions: 4401 well under 2 s, x-ws-revoked reports the fan-out', async () => {
    const u = await signUp(pool, 'u5');
    const lat: Record<string, number[]> = { 'sign-out': [], 'revoke-sessions': [], 'revoke-other-sessions': [] };
    for (let rep = 0; rep < 3; rep++) {
      for (const path of Object.keys(lat)) {
        const victim = await signIn(u.email, u.password);                     // session whose socket must close
        const keeper = path === 'revoke-other-sessions' ? await signIn(u.email, u.password) : victim;
        const j = await http('POST', '/api/rooms/beach/join', { cookie: victim.cookie, body: {} });
        const ws = await openWs(j.json.room, j.json.ticket); await ready(ws);
        const t0 = performance.now();
        const r = await post(`/api/auth/${path}`, {}, { cookie: keeper.cookie, ip: keeper.ip });
        expect(r.status).toBe(200);
        expect(r.headers.get('x-ws-revoked')).toMatch(/closed=[1-9]/);          // the DO fan-out ran before the response
        const closed = await waitClosed(ws, 3000);
        expect(closed).toMatchObject({ code: 4401 });
        lat[path].push(+(performance.now() - t0).toFixed(1));
        if (path === 'revoke-other-sessions') await post('/api/auth/sign-out', {}, { cookie: keeper.cookie, ip: keeper.ip });
      }
    }
    for (const [p, a] of Object.entries(lat)) expect(Math.max(...a), p).toBeLessThan(2000);
    results.revocation_latency_ms = Object.fromEntries(Object.entries(lat).map(([p, a]) => [p, { min: Math.min(...a), median: pct(a, 50), max: Math.max(...a) }]));
  });
});

describe('U7: verification link reuse', () => {
  it('a used link answers a plain already-verified redirect: no session, no cookie; forged tokens still go to Better Auth', async () => {
    const u = await signUp(pool, 'u7');                                            // signUp already used the link once
    const url = (await pool.query(`select url from auth.dev_mail where email = $1 and kind = 'verify' order by id desc limit 1`, [u.email])).rows[0].url as string;
    const sessionsBefore = Number((await pool.query('select count(*) n from auth.session where "userId" = $1', [u.id])).rows[0].n);
    for (let i = 0; i < 2; i++) {
      const r = await fetch(url, { redirect: 'manual' });
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toMatch(/[?&]status=already_verified$/);
      expect(r.headers.getSetCookie()).toEqual([]);
    }
    expect(Number((await pool.query('select count(*) n from auth.session where "userId" = $1', [u.id])).rows[0].n)).toBe(sessionsBefore);
    const t = new URL(url); const tok = t.searchParams.get('token')!;
    t.searchParams.set('token', tok.slice(0, -4) + (tok.endsWith('AAAA') ? 'BBBB' : 'AAAA'));   // bad signature: no shortcut, Better Auth refuses
    const f = await fetch(t, { redirect: 'manual' });
    expect(f.headers.get('location') ?? '').not.toMatch(/already_verified/);
    expect(f.headers.get('location') ?? '').toMatch(/error=INVALID_TOKEN/);
    results.verify_link_reuse = { status: 302, marker: 'status=already_verified', set_cookie: 0, new_sessions: 0, forged_token: 'INVALID_TOKEN' };
  });
});
