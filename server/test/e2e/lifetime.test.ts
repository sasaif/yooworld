// M4 revocation (ii): WebSocket lifetime cap. WS_MAX_LIFETIME_S=3 here (production default 86400 = 24 h): the room
// closes the socket with 4402 'lifetime' at expiry (alarm, no traffic needed) and the client reconnects with a fresh
// ticket. Also: a session revoked while the player sits in a room → 4401 and the player leaves the room.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startWrangler, stopWrangler, su, signUp, signIn, http, openWs, ready, waitClosed, sleep } from './harness';

const pool = su();
beforeAll(async () => { await startWrangler({ WS_MAX_LIFETIME_S: '3' }); });
afterAll(async () => { await stopWrangler(); await pool.end(); });

describe('WebSocket lifetime cap', () => {
  it('idle socket closed with 4402 at the cap; a fresh ticket reconnects; peers see the leave', async () => {
    const a = await signUp(pool, 'lt'), b = await signUp(pool, 'lt');
    const ja = await http('POST', '/api/rooms/beach/join', { cookie: a.cookie, body: { friends: [b.id] } });
    const wa = await openWs(ja.json.room, ja.json.ticket); await ready(wa);
    const t0 = Date.now();
    await sleep(1500);
    const jb = await http('POST', '/api/rooms/beach/join', { cookie: b.cookie, body: { friends: [a.id] } });
    expect(jb.json.room).toBe(ja.json.room);
    const wb = await openWs(jb.json.room, jb.json.ticket); await ready(wb);
    const ca = await waitClosed(wa, 6000);
    const lived = Date.now() - t0;
    expect(ca).toMatchObject({ code: 4402, reason: 'lifetime' });
    expect(lived).toBeGreaterThanOrEqual(2900); expect(lived).toBeLessThan(5000);
    expect(wa.msgs.some((m) => m.t === 'error' && m.code === 'ws_lifetime')).toBe(true);
    await wb.wait((m) => m.t === 'left' && m.id === a.id && m.reason === 'lifetime', 3000);
    // reconnect: same session, NEW ticket (the old one is single-use and expired anyway)
    const ja2 = await http('POST', '/api/rooms/beach/join', { cookie: a.cookie, body: { friends: [b.id] } });
    expect(ja2.json.ticket).not.toBe(ja.json.ticket);
    const wa2 = await openWs(ja2.json.room, ja2.json.ticket); await ready(wa2);
    expect(wa2.closed).toBeNull();
    const old = await openWs(ja.json.room, ja.json.ticket).catch(() => null);           // replaying the old ticket fails
    if (old) expect(await waitClosed(old, 3000)).not.toBeNull();
    // b, opened 1.5 s later, is closed ~1.5 s after a (per-socket deadline, not per-room)
    const cb = await waitClosed(wb, 6000);
    expect(cb).toMatchObject({ code: 4402 });
    console.log(`[MESURÉ] lifetime cap 3 s: socket closed after ${lived} ms`);
    wa2.ws.close();
  }, 30_000);

  it('revoking one session closes only the sockets of that session', async () => {
    const u = await signUp(pool, 'rs');
    const s2 = await signIn(u.email, u.password);
    const j1 = await http('POST', '/api/rooms/beach/join', { cookie: u.cookie, body: {} });
    const w1 = await openWs(j1.json.room, j1.json.ticket); await ready(w1);
    const j2 = await http('POST', '/api/rooms/farm/join', { cookie: s2.cookie, body: {} });
    const sessions = (await pool.query('select id, token from auth.session where "userId" = $1 order by "createdAt"', [u.id])).rows;
    expect(sessions.length).toBe(2);
    const rv = await http('POST', '/api/auth/revoke-session', { cookie: u.cookie, body: { token: sessions[1].token }, ip: u.ip });
    expect(rv.status).toBe(200);
    await sleep(500);
    expect(w1.closed).toBeNull();                                 // the other session's socket stays open
    expect((await http('GET', '/api/me', { cookie: s2.cookie })).status).toBe(401);
    expect(j2.status).toBe(200);
    await expect(openWs(j2.json.room, j2.json.ticket)).rejects.toMatchObject({ status: 401 });   // ticket signed BEFORE the revocation: refused at upgrade
    // revoke-all (as /me/delete does) also refuses tickets signed before it
    const s3 = await signIn(u.email, u.password);
    const j3 = await http('POST', '/api/rooms/factory/join', { cookie: s3.cookie, body: {} });
    expect((await http('POST', '/api/auth/revoke-sessions', { cookie: u.cookie, body: {}, ip: u.ip })).status).toBe(200);
    expect(await waitClosed(w1, 3000)).toMatchObject({ code: 4401 });
    await expect(openWs(j3.json.room, j3.json.ticket)).rejects.toMatchObject({ status: 401 });
  }, 30_000);
});
