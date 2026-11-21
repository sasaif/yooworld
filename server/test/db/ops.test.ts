// 0012_ops: metric ingest, deduplicated alerts, reconciliation check raising/resolving critical alerts.
import { describe, it, expect, afterAll } from 'vitest';
import { superPool, rolePool, newPlayer, key } from '../helpers/db';

const su = superPool();
const api = rolePool('app_api', 3);
afterAll(async () => { await Promise.all([su.end(), api.end()]); });
const one = async (sql: string, p: unknown[] = []) => (await api.query(sql, p)).rows[0].r;

describe('ops schema', () => {
  it('ingest validates every sample; app_api cannot read or write the tables directly', async () => {
    const tag = `t${Date.now()}`;
    expect(await one('select ops.ingest($1) r', [JSON.stringify([{ name: 'test.a', value: 1, tags: { tag } }, { name: 'test.b', value: 2.5, tags: { tag }, at: Date.now() }])])).toEqual({ ok: true, stored: 2 });
    expect(await one('select ops.ingest($1) r', [JSON.stringify([{ name: 'Bad Name', value: 1 }])])).toEqual({ ok: false, code: 'bad_metric' });
    expect(await one('select ops.ingest($1) r', [JSON.stringify([{ name: 'test.c', value: 'NaN' }])])).toEqual({ ok: false, code: 'bad_metric' });
    expect(await one('select ops.ingest($1) r', [JSON.stringify(Array.from({ length: 501 }, () => ({ name: 'a.b', value: 1 })))])).toEqual({ ok: false, code: 'bad_batch' });
    expect(Number((await su.query(`select count(*) n from ops.metrics where tags->>'tag' = $1`, [tag])).rows[0].n)).toBe(2);
    await expect(api.query('select * from ops.metrics limit 1')).rejects.toThrow(/permission denied/);
    await expect(api.query(`insert into ops.alerts(kind, severity) values ('x.y','info')`)).rejects.toThrow(/permission denied/);
    expect(Number((await su.query(`select n from ops.metrics_hourly where name = 'test.a' order by hour desc limit 1`)).rows[0].n)).toBeGreaterThanOrEqual(1);
  });
  it('alerts are deduplicated per (kind, subject) while open; severity only escalates; resolve closes', async () => {
    const s = `room-${Date.now()}`;
    expect(await one(`select ops.raise_alert('room.socket_leak', $1, 'warn', '{"n":1}') r`, [s])).toMatchObject({ ok: true, count: 1, new: true });
    expect(await one(`select ops.raise_alert('room.socket_leak', $1, 'info', '{"n":2}') r`, [s])).toMatchObject({ count: 2, new: false });
    const open = (await one('select ops.open_alerts() r')).filter((a: { subject: string }) => a.subject === s);
    expect(open).toHaveLength(1); expect(open[0]).toMatchObject({ severity: 'warn', count: 2, detail: { n: 2 } });
    expect(await one(`select ops.resolve_alert('room.socket_leak', $1) r`, [s])).toEqual({ ok: true, resolved: 1 });
    expect(await one(`select ops.raise_alert('room.socket_leak', $1, 'warn', '{}') r`, [s])).toMatchObject({ new: true });   // new incident
    expect(await one(`select ops.raise_alert('BAD', $1, 'warn', '{}') r`, [s])).toEqual({ ok: false, code: 'bad_alert' });
  });
  it('recon_check: clean -> no recon alert; injected imbalance -> critical alert; repaired -> resolved', async () => {
    const before = await one('select ops.recon_check() r');
    expect(before).toMatchObject({ ok: true, clean: true });
    const p = await newPlayer(su);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), p, 'GOLD', 50]);
    const c = await su.connect();
    try {   // bypass the append-only / balance triggers ONLY in this test connection to simulate corruption
      await c.query('set session_replication_role = replica');
      await c.query(`update eco.wallets set balance = balance + 7 where player_id = $1 and purpose = 'main' and currency = 'GOLD_TEST'`, [p]);
      const bad = await one('select ops.recon_check() r');
      expect(bad.clean).toBe(false); expect(bad.problems.wallet_mismatch).toBe(1);
      const alerts = (await one('select ops.open_alerts() r')).filter((a: { kind: string }) => a.kind === 'recon');
      expect(alerts.map((a: { subject: string }) => a.subject)).toContain('wallet_mismatch');
      expect(alerts.every((a: { severity: string }) => a.severity === 'critical')).toBe(true);
      await c.query(`update eco.wallets set balance = balance - 7 where player_id = $1 and purpose = 'main' and currency = 'GOLD_TEST'`, [p]);
    } finally { await c.query('set session_replication_role = origin'); c.release(); }
    expect(await one('select ops.recon_check() r')).toMatchObject({ clean: true });
    expect((await one('select ops.open_alerts() r')).filter((a: { kind: string }) => a.kind === 'recon')).toEqual([]);
  });
});
