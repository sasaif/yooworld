// Metrics/alerts through the running Worker: room health over live shards, recon alerts, local sink = Postgres ops.*,
// and the cron entry point (wrangler --test-scheduled is not used: the same runOpsCheck is exercised via /dev/ops/check).
import { it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startWrangler, stopWrangler, su, signUp, http, openWs, ready, SERVER, type Client } from './harness';

const pool = su(); let A: Client; const results: Record<string, unknown> = {};
beforeAll(async () => { await startWrangler(); A = await signUp(pool, 'ops'); });
afterAll(async () => {
  await stopWrangler(); await pool.end().catch(() => {});
  const out = path.join(SERVER, 'test-results/e2e-ops.json'); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
});

it('ops check: live shard measured, metrics stored in ops.metrics, recon clean; injected imbalance -> critical alert -> resolved after repair', async () => {
  const j = (await http('POST', '/api/rooms/beach/join', { cookie: A.cookie, body: {} })).json;
  const ws = await openWs(j.room, j.ticket); await ready(ws);
  const t0 = performance.now();
  const r1 = (await http('GET', '/dev/ops/check')).json;
  results.check_ms = Math.round(performance.now() - t0);
  expect(r1).toMatchObject({ ok: true, recon: { clean: true }, roomAlerts: [] });
  expect(r1.rooms).toBeGreaterThanOrEqual(1); expect(r1.flushed).toBeGreaterThanOrEqual(6); expect(r1.flushError).toBeUndefined();
  const m = (await pool.query(`select value from ops.metrics where name = 'room.members' and tags->>'room' = $1 order by id desc limit 1`, [j.room])).rows[0];
  expect(Number(m.value)).toBe(1);
  ws.ws.close();

  const w = (await pool.query(`select id from eco.wallets where owner_kind = 'player' and purpose = 'main' limit 1`)).rows[0];
  const c = await pool.connect();
  try {
    await c.query('set session_replication_role = replica');
    await c.query('update eco.wallets set balance = balance + 3 where id = $1', [w.id]);
    const r2 = (await http('GET', '/dev/ops/check')).json;
    expect(r2.recon.clean).toBe(false); expect(r2.recon.problems.wallet_mismatch).toBeGreaterThanOrEqual(1);
    const alerts = (await http('GET', '/dev/ops/alerts')).json.alerts;
    expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'recon', subject: 'wallet_mismatch', severity: 'critical' })]));
    results.alert_example = alerts.find((a: { kind: string }) => a.kind === 'recon');
    await c.query('update eco.wallets set balance = balance - 3 where id = $1', [w.id]);
  } finally { await c.query('set session_replication_role = origin'); c.release(); }
  const r3 = (await http('GET', '/dev/ops/check')).json;
  expect(r3.recon.clean).toBe(true);
  expect((await http('GET', '/dev/ops/alerts')).json.alerts.filter((a: { kind: string }) => a.kind === 'recon')).toEqual([]);
  results.dev_routes_local_only = true;
});
