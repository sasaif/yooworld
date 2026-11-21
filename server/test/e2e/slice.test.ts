// Vertical slice end-to-end through the real Worker + Durable Objects (wrangler dev --local) and local Postgres.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startWrangler, stopWrangler, su, signUp, http, ikey, openWs, waitClosed, ready, sleep, localTicket, with2fa, type Client, BASE } from './harness';

const pool = su();
let A: Client, B: Client, C: Client;
beforeAll(async () => {
  await startWrangler();
  A = await signUp(pool, 'alice'); B = await signUp(pool, 'bob'); C = await signUp(pool, 'carol');
});
afterAll(async () => { await stopWrangler(); await pool.end(); });

describe('auth', () => {
  it('session works; no session -> 401; foreign Origin -> 403; unverified e-mail cannot sign in', async () => {
    expect((await http('GET', '/api/me', { cookie: A.cookie })).json).toMatchObject({ ok: true, id: A.id });
    expect((await http('GET', '/api/me')).status).toBe(401);
    expect((await http('POST', '/api/economy/daily', { cookie: A.cookie, origin: 'https://evil.example', headers: { 'idempotency-key': ikey() } })).status).toBe(403);
    expect((await http('POST', '/api/economy/daily', { cookie: A.cookie, origin: null, headers: { 'idempotency-key': ikey() } })).status).toBe(403);
    const email = `unverified-${Date.now()}@e2e.local`;
    await http('POST', '/api/auth/sign-up/email', { body: { email, password: 'correct-horse-battery-9', name: 'u' }, ip: '198.19.0.1' });
    expect((await http('POST', '/api/auth/sign-in/email', { body: { email, password: 'correct-horse-battery-9' }, ip: '198.19.0.1' })).status).toBe(403);
  });
});

describe('auth hardening (Better Auth review evidence)', () => {
  it('session cookie: __Secure- prefix, HttpOnly, Secure, SameSite=Lax; sign-in rate limit 5/min per IP', async () => {
    const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173', 'cf-connecting-ip': '198.19.1.1' }, body: JSON.stringify({ email: A.email, password: A.password }) });
    const sc = r.headers.getSetCookie().find((c) => c.includes('session_token'))!;
    expect(sc).toMatch(/^__Secure-better-auth\.session_token=/); expect(sc).toMatch(/HttpOnly/i); expect(sc).toMatch(/Secure/); expect(sc).toMatch(/SameSite=Lax/i);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await http('POST', '/api/auth/sign-in/email', { body: { email: A.email, password: 'wrong-password-xyz' }, ip: '198.19.2.2' })).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
    expect((await http('POST', '/api/auth/sign-in/email', { body: { email: A.email, password: 'wrong-password-xyz' }, ip: '198.19.2.3' })).status).toBe(401);
  });
});

describe('server saves + inventory', () => {
  it('save/load look with optimistic versioning; conflict -> 409; inventory listed', async () => {
    const put = (v: number, data: unknown) => http('PUT', '/api/save/look/default', { cookie: A.cookie, body: { base_version: v, data, schema: 1 } });
    expect((await put(0, { hair: 2, top: 'tshirt' })).json).toMatchObject({ ok: true, version: 1 });
    expect((await put(1, { hair: 3 })).json).toMatchObject({ version: 2 });
    const stale = await put(1, { hair: 9 });
    expect(stale.status).toBe(409); expect(stale.json.code).toBe('version_conflict');
    const g = await http('GET', '/api/save', { cookie: A.cookie });
    expect(g.json.saves.look).toMatchObject({ version: 2, data: { hair: 3 } });
    expect(g.json.saves.apartment).toBeNull();
    expect(Array.isArray(g.json.items)).toBe(true);
    expect(g.json.balances).toMatchObject({ test: true });
    expect((await http('GET', '/api/save', { cookie: B.cookie })).json.saves.look).toBeNull();   // other player's save invisible
  });
});

