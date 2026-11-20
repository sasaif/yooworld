import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { superPool, TEST_DB } from '../helpers/db';
// @ts-expect-error plain .mjs helper
import { migrate, listMigrations } from '../../scripts/migrate.mjs';
// @ts-expect-error plain .mjs helper
import { conn } from '../../scripts/local-env.mjs';

const su = superPool();
afterAll(() => su.end());

describe('migrations', () => {
  it('applies every Phase B migration in order with checksums', async () => {
    const rows = (await su.query('select version, name, checksum, env from migrations.applied order by version')).rows;
    expect(rows.map((r) => r.name).slice(0, 10)).toEqual(['0001_roles.sql', '0002_auth.sql', '0003_eco.sql', '0004_social.sql', '0005_prog.sql', '0006_mod_audit.sql', '0007_rooms_saves.sql', '0008_games_admin.sql', '0009_owner_rules_purchase_hooks.sql', '0010_account_lifecycle.sql']);
    expect(rows.map((r) => r.name)).toEqual(listMigrations().map((f: { name: string }) => f.name));
    expect(rows.every((r) => r.env === 'local')).toBe(true);
    const files = listMigrations();
    expect(rows.map((r) => r.checksum)).toEqual(files.map((f: { checksum: string }) => f.checksum));
  });
  it('is idempotent (re-run applies nothing)', async () => {
    expect(await migrate({ database: TEST_DB, log: () => {} })).toEqual([]);
  });
  it('refuses production in Phase B', async () => {
    await expect(migrate({ database: 'yoland_never', env: 'prod', log: () => {} })).rejects.toThrow(/production migrations are disabled/);
  });
  it('refuses a migration edited after being applied', async () => {
    const db = 'yoland_test_checksum';
    await migrate({ database: db, reset: true, log: () => {} });
    const c = new pg.Client(conn(undefined, undefined, db)); await c.connect();
    await c.query(`update migrations.applied set checksum = 'tampered' where version = '0003'`); await c.end();
    await expect(migrate({ database: db, log: () => {} })).rejects.toThrow(/modified after being applied/);
    const a = new pg.Client(conn(undefined, undefined, 'postgres')); await a.connect(); await a.query(`drop database ${db} with (force)`); await a.end();
  });
  it('records the environment once and makes it immutable', async () => {
    expect((await su.query('select eco.env_tag() t')).rows[0].t).toBe('local');
    await expect(su.query(`update eco.env set tag = 'prod'`)).rejects.toMatchObject({ code: '42501' });
    await expect(su.query(`delete from eco.env`)).rejects.toMatchObject({ code: '42501' });
  });
  it('every product limit marked with an approval status; undecided ones are pending_approval', async () => {
    const rows = (await su.query('select key, status from eco.config')).rows as { key: string; status: string }[];
    const st = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    for (const k of ['gift.min_account_age_days', 'gift.gold_max_per_gift', 'gift.gold_sent_per_day', 'gift.gold_received_per_day', 'gift.count_per_day', 'event.vip_per_day', 'event.vip_active_max'])
      expect(st[k], k).toBe('pending_approval');
    for (const k of ['event.normal_per_hour', 'event.capacity_default', 'event.kick_ban_minutes', 'item.diamond_hold_days']) expect(st[k], k).toBe('owner_rule');
    expect((await su.query(`select value from eco.config where key='item.diamond_hold_days'`)).rows[0].value).toBe(0);
    const rr = (await su.query('select id, approved_by from eco.reward_rules')).rows;
    expect(rr.every((r) => r.approved_by === 'pending_approval')).toBe(true);
  });
});
