import pg from 'pg';
import { randomUUID } from 'node:crypto';
// @ts-expect-error plain .mjs helper
import { conn, LOCAL_ROLE_PASSWORDS } from '../../scripts/local-env.mjs';

export const TEST_DB = 'yoland_test';
pg.types.setTypeParser(20, (v: string) => Number(v));      // bigint -> number (test values are small)
pg.types.setTypeParser(1700, (v: string) => Number(v));    // numeric -> number

export const superPool = (max = 5) => new pg.Pool({ ...conn(undefined, undefined, TEST_DB), max });
export const rolePool = (role: string, max = 100) =>
  new pg.Pool({ ...conn(role, (LOCAL_ROLE_PASSWORDS as Record<string, string>)[role], TEST_DB), max });

export type Q = (sql: string, params?: unknown[]) => Promise<any[]>;
export const q = (pool: pg.Pool): Q => async (sql, params) => (await pool.query(sql, params)).rows;

/** Create a player (via superuser so tests can backdate the account). */
export async function newPlayer(su: pg.Pool, daysOld = 30): Promise<string> {
  const id = randomUUID();
  await su.query(`insert into eco.players(id, created_at) values ($1, now() - make_interval(days => $2))`, [id, daysOld]);
  return id;
}
export async function makeVip(su: pg.Pool, p: string) {
  await su.query(`insert into eco.entitlements(player_id, kind, source, starts_at, ends_at) values ($1,'vip','test',now()-interval '1 day',now()+interval '30 days')`, [p]);
}
export async function gold(su: pg.Pool, p: string, purpose = 'main'): Promise<number> {
  const r = await su.query(`select coalesce((select balance from eco.wallets where player_id=$1 and currency='GOLD_TEST' and purpose=$2),0) b`, [p, purpose]);
  return Number(r.rows[0].b);
}
export async function diamonds(su: pg.Pool, p: string): Promise<number> {
  const r = await su.query(`select coalesce((select balance from eco.wallets where player_id=$1 and currency='DIAMOND_TEST' and purpose='main'),0) b`, [p]);
  return Number(r.rows[0].b);
}
export async function setCfg(su: pg.Pool, key: string, value: number) {
  await su.query('update eco.config set value=$2 where key=$1', [key, value]);
}
export async function defItem(su: pg.Pool, o: { id?: string; tradable?: boolean; gold?: number | null; diamond?: number | null; stock?: number | null } = {}) {
  const id = o.id ?? `item_${randomUUID().slice(0, 8)}`;
  const cols = ['id', 'kind', 'price_gold', 'price_diamond', 'stock_limit'];
  const vals: unknown[] = [id, 'furniture', o.gold === undefined ? 100 : o.gold, o.diamond === undefined ? 10 : o.diamond, o.stock ?? null];
  if (o.tradable !== undefined) { cols.push('tradable'); vals.push(o.tradable); }
  await su.query(`insert into eco.item_definitions(${cols.join(',')}) values (${vals.map((_, i) => `$${i + 1}`).join(',')})`, vals);
  return id;
}
export async function recon(su: pg.Pool): Promise<Record<string, number>> {
  return (await su.query('select eco.recon_summary() r')).rows[0].r;
}
export const key = (p = 'k') => `${p}-${randomUUID()}`;

/** Fire n calls concurrently; classify by ok / replayed / error hint (or SQLSTATE). */
export async function flood(n: number, fn: (i: number) => Promise<pg.QueryResult>) {
  const lat: number[] = []; const res = { ok: 0, replayed: 0, errors: {} as Record<string, number>, wall_ms: 0, p50_ms: 0, p95_ms: 0 };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, async (_, i) => {
    const s = performance.now();
    try {
      const r = await fn(i); const row = r.rows[0]; const j = row ? row[Object.keys(row)[0]] : null;
      if (j?.replayed) res.replayed++; else res.ok++;
    } catch (e: any) { const k = e.hint || e.code || e.message; res.errors[k] = (res.errors[k] || 0) + 1; }
    lat.push(performance.now() - s);
  }));
  const sorted = lat.sort((a, b) => a - b); const pct = (p: number) => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1);
  res.wall_ms = Math.round(performance.now() - t0); res.p50_ms = pct(0.5); res.p95_ms = pct(0.95);
  return res;
}

/** Collects security-suite measurements into test-results/security.json (for the report table). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/security.json');
export function record(name: string, data: unknown) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const cur = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  cur[name] = data; fs.writeFileSync(OUT, JSON.stringify(cur, null, 2));
}
