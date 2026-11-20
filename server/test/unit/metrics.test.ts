import { describe, it, expect } from 'vitest';
import { Metrics, MemorySink, ConsoleSink, evaluateRoomHealth, evaluateRecon, roomMetrics, METRICS_MAX_BUFFER, type MetricSink } from '../../src/core/metrics';

describe('metrics.emit buffer', () => {
  it('validates names/values, bounds memory, flushes in batches, keeps samples when the sink fails', async () => {
    const mem = new MemorySink(); const m = new Metrics(mem, () => 1000);
    m.emit('trade.settled'); m.emit('http.error', 1, { status: 500 }); m.emit('Bad Name'); m.emit('x.nan', NaN); m.emit('x.inf', Infinity);
    expect(m.pending).toBe(2); expect(m.dropped).toBe(3);
    expect(await m.flush()).toEqual({ sent: 2 });
    expect(mem.metrics).toEqual([{ name: 'trade.settled', value: 1, tags: undefined, at: 1000 }, { name: 'http.error', value: 1, tags: { status: 500 }, at: 1000 }]);
    for (let i = 0; i < METRICS_MAX_BUFFER + 10; i++) m.emit('load.sample', i);
    expect(m.pending).toBe(METRICS_MAX_BUFFER); expect(m.dropped).toBe(13); expect(m.shouldFlush).toBe(true);
    let calls = 0; const flaky: MetricSink = { async write() { calls++; if (calls === 2) throw new Error('down'); } };
    const f = new Metrics(flaky); for (let i = 0; i < 700; i++) f.emit('a.b', i);
    expect(await f.flush()).toEqual({ sent: 500, error: 'down' }); expect(f.pending).toBe(200);
    expect(await f.flush()).toEqual({ sent: 200 }); expect(f.pending).toBe(0);
  });
  it('console sink writes one JSON line per sample/alert', async () => {
    const lines: string[] = []; const c = new ConsoleSink((s) => lines.push(s));
    await c.write([{ name: 'a.b', value: 2 }]); await c.raise({ kind: 'recon', subject: 'x', severity: 'critical', detail: {} });
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ metric: 'a.b', v: 2, tags: {} }, { alert: 'recon', subject: 'x', severity: 'critical', detail: {} }]);
  });
});
describe('room health', () => {
  const base = { room: 'local:beach:1', members: 10, sockets: 10, msgsIn: 100, corrections: 1, ticks: 100, idleTicksSkipped: 0, bytesOut: 10_000 };
  it('healthy room -> no alert; leak / corrections / full / bandwidth each detected', () => {
    expect(evaluateRoomHealth(base)).toEqual([]);
    expect(evaluateRoomHealth({ ...base, sockets: 13 }).map((a) => a.kind)).toEqual(['room.socket_leak']);
    expect(evaluateRoomHealth({ ...base, corrections: 30 }).map((a) => a.kind)).toEqual(['room.corrections']);
    expect(evaluateRoomHealth({ ...base, msgsIn: 10, corrections: 9 })).toEqual([]);           // too few messages to judge
    expect(evaluateRoomHealth({ ...base, capacity: 10 }).map((a) => a.kind)).toEqual(['room.full']);
    expect(evaluateRoomHealth({ ...base, bytesOut: 100 * 70_000 }).map((a) => a.kind)).toEqual(['room.bandwidth']);
    expect(roomMetrics(base).map((m) => m.name)).toEqual(['room.members', 'room.sockets', 'room.msgs_in', 'room.corrections', 'room.bytes_out']);
  });
});
describe('reconciliation alerts', () => {
  it('every non-zero recon counter -> one critical alert', () => {
    expect(evaluateRecon({ wallet_mismatch: 0, unbalanced_tx: 0 })).toEqual({ clean: true, alerts: [], ok: ['wallet_mismatch', 'unbalanced_tx'] });
    const r = evaluateRecon({ wallet_mismatch: 2, unbalanced_tx: 0 });
    expect(r.clean).toBe(false); expect(r.alerts).toEqual([{ kind: 'recon', subject: 'wallet_mismatch', severity: 'critical', detail: { count: 2 } }]);
  });
});
