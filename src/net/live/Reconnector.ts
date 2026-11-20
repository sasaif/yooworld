/** Reconnecting WebSocket with jittered exponential backoff. Each attempt asks `open()` for a FRESH socket (the
 *  server tickets are single-use, 30 s), so a reconnect always re-authenticates. Close codes that mean "do not
 *  fight" (kicked, replaced by another tab, alone in an apartment) stop it; `open()` errors marked fatal (not signed
 *  in) stop it too. Pure logic: socket, timers and randomness are injected (unit-tested with fakes). */
export interface WsLike {
  readyState: number; send(data: string): void; close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null; onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null; onerror: ((ev: unknown) => void) | null;
}
export type ReconnState = 'idle' | 'connecting' | 'open' | 'waiting' | 'stopped';
export class FatalOpenError extends Error { constructor(readonly code: string) { super(code); } }
export const STOP_CODES: Record<number, string> = { 4001: 'replaced', 4003: 'kicked', 4010: 'alone' };
export interface ReconnectorOpts {
  open: () => Promise<WsLike>;
  onMessage: (data: string) => void;
  onState?: (s: ReconnState, why?: string) => void;
  baseMs?: number; maxMs?: number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (h: unknown) => void;
}
export class Reconnector {
  state: ReconnState = 'idle'; attempt = 0; why = '';
  private ws: WsLike | null = null; private timer: unknown = null; private gen = 0;
  constructor(private o: ReconnectorOpts) {}
  private set(s: ReconnState, why = '') { this.state = s; this.why = why; this.o.onState?.(s, why); }
  start() { if (this.state === 'connecting' || this.state === 'open') return; this.gen++; this.attempt = 0; this.connect(this.gen); }
  stop(why = 'stopped') {
    this.gen++; if (this.timer != null) (this.o.clearTimer ?? clearTimeout)(this.timer as never); this.timer = null;
    const ws = this.ws; this.ws = null; if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(1000, why); } catch { /* */ } }
    this.set('stopped', why);
  }
  send(data: string) { if (this.state !== 'open' || !this.ws) return false; try { this.ws.send(data); return true; } catch { return false; } }
  /** Next delay: min(max, base * 2^attempt), with 50-100 % jitter (avoids reconnect storms after a server restart). */
  delay(attempt: number) { const b = this.o.baseMs ?? 500, m = this.o.maxMs ?? 15_000; return Math.round(Math.min(m, b * 2 ** attempt) * (0.5 + 0.5 * (this.o.random ?? Math.random)())); }
  private async connect(gen: number) {
    this.set('connecting');
    let ws: WsLike;
    try { ws = await this.o.open(); }
    catch (e) { if (gen !== this.gen) return; if (e instanceof FatalOpenError) return this.stop(e.code); return this.retry(gen, (e as Error).message || 'open_failed'); }
    if (gen !== this.gen) { try { ws.close(1000, 'stale'); } catch { /* */ } return; }
    this.ws = ws;
    ws.onopen = () => { if (gen === this.gen) { this.attempt = 0; this.set('open'); } };
    ws.onmessage = (ev) => { if (gen === this.gen && typeof ev.data === 'string') this.o.onMessage(ev.data); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = (ev) => {
      if (gen !== this.gen) return; this.ws = null;
      if (STOP_CODES[ev.code]) return this.stop(STOP_CODES[ev.code]);
      this.retry(gen, `closed_${ev.code}`);
    };
    if (ws.readyState === 1) ws.onopen(null);
  }
  private retry(gen: number, why: string) {
    const d = this.delay(this.attempt++); this.set('waiting', why);
    this.timer = (this.o.setTimer ?? setTimeout)(() => { this.timer = null; if (gen === this.gen) this.connect(gen); }, d);
  }
}
