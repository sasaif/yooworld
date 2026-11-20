// Resilience: kick ban survives a Worker/DO restart, Postgres outage -> 503 + Retry-After (rooms keep chatting),
// recovery after the DB returns, reconnect storm (~500 clients).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startWrangler, stopWrangler, su, signUp, http, openWs, waitClosed, ready, sleep, localTicket, pgStop, pgStart, type Client, type WsClient, SERVER } from './harness';

let pool = su();
let A: Client, B: Client;
const results: Record<string, unknown> = {};
beforeAll(async () => { await startWrangler(); A = await signUp(pool, 'owner'); B = await signUp(pool, 'guest'); });
afterAll(async () => {
  await stopWrangler(); await pool.end().catch(() => {});
  const out = path.join(SERVER, 'test-results/e2e-resilience.json'); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
});

describe('event kick ban survives a restart', () => {
  it('ban stored in the room DO (SQLite) and in Postgres; still enforced after wrangler/DO restart', async () => {
    const cat = (await pool.query('select id from social.event_categories where active limit 1')).rows[0].id;
    const ev = (await http('POST', '/api/events', { cookie: A.cookie, body: { category: cat, title: 'Ban test', minutes: 60 } })).json.event;
    const jb = (await http('POST', `/api/events/${ev}/join`, { cookie: B.cookie })).json;
    const b = await openWs(jb.room, jb.ticket); await ready(b);
    await http('POST', `/api/events/${ev}/kick`, { cookie: A.cookie, body: { target: B.id } });
    expect((await waitClosed(b))?.code).toBe(4003);
    const before = (await http('GET', `/dev/rooms/${jb.room}/stats`)).json.constructs;
    await stopWrangler(); await startWrangler();
    const after = (await http('GET', `/dev/rooms/${jb.room}/stats`)).json.constructs;
    expect(after).toBeGreaterThan(before);                          // the DO really restarted
    const t = await localTicket(jb.room, B.id, 'event', 20, A.id);   // valid signed ticket, bypassing the API check
    const b2 = await openWs(jb.room, t);
    const err = await b2.wait((m) => m.t === 'error');
    expect(err.code).toBe('kicked'); expect(err.until - Date.now()).toBeGreaterThan(55 * 60_000);
    expect((await http('POST', `/api/events/${ev}/join`, { cookie: B.cookie })).json.code).toBe('kicked');
    results.ban_after_restart = { constructs_before: before, constructs_after: after, refused: err.code };
  });
});

describe('Postgres outage', () => {
  it('session / ticket / save endpoints -> 503 + Retry-After; live room chat continues; recovers after restart', async () => {
    const j = (await http('POST', '/api/rooms/beach/join', { cookie: A.cookie, body: {} })).json;
    const jb = (await http('POST', '/api/rooms/beach/join', { cookie: B.cookie, body: {} })).json;
    const a = await openWs(j.room, j.ticket); await ready(a);
    const b = await openWs(jb.room, jb.ticket); await ready(b);
    await pool.end(); pgStop(); const t0 = Date.now();
    try {
      const probes = {
        session: await http('GET', '/api/auth/get-session', { cookie: A.cookie }),
        me: await http('GET', '/api/me', { cookie: A.cookie }),
        ticket: await http('POST', '/api/rooms/beach/join', { cookie: A.cookie, body: {} }),
        save_get: await http('GET', '/api/save', { cookie: A.cookie }),
        save_put: await http('PUT', '/api/save/look/default', { cookie: A.cookie, body: { base_version: 0, data: {}, schema: 1 } }),
      };
      const summary = Object.fromEntries(Object.entries(probes).map(([k, r]) => [k, { status: r.status, retryAfter: r.headers.get('retry-after') }]));
      results.db_down = summary;
      for (const [k, r] of Object.entries(probes)) {
        expect(r.status, k).toBe(503); expect(r.headers.get('retry-after'), k).toBe('5'); expect(r.json.code).toBe('db_unavailable');
      }
      a.send({ t: 'chat', text: 'pendant la panne', cid: 'outage-1' });
      expect((await b.wait((m) => m.t === 'chat' && m.text === 'pendant la panne')).from).toBe(A.id);
    } finally { pgStart(); pool = su(); }
    let ok = 0; for (let i = 0; i < 40 && ok !== 200; i++) { ok = (await http('GET', '/api/me', { cookie: A.cookie })).status; if (ok !== 200) await sleep(250); }
    expect(ok).toBe(200);
    results.db_down_recovery_ms = Date.now() - t0;
    a.ws.close(); b.ws.close();
  });
});

describe('reconnect storm', () => {
  it('500 clients in 20 rooms drop at once and reconnect at once: all back, no duplicate avatars, rooms consistent', async () => {
    const ROOMS = 20, PER = 25, N = ROOMS * PER;
    const room = (r: number) => `local:beach:${500 + r}`;
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const connectAll = async () => {
      const t0 = performance.now(); const fails: string[] = []; const cs: (WsClient | null)[] = [];
      await Promise.all(Array.from({ length: N }, async (_, i) => {
        try { const c = await openWs(room(i % ROOMS), await localTicket(room(i % ROOMS), id(i))); await ready(c); cs[i] = c; }
        catch (e) { fails.push((e as Error).message); cs[i] = null; }
      }));
      return { ms: Math.round(performance.now() - t0), fails, cs };
    };
    const first = await connectAll();
    expect(first.fails).toEqual([]);
    for (const c of first.cs) c!.ws.terminate();                     // abrupt drop of all 500 (no close frame)
    const storm = await connectAll();
    const counts = await Promise.all(Array.from({ length: ROOMS }, async (_, r) => (await http('GET', `/dev/rooms/${room(r)}/stats`)).json));
    results.reconnect_storm = { clients: N, rooms: ROOMS, first_connect_ms: first.ms, storm_reconnect_ms: storm.ms, failures: storm.fails.length,
      members_per_room: counts.map((c) => c.members), sockets_per_room: counts.map((c) => c.sockets) };
    expect(storm.fails).toEqual([]);
    expect(counts.every((c) => c.members === PER)).toBe(true);
    // replacement storm: everyone reconnects while the old socket is still open -> old closed 4001, never 2 avatars
    const again = await connectAll();
    await sleep(1000);
    const replaced = storm.cs.filter((c) => c!.closed?.code === 4001).length;
    const counts2 = await Promise.all(Array.from({ length: ROOMS }, async (_, r) => (await http('GET', `/dev/rooms/${room(r)}/stats`)).json.members));
    (results.reconnect_storm as any).replacement = { ms: again.ms, failures: again.fails.length, old_closed_4001: replaced, members_per_room: counts2 };
    expect(again.fails).toEqual([]); expect(replaced).toBe(N); expect(counts2.every((n) => n === PER)).toBe(true);
    for (const c of again.cs) c!.ws.close();
  });
});
