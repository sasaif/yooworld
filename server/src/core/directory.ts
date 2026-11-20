/**
 * DirectoryCore — portable shard placement for one public location (e.g. 'beach').
 * A friend's shard below the HARD cap first, else the fullest shard below the SOFT cap (cost lever: fewer awake
 * rooms), then the lowest-index shard below soft, else opens a new shard. A placement reserves a seat for
 * the ticket lifetime so a burst of joins is spread correctly before the rooms report their counts.
 * A player already present (reconnection) is sent back to the same shard.
 */
export interface DirectoryCaps { soft: number; hard: number }
interface Shard { n: number; count: number; members: Set<string>; pending: Map<string, number> }
export interface Placement { shard: number; reason: 'present' | 'fill' | 'friend' | 'new'; effective: number }

export class DirectoryCore {
  private shards = new Map<number, Shard>();
  constructor(private now: () => number, private reserveMs = 30_000) {}
  private shard(n: number) { let s = this.shards.get(n); if (!s) { s = { n, count: 0, members: new Set(), pending: new Map() }; this.shards.set(n, s); } return s; }
  private gc(s: Shard) { const t = this.now(); for (const [p, exp] of s.pending) if (exp < t || s.members.has(p)) s.pending.delete(p); }
  private eff(s: Shard) { this.gc(s); return s.members.size + s.pending.size; }

  place(player: string, caps: DirectoryCaps, friends: string[] = []): Placement {
    for (const s of this.shards.values()) if (s.members.has(player)) return { shard: s.n, reason: 'present', effective: this.eff(s) };
    for (const s of this.shards.values()) s.pending.delete(player);
    const all = [...this.shards.values()].sort((a, b) => a.n - b.n);
    const under = (cap: number) => all.filter((s) => this.eff(s) < cap);
    let pick: Shard | undefined; let reason: Placement['reason'] = 'fill';
    if (friends.length) {                       // a friend's shard first, up to the HARD cap
      const f = under(caps.hard).find((s) => friends.some((x) => s.members.has(x)));
      if (f) { pick = f; reason = 'friend'; }
    }
    const fill = under(caps.soft).filter((s) => this.eff(s) > 0).sort((a, b) => this.eff(b) - this.eff(a) || a.n - b.n)[0];
    if (!pick && fill) pick = fill;
    if (!pick) pick = under(caps.soft)[0];
    if (!pick) { let n = 1; while (this.shards.has(n)) n++; pick = this.shard(n); reason = 'new'; }
    pick.pending.set(player, this.now() + this.reserveMs);
    return { shard: pick.n, reason, effective: this.eff(pick) };
  }
  /** Called by a room when its membership changes (join / leave). */
  report(n: number, members: string[]) {
    const s = this.shard(n); s.members = new Set(members); s.count = members.length;
    for (const [i, x] of this.shards) if (i !== n) for (const p of members) x.members.delete(p);   // a player is in one shard
    this.gc(s);
  }
  snapshot() { return [...this.shards.values()].sort((a, b) => a.n - b.n).map((s) => ({ shard: s.n, members: s.members.size, pending: (this.gc(s), s.pending.size) })); }
  /** Serialisable state (for durable storage by the adapter). */
  dump() { return [...this.shards.values()].map((s) => ({ n: s.n, members: [...s.members], pending: [...s.pending] })); }
  load(rows: { n: number; members: string[]; pending: [string, number][] }[]) {
    for (const r of rows) { const s = this.shard(r.n); s.members = new Set(r.members); s.count = r.members.length; s.pending = new Map(r.pending); }
  }
}
