/**
 * Ops adapter: Postgres sinks for the pure metrics/alerts interface (src/core/metrics.ts) and the periodic check
 * (cron `scheduled()` in uat/prod — no trigger is configured in Phase B; locally `GET /dev/ops/check`).
 */
import type { AppConfig } from '../core/envSchema';
import { Metrics, ConsoleSink, evaluateRoomHealth, roomMetrics, type Alert, type AlertSink, type Metric, type MetricSink } from '../core/metrics';
import { LOCATIONS } from '../core/rooms';
import { withClient } from './db';
import type { Env } from './env';

async function envChecked<T>(cfg: AppConfig, fn: (q: (sql: string, p: unknown[]) => Promise<any>) => Promise<T>) {
  return withClient(cfg.databaseUrl, async (cl) => {
    const tag = (await cl.query('select eco.env_check() as t')).rows[0].t;
    if (tag !== cfg.env) throw new Error(`env_mismatch db=${tag} worker=${cfg.env}`);
    return fn(async (sql, p) => (await cl.query(sql, p)).rows[0]?.r);
  });
}
export class PgSink implements MetricSink, AlertSink {
  constructor(private cfg: AppConfig) {}
  async write(batch: Metric[]) {
    const r = await envChecked(this.cfg, (q) => q('select ops.ingest($1) r', [JSON.stringify(batch)]));
    if (!r?.ok) throw new Error(`ops.ingest ${r?.code ?? 'failed'}`);
  }
  async raise(a: Alert) { await envChecked(this.cfg, (q) => q('select ops.raise_alert($1,$2,$3,$4) r', [a.kind, a.subject, a.severity, JSON.stringify(a.detail)])); }
  async resolve(kind: string, subject: string) { await envChecked(this.cfg, (q) => q('select ops.resolve_alert($1,$2) r', [kind, subject])); }
}

/** One Metrics buffer per isolate. Sink = Postgres (all envs; a hosted sink is Phase C) + console mirror outside local. */
let shared: { cfg: AppConfig; m: Metrics } | null = null;
export function metricsFor(cfg: AppConfig): Metrics {
  if (!shared || shared.cfg !== cfg) {
    const pg = new PgSink(cfg); const con = new ConsoleSink();
    shared = { cfg, m: new Metrics({ async write(b) { if (cfg.env !== 'local') await con.write(b); await pg.write(b); } }) };
  }
  return shared.m;
}

/** Retention job, policy (a): finalise due deletions (economy side, Postgres), then anonymise the auth identity of
 *  every finalised account (role app_auth) and mark it. Safe to re-run: each step is idempotent. */
export async function finalizeDeletions(cfg: AppConfig) {
  const fin = await envChecked(cfg, (q) => q('select eco.finalize_deletions(50) r', [])) as { finalized: string[]; failed: unknown[] };
  const pending = await envChecked(cfg, (q) => q('select eco.pending_auth_erasure(100) r', [])) as string[];
  let erased = 0;
  for (const id of pending) {
    await withClient(cfg.authDatabaseUrl, async (cl) => {
      await cl.query('begin');
      try {
        const old = (await cl.query('select email from auth."user" where id = $1 for update', [id])).rows[0]?.email as string | undefined;
        await cl.query(`update auth."user" set email = 'deleted+' || id || '@deleted.invalid', name = 'deleted', image = null,
                          "emailVerified" = false, "twoFactorEnabled" = false, "updatedAt" = now() where id = $1`, [id]);
        for (const t of ['session', 'account', '"twoFactor"']) await cl.query(`delete from auth.${t} where "userId" = $1`, [id]);
        await cl.query('delete from auth.verification where value = $1', [id]);
        if (cfg.env === 'local' && old) await cl.query('delete from auth.dev_mail where email = $1', [old]);
        await cl.query('commit');
      } catch (e) { await cl.query('rollback').catch(() => {}); throw e; }
    });
    await envChecked(cfg, (q) => q('select eco.mark_auth_erased($1) r', [id]));
    erased++;
  }
  return { finalized: fin.finalized.length, failed: fin.failed.length, authErased: erased };
}

export interface OpsReport { rooms: number; roomAlerts: Alert[]; retention: Awaited<ReturnType<typeof finalizeDeletions>>; recon: { clean: boolean; problems: Record<string, number> }; flushed: number; flushError?: string }
/** Room health over every live public shard + reconciliation (critical alerts deduplicated in ops.alerts). */
export async function runOpsCheck(env: Env, cfg: AppConfig): Promise<OpsReport> {
  const m = metricsFor(cfg); const pg = new PgSink(cfg);
  const roomAlerts: Alert[] = []; let rooms = 0;
  for (const loc of Object.values(LOCATIONS).filter((l) => l.sharded)) {
    const shards = await env.DIRECTORY.get(env.DIRECTORY.idFromName(`${cfg.env}:dir:${loc.id}`)).snapshot() as { shard: number; members: number }[];
    for (const sh of shards) {
      const room = `${cfg.env}:${loc.id}:${sh.shard}`;
      const st = await env.ROOM.get(env.ROOM.idFromName(room)).stats() as { members: number; sockets: number; core: null | { msgsIn: number; corrections: number; ticks: number; idleTicksSkipped: number; bytesOut: number } };
      const s = { room, members: st.members, sockets: st.sockets, msgsIn: st.core?.msgsIn ?? 0, corrections: st.core?.corrections ?? 0, ticks: st.core?.ticks ?? 0, idleTicksSkipped: st.core?.idleTicksSkipped ?? 0, bytesOut: st.core?.bytesOut ?? 0 };
      rooms++;
      for (const x of roomMetrics(s)) m.emit(x.name, x.value, x.tags);
      const found = evaluateRoomHealth(s);
      for (const a of found) { roomAlerts.push(a); await pg.raise(a); }
    }
  }
  const retention = await finalizeDeletions(cfg);
  m.emit('account.finalized', retention.finalized); if (retention.failed) await pg.raise({ kind: 'retention.failed', subject: 'finalize_deletions', severity: 'warn', detail: retention });
  const recon = await envChecked(cfg, (q) => q('select ops.recon_check() r', [])) as { clean: boolean; problems: Record<string, number> };
  m.emit('ops.check', 1, { rooms });
  const f = await m.flush();
  return { rooms, roomAlerts, retention, recon: { clean: recon.clean, problems: recon.problems }, flushed: f.sent, flushError: f.error };
}