describe('beach room: directory, tickets, presence, movement, chat, reconnection', () => {
  it('joins via directory, sees others, movement validated, idle = 0 messages, chat, replacement on reconnect', async () => {
    const ja = await http('POST', '/api/rooms/beach/join', { cookie: A.cookie, body: {} });
    expect(ja.json).toMatchObject({ ok: true, shard: 1 });
    const jb = await http('POST', '/api/rooms/beach/join', { cookie: B.cookie, body: {} });
    expect(jb.json.room).toBe(ja.json.room);                       // fill-first: same shard
    const a = await openWs(ja.json.room, ja.json.ticket);
    await a.wait((m) => m.t === 'welcome');
    const b = await openWs(jb.json.room, jb.json.ticket);
    const wb = await b.wait((m) => m.t === 'welcome');
    expect(wb.players.map((p: any) => p.id).sort()).toEqual([A.id, B.id].sort());
    await a.wait((m) => m.t === 'joined' && m.id === B.id);
    // movement at client run speed (2.8 m/s) at 5 Hz is accepted and streamed
    let x = 7.2; for (let i = 0; i < 10; i++) { x += 0.5; a.send({ t: 'move', x, z: 1.3 }); await sleep(200); }
    const snap = await b.wait((m) => m.t === 'snap' && m.p.some((q: any) => q[0] === A.id && Math.abs(q[1] - x) < 0.01));
    expect(snap).toBeTruthy();
    expect(a.msgs.filter((m) => m.t === 'correct').length).toBe(0);
    // teleport refused
    a.send({ t: 'move', x: 1, z: 10 });
    expect((await a.wait((m) => m.t === 'correct')).reason).toBe('too_fast');
    // idle: no traffic at all
    await sleep(800); const nB = b.msgs.length; await sleep(1500);
    expect(b.msgs.length).toBe(nB);
    // chat
    a.send({ t: 'chat', text: 'Salut la plage', cid: 'c1' });
    expect((await b.wait((m) => m.t === 'chat')).text).toBe('Salut la plage');
    // reconnection: new ticket, old socket replaced (4001), same position, no duplicate avatar
    const ja2 = await http('POST', '/api/rooms/beach/join', { cookie: A.cookie, body: {} });
    expect(ja2.json).toMatchObject({ shard: 1, reason: 'present' });
    const a2 = await openWs(ja2.json.room, ja2.json.ticket);
    const w2 = await a2.wait((m) => m.t === 'welcome');
    expect((await waitClosed(a))?.code).toBe(4001);
    expect(w2.players.filter((p: any) => p.id === A.id).length).toBe(1);
    expect(w2.players.find((p: any) => p.id === A.id).pos.x).toBeCloseTo(x, 2);
    const stats = (await http('GET', `/dev/rooms/${ja.json.room}/stats`)).json;
    expect(stats.members).toBe(2);
    a2.ws.close(); b.ws.close();
  });
  it('unauthorized room access: forged / replayed / other-room / expired / missing tickets are refused', async () => {
    const j = await http('POST', '/api/rooms/beach/join', { cookie: C.cookie, body: {} });
    const [p, s] = j.json.ticket.split('.');
    const body = JSON.parse(Buffer.from(p, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...body, sub: A.id })).toString('base64url') + '.' + s;
    await expect(openWs(j.json.room, forged)).rejects.toMatchObject({ status: 401 });
    await expect(openWs('local:beach:2', j.json.ticket)).rejects.toMatchObject({ status: 401 });
    await expect(openWs(j.json.room, '')).rejects.toMatchObject({ status: 401 });
    const c1 = await openWs(j.json.room, j.json.ticket); await c1.wait((m) => m.t === 'welcome');
    const replay = await openWs(j.json.room, j.json.ticket);                  // signature valid, jti already used
    expect((await replay.wait((m) => m.t === 'error')).code).toBe('ticket_used');
    expect((await waitClosed(replay))?.code).toBe(4401);
    const evil = await (await import('../../src/core/ticket')).signTicket('x'.repeat(40), { sub: C.id, room: j.json.room, env: 'local', kind: 'public', cap: 30 });
    await expect(openWs(j.json.room, evil)).rejects.toMatchObject({ status: 401 });
    const expired = await (await import('../../src/core/ticket')).signTicket('local-only-e2e-ticket-secret-00000000000000', { sub: C.id, room: j.json.room, env: 'local', kind: 'public', cap: 30 }, 30_000, Date.now() - 60_000);
    await expect(openWs(j.json.room, expired)).rejects.toMatchObject({ status: 401 });
    const r = await fetch(`${BASE}/ws/${j.json.room}?ticket=${j.json.ticket}`);
    expect(r.status).toBe(426);
    c1.ws.close();
  });
  it('message rate limit closes a flooding client with 4008', async () => {
    const j = await http('POST', '/api/rooms/beach/join', { cookie: C.cookie, body: {} });
    const c = await openWs(j.json.room, j.json.ticket); await c.wait((m) => m.t === 'welcome');
    for (let i = 0; i < 100; i++) c.send({ t: 'chat', text: 'spam', cid: `s${i}` });
    expect((await waitClosed(c))?.code).toBe(4008);
  });
});

