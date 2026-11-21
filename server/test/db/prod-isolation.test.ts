// TEST Gold isolation, checked against a THROWAWAY database tagged 'prod' (local cluster, test only:
// the migration runner itself refuses prod in Phase B, so this test applies the SQL files directly).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
// @ts-expect-error plain .mjs helper
import { listMigrations } from '../../scripts/migrate.mjs';
// @ts-expect-error plain .mjs helper
import { conn, LOCAL_ROLE_PASSWORDS } from '../../scripts/local-env.mjs';

const DB = 'yoland_test_prodsim';
let su: pg.Client; let api: pg.Client;
beforeAll(async () => {
  const a = new pg.Client(conn(undefined, undefined, 'postgres')); await a.connect();
  await a.query(`drop database if exists ${DB} with (force)`); await a.query(`create database ${DB}`); await a.end();
  su = new pg.Client(conn(undefined, undefined, DB)); await su.connect();
  for (const m of listMigrations()) {
    await su.query('begin'); await su.query(`select set_config('yoland.env', 'prod', true)`); await su.query(m.sql); await su.query('commit');
  }
  api = new pg.Client(conn('app_api', LOCAL_ROLE_PASSWORDS.app_api, DB)); await api.connect();
});
afterAll(async () => {
  await api?.end(); await su?.end();
  const a = new pg.Client(conn(undefined, undefined, 'postgres')); await a.connect(); await a.query(`drop database if exists ${DB} with (force)`); await a.end();
});

describe('production database (simulated) refuses everything TEST', () => {
  it('test_grant_gold and dev_grant are refused in prod', async () => {
    const p = randomUUID(); await api.query('select eco.ensure_player($1)', [p]);
    await expect(api.query(`select eco.test_grant_gold('k-12345678', $1, 100)`, [p])).rejects.toMatchObject({ hint: 'forbidden_env' });
    await expect(su.query(`select eco.dev_grant('k-12345678', $1, 'DIAMOND', 100)`, [p])).rejects.toMatchObject({ hint: 'forbidden_env' });
  });
  it('a *_TEST wallet cannot be created in prod; real currencies are used', async () => {
    const p = randomUUID(); await api.query('select eco.ensure_player($1)', [p]);
    await expect(su.query(`insert into eco.wallets(owner_kind, player_id, currency, purpose) values ('player',$1,'GOLD_TEST','main')`, [p]))
      .rejects.toMatchObject({ hint: 'env_currency' });
    expect((await su.query(`select eco.cur('GOLD') g, eco.cur('DIAMOND') d`)).rows[0]).toEqual({ g: 'GOLD', d: 'DIAMOND' });
    expect((await api.query('select eco.get_balances($1) r', [p])).rows[0].r).toMatchObject({ test: false });
    expect((await su.query(`select is_test from eco.players where id=$1`, [p])).rows[0].is_test).toBe(false);
  });
});
