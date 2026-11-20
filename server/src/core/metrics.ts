/**
 * Metrics + alerts interface (pure; no Cloudflare / pg imports). The Worker buffers samples with metrics.emit and
 * flushes them to a MetricSink; room-health and reconciliation evaluators turn raw state into Alerts for an AlertSink.
 * Phase B sinks: memory (tests), console (Workers logs) and Postgres (ops.ingest / ops.raise_alert, adapter in the
 * Worker). A paid/hosted sink (Grafana, Datadog, Sentry...) is a Phase C decision — none is wired here.
 * Thresholds below are TECHNICAL proposals (not product values) and are deliberately conservative.
 */
export interface Metric { name: string; value: number; tags?: Record<string, string | number>; at?: number }
export type Severity = 'info' | 'warn' | 'critical';
export interface Alert { kind: string; subject: string; severity: Severity; detail: Record<string, unknown> }
export interface MetricSink { write(batch: Metric[]): Promise<void> }
export interface AlertSink { raise(a: Alert): Promise<void>; resolve?(kind: string, subject: string): Promise<void> }

const NAME = /^[a-z][a-z0-9_.]{1,63}$/;
export const METRICS_MAX_BUFFER = 1000;
export const METRICS_FLUSH_AT = 100;
export const METRICS_BATCH = 500;

export class Metrics {
  private buf: Metric[] = [];
  dropped = 0;
  constructor(private sink: MetricSink, private now: () => number = Date.now) {}
  /** Never throws (instrumentation must not break a request). Invalid samples are counted as dropped. */
  emit(name: string, value = 1, tags?: Record<string, string | number>) {
    if (!NAME.test(name) || !Number.isFinite(value) || Math.abs(value) > 1e15) { this.dropped++; return; }
    if (this.buf.length >= METRICS_MAX_BUFFER) { this.buf.shift(); this.dropped++; }   // bounded memory: oldest out
    this.buf.push({ name, value, tags, at: this.now() });
  }
  get pending() { return this.buf.length; }
  get shouldFlush() { return this.buf.length >= METRICS_FLUSH_AT; }
  /** Sends in batches; on sink failure the unsent samples go back to the buffer (bounded) and the error is returned. */
  async flush(): Promise<{ sent: number; error?: string }> {
    let sent = 0;
    while (this.buf.length) {
      const batch = this.buf.splice(0, METRICS_BATCH);
      try { await this.sink.write(batch); sent += batch.length; }
      catch (e) { this.buf = [...batch, ...this.buf].slice(-METRICS_MAX_BUFFER); return { sent, error: (e as Error).message }; }
    }
    return { sent };
  }
}

export class MemorySink implements MetricSink, AlertSink {
  metrics: Metric[] = []; alerts: Alert[] = []; resolved: string[] = [];
  async write(b: Metric[]) { this.metrics.push(...b); }
  async raise(a: Alert) { this.alerts.push(a); }
  async resolve(kind: string, subject: string) { this.resolved.push(`${kind}:${subject}`); }
}
export class ConsoleSink implements MetricSink, AlertSink {
  constructor(private log: (s: string) => void = (s) => console.log(s)) {}
  async write(b: Metric[]) { for (const m of b) this.log(JSON.stringify({ metric: m.name, v: m.value, tags: m.tags ?? {}, at: m.at })); }
  async raise(a: Alert) { this.log(JSON.stringify({ alert: a.kind, subject: a.subject, severity: a.severity, detail: a.detail })); }
}

// ---------- room health ----------
export interface RoomSample {
  room: string; members: number; sockets: number; capacity?: number;
  msgsIn: number; corrections: number; ticks: number; idleTicksSkipped: number; bytesOut: number;
}
export const ROOM_HEALTH = {
  socketLeakSlack: 2,          // sockets beyond members + slack = connections not cleaned up
  correctionRatio: 0.2,        // >20 % of inbound messages corrected = desync or speed hacking
  minMsgsForRatio: 50,
  fullRatio: 0.95,             // a shard at >=95 % of its (ticketed) capacity
  bytesPerTickMax: 64 * 1024,  // average outbound bytes per broadcast tick
} as const;
export function evaluateRoomHealth(s: RoomSample, t = ROOM_HEALTH): Alert[] {
  const out: Alert[] = [];
  if (s.sockets > s.members + t.socketLeakSlack) out.push({ kind: 'room.socket_leak', subject: s.room, severity: 'warn', detail: { sockets: s.sockets, members: s.members } });
  if (s.msgsIn >= t.minMsgsForRatio && s.corrections / s.msgsIn > t.correctionRatio)
    out.push({ kind: 'room.corrections', subject: s.room, severity: 'warn', detail: { corrections: s.corrections, msgsIn: s.msgsIn } });
  if (s.capacity && s.members >= Math.ceil(s.capacity * t.fullRatio)) out.push({ kind: 'room.full', subject: s.room, severity: 'info', detail: { members: s.members, capacity: s.capacity } });
  if (s.ticks > 0 && s.bytesOut / s.ticks > t.bytesPerTickMax) out.push({ kind: 'room.bandwidth', subject: s.room, severity: 'warn', detail: { bytesPerTick: Math.round(s.bytesOut / s.ticks) } });
  return out;
}
export function roomMetrics(s: RoomSample): Metric[] {
  const tags = { room: s.room };
  return [{ name: 'room.members', value: s.members, tags }, { name: 'room.sockets', value: s.sockets, tags },
    { name: 'room.msgs_in', value: s.msgsIn, tags }, { name: 'room.corrections', value: s.corrections, tags }, { name: 'room.bytes_out', value: s.bytesOut, tags }];
}

// ---------- reconciliation ----------
/** eco.recon_summary() counters: every non-zero counter is a critical alert (money or item invariant broken). */
export function evaluateRecon(summary: Record<string, number>): { clean: boolean; alerts: Alert[]; ok: string[] } {
  const alerts: Alert[] = []; const ok: string[] = [];
  for (const [k, v] of Object.entries(summary)) {
    if (Number(v) !== 0) alerts.push({ kind: 'recon', subject: k, severity: 'critical', detail: { count: Number(v) } });
    else ok.push(k);
  }
  return { clean: alerts.length === 0, alerts, ok };
}