describe('apartments', () => {
  it('owner alone gets no realtime room; a visitor gets one; owner left alone is closed 4010', async () => {
    const r = await http('POST', `/api/rooms/apt/${A.id}/join`, { cookie: A.cookie });
    expect(r.json).toMatchObject({ ok: true, realtime: false });
    const v = await http('POST', `/api/rooms/apt/${A.id}/join`, { cookie: B.cookie });
    expect(v.json).toMatchObject({ realtime: true });
    const vb = await openWs(v.json.room, v.json.ticket); await ready(vb);
    const o = await http('POST', `/api/rooms/apt/${A.id}/join`, { cookie: A.cookie });
    expect(o.json.realtime).toBe(true);
    const oa = await openWs(o.json.room, o.json.ticket); await ready(oa);
    vb.ws.close();
    expect((await waitClosed(oa))?.code).toBe(4010);
  });
});

describe('events: list by category, cap from config, kick + 1 h ban', () => {
  it('owner kicks a guest: closed 4003, rejoin refused (API and room), non-owner cannot kick', async () => {
    const cat = (await pool.query('select id from social.event_categories where active limit 1')).rows[0].id;
    const ev = await http('POST', '/api/events', { cookie: A.cookie, body: { category: cat, title: 'Soirée plage', minutes: 60 } });
    expect(ev.json).toMatchObject({ ok: true });
    const list = await http('GET', `/api/events?category=${cat}`, { cookie: B.cookie });
    const found = list.json.events.find((e: any) => e.id === ev.json.event);
    expect(found).toMatchObject({ capacity: 20 });
    expect((await http('GET', `/api/events?category=nope-cat`, { cookie: B.cookie })).json.events).toEqual([]);
    const jb = await http('POST', `/api/events/${ev.json.event}/join`, { cookie: B.cookie });
    const b = await openWs(jb.json.room, jb.json.ticket); await ready(b);
    expect((await http('POST', `/api/events/${ev.json.event}/kick`, { cookie: C.cookie, body: { target: B.id } })).status).toBe(403);
    const k = await http('POST', `/api/events/${ev.json.event}/kick`, { cookie: A.cookie, body: { target: B.id, reason: 'test' } });
    expect(k.json).toMatchObject({ ok: true, wasPresent: true });
    expect(k.json.until - Date.now()).toBeGreaterThan(59 * 60_000);
    expect((await waitClosed(b))?.code).toBe(4003);
    const again = await http('POST', `/api/events/${ev.json.event}/join`, { cookie: B.cookie });
    expect(again.status).toBe(403); expect(again.json.code).toBe('kicked');
    // even with a valid signed ticket (bypassing the API), the room refuses
    const t = await localTicket(jb.json.room, B.id, 'event', 20, A.id);
    const b2 = await openWs(jb.json.room, t);
    expect((await b2.wait((m) => m.t === 'error')).code).toBe('kicked');
    (globalThis as any).__event = { room: jb.json.room, event: ev.json.event, bannedB: B.id, owner: A.id };
  });
});

