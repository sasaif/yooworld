/** Directory for one public location: places players into shards (fill before opening). State in DO SQLite. */
import { DurableObject } from 'cloudflare:workers';
import { DirectoryCore, type DirectoryCaps } from '../core/directory';
import type { Env } from './env';

export class DirectoryDO extends DurableObject<Env> {
  private core: DirectoryCore; private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('create table if not exists state(k text primary key, v text not null)');
    this.core = new DirectoryCore(() => Date.now());
    const r = [...this.sql.exec(`select v from state where k = 'shards'`)][0];
    if (r) this.core.load(JSON.parse(String(r.v)));
  }
  private save() { this.sql.exec(`insert into state values ('shards', ?) on conflict(k) do update set v = excluded.v`, JSON.stringify(this.core.dump())); }
  async place(player: string, caps: DirectoryCaps, friends: string[] = []) { const p = this.core.place(player, caps, friends); this.save(); return p; }
  async report(shard: number, members: string[]) { this.core.report(shard, members); this.save(); }
  async snapshot() { return this.core.snapshot(); }
}
