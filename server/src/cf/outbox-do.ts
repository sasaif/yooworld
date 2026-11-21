/** QA outbox storage (uat, EMAIL_MODE=capture): one DO instance `${env}:qa-outbox`. Rows expire after OUTBOX_TTL_MS
 *  (purged on every call and by an alarm), at most OUTBOX_MAX_ROWS kept. See core/qaOutbox.ts. */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { OUTBOX_MAX_ROWS, OUTBOX_TTL_MS, normalizeRecipient, type OutboxMessage } from '../core/qaOutbox';

export class OutboxDO extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('create table if not exists mail(id integer primary key autoincrement, rcpt text not null, kind text not null, url text not null, at integer not null)');
    this.sql.exec('create index if not exists mail_rcpt on mail(rcpt, at)');
  }
  private purge(now = Date.now()) {
    this.sql.exec('delete from mail where at < ?', now - OUTBOX_TTL_MS);
    this.sql.exec('delete from mail where id not in (select id from mail order by id desc limit ?)', OUTBOX_MAX_ROWS);
  }
  async put(m: Omit<OutboxMessage, 'at'>) {
    const now = Date.now(); this.purge(now);
    this.sql.exec('insert into mail(rcpt, kind, url, at) values (?,?,?,?)', normalizeRecipient(m.to), m.kind, m.url, now);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + OUTBOX_TTL_MS + 1000);
  }
  async list(to: string) {
    this.purge();
    return [...this.sql.exec('select kind, url, at from mail where rcpt = ? order by id desc limit 20', normalizeRecipient(to))]
      .map((r) => ({ kind: String(r.kind), url: String(r.url), at: new Date(Number(r.at)).toISOString(), expires_at: new Date(Number(r.at) + OUTBOX_TTL_MS).toISOString() }));
  }
  async size() { this.purge(); return Number([...this.sql.exec('select count(*) n from mail')][0].n); }
  async alarm() {
    this.purge();
    const left = Number([...this.sql.exec('select count(*) n from mail')][0].n);
    if (left) await this.ctx.storage.setAlarm(Date.now() + OUTBOX_TTL_MS + 1000);
  }
}
