// Cost-per-player-hour harness [MESURÉ: counters] + [ESTIMATION: $ from public Cloudflare DO pricing, 2026-11-20].
// One beach room, 25 clients: phase MOVE (everyone moves at 5 Hz, chats every 10 s) then phase IDLE (nobody moves).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startWrangler, stopWrangler, http, openWs, ready, sleep, localTicket, type WsClient, SERVER } from './harness';

const N = 25, MOVE_S = Number(process.env.COST_MOVE_S || 20), IDLE_S = Number(process.env.COST_IDLE_S || 20);
beforeAll(async () => { await startWrangler(); }); afterAll(async () => { await stopWrangler(); });

describe('cost harness', () => {
  it('measures messages, bytes and ticks per client for moving vs idle phases', async () => {
    const room = `local:beach:${900 + Math.floor(Math.random() * 90)}`;
    const id = (i: number) => `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`;
    const cs: WsClient[] = [];
    for (let i = 0; i < N; i++) { const c = await openWs(room, await localTicket(room, id(i))); await ready(c); cs.push(c); }
    await sleep(1500);
    const stats = async () => (await http('GET', `/dev/rooms/${room}/stats`)).json;
    const s0 = await stats(); const b0 = cs.reduce((a, c) => a + c.bytesIn, 0); const m0 = cs.reduce((a, c) => a + c.msgs.length, 0);
    // MOVE phase: every client walks a small circle at <= run speed, 5 Hz; chats once every 10 s
    const pos = cs.map(() => ({ x: 7.2 - 0.8, z: 1.3, a: 0 }));      // circle starting at the spawn (7.2, 1.3)
    const t0 = Date.now(); let tick = 0;
    while (Date.now() - t0 < MOVE_S * 1000) {
      tick++;
      cs.forEach((c, i) => { const p = pos[i]; p.a += 0.4; c.send({ t: 'move', x: +(p.x + 0.8 * Math.cos(p.a)).toFixed(3), z: +(p.z + 0.8 * Math.sin(p.a)).toFixed(3) });
        if (tick % 50 === i % 50) c.send({ t: 'chat', text: 'hello beach', cid: `c${tick}-${i}` }); });
      await sleep(200);
    }
    await sleep(800);
    const s1 = await stats(); const b1 = cs.reduce((a, c) => a + c.bytesIn, 0); const m1 = cs.reduce((a, c) => a + c.msgs.length, 0);
    await sleep(IDLE_S * 1000);
    const s2 = await stats(); const b2 = cs.reduce((a, c) => a + c.bytesIn, 0); const m2 = cs.reduce((a, c) => a + c.msgs.length, 0);
    const corrections = cs.reduce((a, c) => a + c.msgs.filter((m) => m.t === 'correct').length, 0);
    expect(corrections).toBe(0);
    expect(m2 - m1).toBe(0);                         // idle phase: zero messages to clients

    const move = { seconds: MOVE_S, ws_in: s1.wsMessages - s0.wsMessages, ws_out: m1 - m0, bytes_out: b1 - b0, alarms: s1.alarms - s0.alarms };
    // in-memory counters restart when the idle room is evicted from memory (hibernation): constructs tells us
    const evicted = s2.constructs > s1.constructs;
    const d = (k: 'wsMessages' | 'alarms') => (evicted ? s2[k] : s2[k] - s1[k]);
    const idle = { seconds: IDLE_S, ws_in: d('wsMessages'), ws_out: m2 - m1, bytes_out: b2 - b1, alarms: d('alarms'), room_evicted_while_idle: evicted };
    const perPlayerHour = (p: { seconds: number; ws_in: number; ws_out: number; bytes_out: number; alarms: number }) => {
      const k = 3600 / p.seconds / N;
      return { ws_in: Math.round(p.ws_in * k), ws_out: Math.round(p.ws_out * k), bytes_out: Math.round(p.bytes_out * k), alarms: Math.round(p.alarms * k) };
    };
    // ---- ESTIMATION (public pricing, Workers Paid, beyond included usage): requests $0.15/M (incoming WS msgs 20:1,
    // alarms count as requests), duration $12.50/M GB-s at 128 MB. Duration upper bound = room awake the whole moving
    // time (shared by the N players); idle hibernatable time is not billed.
    const PRICE_REQ = 0.15 / 1e6, PRICE_GBS = 12.5 / 1e6, GB = 0.128;
    const est = (p: ReturnType<typeof perPlayerHour>, awakeFraction: number) => {
      const req = p.ws_in / 20 + p.alarms; const gbs = 3600 * awakeFraction * GB / N;
      return { billed_requests: Math.round(req), gb_s_upper: +gbs.toFixed(2), usd_upper: +(req * PRICE_REQ + gbs * PRICE_GBS).toFixed(6) };
    };
    expect(idle.alarms).toBeLessThanOrEqual(2); expect(idle.ws_in).toBe(0);
    const pm = perPlayerHour(move), pi = perPlayerHour(idle);
    const out = {
      label: 'MESURÉ (counters, wrangler dev --local) + ESTIMATION ($)', clients_per_room: N, move, idle,
      per_player_hour: { moving: pm, idle: pi },
      estimate_usd_per_player_hour: { moving_100pct: est(pm, 1), idle_100pct: est(pi, 0), mixed_30pct_moving: {
        usd_upper: +(0.3 * est(pm, 1).usd_upper + 0.7 * est(pi, 0).usd_upper).toFixed(6) } },
      assumptions: ['Cloudflare DO pricing page fetched 2026-11-20', '128 MB per DO', 'room awake 100% while anyone moves (upper bound)',
        'idle room hibernates (setWebSocketAutoResponse pings do not wake it)', 'API Worker, Postgres (Neon), R2 and egress NOT included', '30% moving is a PROPOSITION, not measured on real players'],
    };
    fs.mkdirSync(path.join(SERVER, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(SERVER, 'test-results/cost-harness.json'), JSON.stringify(out, null, 2));
    for (const c of cs) c.ws.close();
  });
});