describe('economy (TEST Gold): grant, daily, factory/farm with presence, anti-farming', () => {
  it('test grant + daily once per day, idempotent', async () => {
    const k = ikey();
    expect((await http('POST', '/api/economy/test-grant', { cookie: C.cookie, body: { amount: 500 }, headers: { 'idempotency-key': k } })).json).toMatchObject({ ok: true, currency: 'GOLD_TEST' });
    expect((await http('POST', '/api/economy/test-grant', { cookie: C.cookie, body: { amount: 500 }, headers: { 'idempotency-key': k } })).json).toMatchObject({ replayed: true });
    expect((await http('POST', '/api/economy/test-grant', { cookie: C.cookie, body: { amount: 500 } })).status).toBe(400);
    expect((await http('POST', '/api/economy/daily', { cookie: C.cookie, headers: { 'idempotency-key': ikey() } })).json).toMatchObject({ ok: true, gold: 150 });
    const d2 = await http('POST', '/api/economy/daily', { cookie: C.cookie, headers: { 'idempotency-key': ikey() } });
    expect(d2.status).toBe(409); expect(d2.json.code).toBe('already_claimed');
    expect((await http('GET', '/api/economy/balance', { cookie: C.cookie })).json).toMatchObject({ gold: 650, test: true });
  });
  it('factory: must be present in a factory room to start and to complete a task; server clock enforces 30 s', async () => {
    const j = await http('POST', '/api/rooms/factory/join', { cookie: B.cookie, body: {} });
    // not connected yet -> refused
    expect((await http('POST', '/api/activities/factory/start', { cookie: B.cookie, body: { room: j.json.room }, headers: { 'idempotency-key': ikey() } })).status).toBe(403);
    // claiming another location's room -> refused
    expect((await http('POST', '/api/activities/factory/start', { cookie: B.cookie, body: { room: 'local:beach:1' }, headers: { 'idempotency-key': ikey() } })).status).toBe(403);
    const ws = await openWs(j.json.room, j.json.ticket); await ws.wait((m) => m.t === 'welcome');
    const s = await http('POST', '/api/activities/factory/start', { cookie: B.cookie, body: { room: j.json.room }, headers: { 'idempotency-key': ikey() } });
    expect(s.json).toMatchObject({ ok: true });
    const t1 = await http('POST', `/api/activities/sessions/${s.json.session}/task`, { cookie: B.cookie, headers: { 'idempotency-key': ikey() } });
    expect(t1.status).toBe(429); expect(t1.json.code).toBe('too_fast');
    await pool.query(`update eco.activity_sessions set started_at = now() - interval '31 seconds' where id = $1`, [s.json.session]);
    expect((await http('POST', `/api/activities/sessions/${s.json.session}/task`, { cookie: B.cookie, headers: { 'idempotency-key': ikey() } })).json).toMatchObject({ ok: true, gold: 20 });
    // farming via rooms: leave the room -> next task refused even when the timer allows it
    ws.ws.close(); await sleep(500);
    await pool.query(`update eco.activity_sessions set last_task_at = now() - interval '31 seconds' where id = $1`, [s.json.session]);
    const t3 = await http('POST', `/api/activities/sessions/${s.json.session}/task`, { cookie: B.cookie, headers: { 'idempotency-key': ikey() } });
    expect(t3.status).toBe(403); expect(t3.json.code).toBe('not_in_room');
    // another player cannot use B's session
    expect((await http('POST', `/api/activities/sessions/${s.json.session}/task`, { cookie: C.cookie, headers: { 'idempotency-key': ikey() } })).status).toBe(404);
  });
  it('farm: 15 TEST Gold per task after 45 s, presence required; parallel task farming pays once', async () => {
    const j = await http('POST', '/api/rooms/farm/join', { cookie: C.cookie, body: {} });
    const ws = await openWs(j.json.room, j.json.ticket); await ws.wait((m) => m.t === 'welcome');
    const s = await http('POST', '/api/activities/farm/start', { cookie: C.cookie, body: { room: j.json.room }, headers: { 'idempotency-key': ikey() } });
    await pool.query(`update eco.activity_sessions set started_at = now() - interval '46 seconds' where id = $1`, [s.json.session]);
    const before = (await http('GET', '/api/economy/balance', { cookie: C.cookie })).json.gold;
    const rs = await Promise.all(Array.from({ length: 10 }, () => http('POST', `/api/activities/sessions/${s.json.session}/task`, { cookie: C.cookie, headers: { 'idempotency-key': ikey() } })));
    expect(rs.filter((r) => r.json.ok).length).toBe(1);
    expect((await http('GET', '/api/economy/balance', { cookie: C.cookie })).json.gold).toBe(before + 15);
    ws.ws.close();
  });
});

