import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { superPool, rolePool, newPlayer, key, record } from '../helpers/db';

const su = superPool();
const api = rolePool('app_api', 5);
const rw = rolePool('app_rw', 2);
const ro = rolePool('reporting_ro', 2);
const bk = rolePool('backup_ro', 2);
let P = '', W = '';
beforeAll(async () => {
  P = await newPlayer(su);
  await api.query('select eco.test_grant_gold($1,$2,$3)', [key(), P, 500]);
  W = (await su.query(`select id from eco.wallets where player_id=$1 and purpose='main'`, [P])).rows[0].id;
});
afterAll(async () => { await Promise.all([su.end(), api.end(), rw.end(), ro.end(), bk.end()]); });

const denied = async (pool: typeof api, sql: string, params: unknown[] = []) => {
  try { await pool.query(sql, params); return 'ALLOWED'; } catch (e: any) { return e.code as string; }
};

describe('role bypass attempts (app_api has EXECUTE on a whitelist only)', () => {
  it('app_api cannot read or write any economy / progression / auth table, nor call internal helpers', async () => {
    const attempts: [string, string, unknown[]?][] = [
      ['INSERT wallet', `insert into eco.wallets(owner_kind, player_id, currency, purpose, balance) values ('player', '${'00000000-0000-0000-0000-000000000001'}', 'GOLD_TEST', 'main', 1000000)`],
      ['UPDATE wallet balance', `update eco.wallets set balance = 999999 where id = $1`, [W]],
      ['SELECT wallets', `select * from eco.wallets`],
      ['INSERT ledger_tx', `insert into eco.ledger_tx(op_type, idem_key, actor) values ('admin_adjust','x','me')`],
      ['DELETE ledger_entries', `delete from eco.ledger_entries`],
      ['UPDATE item owner', `update eco.item_instances set owner_id = $1`, [P]],
      ['INSERT item', `insert into eco.item_instances(def_id, owner_id, origin) values ('x', $1, 'admin')`, [P]],
      ['INSERT reward_claims', `insert into eco.reward_claims values ($1, 'daily', 'x', 1)`, [P]],
      ['UPDATE config', `update eco.config set value = 0 where key = 'gift.count_per_day'`],
      ['INSERT idempotency', `insert into eco.idempotency(key, client_key, op, request_hash) values ('a','a','a','a')`],
      ['UPDATE trades', `update eco.trades set status = 'settled'`],
      ['INSERT prestige', `insert into prog.prestige_grants(player_id, dimension, points, source_type, source_event) values ($1,'x',1,'shop_buy',1)`, [P]],
      ['UPDATE event_bans', `update social.event_bans set banned_until = now()`],
      ['SELECT auth.user', `select * from auth."user"`],
      ['SELECT app.saves', `select * from app.saves`],
      ['INSERT audit.log', `insert into audit.log(actor, action, hash) values ('x','y','\\x00')`],
      ['CALL eco._move', `select eco._move(1, $1, $1, 'GOLD_TEST', 1)`, [W]],
      ['CALL eco._wallet', `select eco._wallet($1, 'GOLD_TEST')`, [P]],
      ['CALL eco._trade_close', `select eco._trade_close('kkkkkkkk', gen_random_uuid(), $1, true)`, [P]],
      ['CALL eco.dev_grant', `select eco.dev_grant('kkkkkkkk', $1, 'DIAMOND', 1000)`, [P]],
      ['SET ROLE eco_owner', `set role eco_owner`],
      ['CREATE in eco', `create function eco.evil() returns int language sql as 'select 1'`],
      ['CREATE in public', `create table public.evil(x int)`],
      ['CREATE TEMP (search_path hijack)', `create temp table evil(x int)`],
    ];
    const results: Record<string, string> = {};
    for (const [name, sql, params] of attempts) results[name] = await denied(api, sql, params ?? []);
    record('role_bypass_app_api', results);
    for (const [name, code] of Object.entries(results)) expect(code, name).toBe('42501');
  });
  it('app_rw cannot touch eco; may only write app.saves', async () => {
    expect(await denied(rw, 'select * from eco.wallets')).toBe('42501');
    expect(await denied(rw, `select eco.test_grant_gold('kkkkkkkk', $1, 10)`, [P])).toBe('42501');
    await rw.query(`insert into app.saves values ($1,'profile','main',1,'{}',1)`, [P]);
    expect(await denied(rw, `delete from app.saves`)).toBe('42501');
  });
  it('reporting_ro reads reconciliation views only', async () => {
    await ro.query('select * from eco.recon_wallets');
    expect(await denied(ro, 'select * from eco.wallets')).toBe('42501');
    expect(await denied(ro, `select eco.claim_daily('kkkkkkkk', $1)`, [P])).toBe('42501');
  });
  it('backup_ro reads everything but writes nothing', async () => {
    await bk.query('select count(*) from eco.ledger_entries');
    expect(await denied(bk, 'update eco.wallets set balance = 0')).toBe('42501');
  });
  it('history tables are append-only even for the superuser', async () => {
    const r: Record<string, string> = {};
    r['UPDATE ledger_entries'] = await denied(su, 'update eco.ledger_entries set amount = amount + 1');
    r['DELETE ledger_tx'] = await denied(su, 'delete from eco.ledger_tx');
    r['TRUNCATE item_moves'] = await denied(su, 'truncate eco.item_moves cascade');
    r['DELETE gifts'] = await denied(su, 'delete from eco.gifts');
    r['DELETE wallets'] = await denied(su, 'delete from eco.wallets');
    r['DELETE item_instances'] = await denied(su, 'delete from eco.item_instances');
    r['UPDATE reward_claims'] = await denied(su, `update eco.reward_claims set period = 'x'`);
    record('append_only_superuser', r);
    for (const [k, v] of Object.entries(r)) expect(v, k).toBe('42501');
  });
});