describe('Dominoes: server-authoritative result, forged results impossible', () => {
  it('plays through the API; claim before end refused; client-sent result ignored; outsider refused; replay idempotent', async () => {
    const t = (await http('POST', '/api/tables', { cookie: A.cookie })).json.table;
    expect((await http('POST', `/api/tables/${t}/claim`, { cookie: A.cookie, body: { winners: [A.id] } })).json.code).toBe('not_started');
    expect((await http('POST', `/api/tables/${t}/join`, { cookie: B.cookie })).json).toMatchObject({ ok: true, started: true });
    expect((await http('POST', `/api/tables/${t}/join`, { cookie: C.cookie })).status).toBe(409);
    const forgedEarly = await http('POST', `/api/tables/${t}/claim`, { cookie: A.cookie, body: { winners: [A.id], scores: [999, 0], over: true } });
    expect(forgedEarly.status).toBe(409); expect(forgedEarly.json.code).toBe('not_over');
    const players = { [A.id]: A, [B.id]: B };
    let guard = 0;
    for (;;) {
      if (guard++ > 300) throw new Error('game did not end');
      const va = (await http('GET', `/api/tables/${t}`, { cookie: A.cookie })).json;
      if (va.over) break;
      const turnSeat = va.view.turn; const who = players[va.players[turnSeat]];
      const v = (await http('GET', `/api/tables/${t}`, { cookie: who.cookie })).json;
      const other = who === A ? B : A;
      if (guard === 1) {   // illegal / out-of-turn moves refused by the server engine
        expect((await http('POST', `/api/tables/${t}/move`, { cookie: other.cookie, body: { move: v.legal[0], seq: v.seq } })).json.code).toBe('not_your_turn');
        expect((await http('POST', `/api/tables/${t}/move`, { cookie: who.cookie, body: { move: { type: 'play', tile: [7, 7], end: 'L' }, seq: v.seq } })).json.code).toBe('illegal_move');
      }
      const m = await http('POST', `/api/tables/${t}/move`, { cookie: who.cookie, body: { move: v.legal[0], seq: v.seq } });
      expect(m.json.ok).toBe(true);
    }
    expect((await http('POST', `/api/tables/${t}/claim`, { cookie: C.cookie })).status).toBe(403);
    const loser = await (async () => { const v = (await http('GET', `/api/tables/${t}`, { cookie: A.cookie })).json; return v; })();
    const forged = await http('POST', `/api/tables/${t}/claim`, { cookie: B.cookie, body: { winners: [B.id], scores: [0, 999] } });
    expect(forged.json.ok).toBe(true);
    const row = (await pool.query('select players, winners, scores, moves from prog.match_results where table_id = $1', [t])).rows[0];
    expect(row.players).toEqual(loser.players);
    expect(row.scores).toEqual(loser.view.scores);                  // engine scores, not the forged 999
    expect(row.scores).not.toContain(999);
    const again = await http('POST', `/api/tables/${t}/claim`, { cookie: A.cookie });
    expect(again.json).toMatchObject({ ok: true, replayed: true });
    // no Gold attached to Dominoes (no client economy change)
    const n = (await pool.query(`select count(*)::int n from eco.ledger_tx where actor like '%' || $1 || '%' and op_type not in ('test_grant','reward','activity')`, [A.id])).rows[0].n;
    expect(n).toBe(0);
  });
});

describe('admin: 2FA required, second admin approves', () => {
  it('admin without 2FA refused; requester cannot approve; second admin approves; audit chain intact', async () => {
    const adm1 = await signUp(pool, 'admin1'); const adm2 = await signUp(pool, 'admin2');
    await pool.query(`insert into audit.admins(user_id, added_by) values ($1,'e2e'),($2,'e2e')`, [adm1.id, adm2.id]);
    const body = { player: C.id, base: 'GOLD', amount: 250, reason: 'compensation incident 7' };
    const no2fa = await http('POST', '/api/admin/adjust', { cookie: adm1.cookie, body });
    expect(no2fa.status).toBe(403); expect(no2fa.json.code).toBe('admin_2fa');
    expect((await http('POST', '/api/admin/adjust', { cookie: C.cookie, body })).status).toBe(403);
    const a1 = await with2fa(adm1); const a2 = await with2fa(adm2);
    const req = await http('POST', '/api/admin/adjust', { cookie: a1.cookie, body });
    expect(req.json).toMatchObject({ ok: true });
    const self = await http('POST', `/api/admin/approvals/${req.json.request}/approve`, { cookie: a1.cookie });
    expect(self.status).toBe(403); expect(self.json.code).toBe('same_admin');
    const before = (await http('GET', '/api/economy/balance', { cookie: C.cookie })).json.gold;
    expect((await http('POST', `/api/admin/approvals/${req.json.request}/approve`, { cookie: a2.cookie })).json).toMatchObject({ ok: true, amount: 250 });
    expect((await http('GET', '/api/economy/balance', { cookie: C.cookie })).json.gold).toBe(before + 250);
    expect((await pool.query('select audit.verify_chain() r')).rows[0].r.broken).toBe(0);
  });
});

describe('reconciliation after the whole slice', () => {
  it('ledger reconciliation is all zeros', async () => {
    const r = (await pool.query('select eco.recon_summary() r')).rows[0].r;
    expect(Object.values(r).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
  });
});
