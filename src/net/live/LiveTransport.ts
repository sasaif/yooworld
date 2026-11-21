/** NetworkTransport for the `?net=1` dev mode: local wrangler dev or the allowlisted uat API (see netFlag.ts). Created
 *  by the composition root ONLY when the flag is on; with the flag off this module is never instantiated.
 *  It reads the local avatar position through an injected sampler and never writes game state or local saves
 *  (no localStorage / sessionStorage use at all). Session: the server's httpOnly cookie (credentials: 'include') AND,
 *  when the server has the bearer fallback (uat, AUTH_BEARER=on), the signed token from `set-auth-token`, kept IN
 *  MEMORY ONLY and sent back as Authorization: Bearer — for browsers that block third-party cookies (Safari/iOS ITP).
 *  A reload forgets it (sign in again); a revoked/expired session clears it. */
import type { NetMessage, NetStatus, NetworkTransport } from '../NetworkTransport';
import type { LiveNetConfig } from './netFlag';
import { NetSync, SEND_MS, type ServerMsg, type Vec2 } from './NetSync';
import { FatalOpenError, Reconnector, type WsLike } from './Reconnector';

export interface LiveHooks { location: () => string; local: () => Vec2 | null; changed: () => void }
export class LiveTransport implements NetworkTransport {
  status: NetStatus = 'offline';
  readonly sync: NetSync;
  lastError = '';
  private subs = new Set<(m: NetMessage) => void>();
  private rc: Reconnector; private timer: ReturnType<typeof setInterval> | null = null;
  private hooks: LiveHooks | null = null; private pendingChat: string[] = []; private login: HTMLElement | null = null;
  private bearer: string | null = null;
  constructor(readonly cfg: LiveNetConfig, private fetchFn: typeof fetch = (...a) => fetch(...a), private mkWs: (url: string) => WsLike = (u) => new WebSocket(u) as unknown as WsLike) {
    this.sync = new NetSync((c) => this.subs.forEach((f) => f({ t: 'chat', playerId: c.from, text: c.text, at: c.at })));
    this.rc = new Reconnector({
      open: () => this.open(),
      onMessage: (d) => {
        let m: ServerMsg; try { m = JSON.parse(d); } catch { return; }
        // U5: the server sends 'session_revoked' / 'ws_lifetime' just before closing (4401 / 4402); browsers fire
        // onclose seconds later, so act on the message: immediate disconnect (state -> offline, remotes purged).
        if (m.t === 'error' && (m.code === 'session_revoked' || m.code === 'ws_lifetime')) { this.rc.abort(m.code === 'session_revoked' ? 'revoked' : 'lifetime'); return; }
        this.sync.handle(m); if (m.t === 'welcome') this.flushChat(); this.hooks?.changed();
      },
      onState: (s, why) => {
        this.status = s === 'open' ? 'online' : s === 'stopped' ? 'offline' : 'connecting';
        if (s !== 'open') this.sync.reset();
        if (why) this.lastError = why;
        if (why === 'not_signed_in') this.showLogin();
        if (s === 'stopped') this.stopTick();                               // no presence/movement sending while stopped
        if (why === 'revoked') this.afterRevoked();
        this.hooks?.changed();
      },
    });
  }
  attach(h: LiveHooks) { this.hooks = h; }
  async connect(_roomId: string, _playerId: string) {
    if (this.hooks?.location() !== 'beach') { this.rc.stop('not_synced_here'); this.stopTick(); return; }   // Phase B: beach only
    this.rc.start(); this.startTick();
  }
  disconnect() { this.rc.stop('disconnect'); this.stopTick(); }
  send(msg: NetMessage) {
    if (msg.t !== 'chat') return;                                          // furniture/emote/sit: not synced in Phase B
    const p = JSON.stringify(this.sync.chatPayload(msg.text));
    if (!this.rc.send(p)) { this.pendingChat.push(p); this.pendingChat = this.pendingChat.slice(-20); }
  }
  onMessage(cb: (msg: NetMessage) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }

  /** After a revocation: no reconnect; if the session is really gone, offer the sign-in form again. */
  private afterRevoked() {
    this.api('/api/auth/get-session').then((s) => { if (!s.json?.user?.id && this.rc.state === 'stopped') this.showLogin(); }, () => {});
  }
  private flushChat() { const q = this.pendingChat; this.pendingChat = []; for (const p of q) if (!this.rc.send(p)) this.pendingChat.push(p); }
  private startTick() {
    if (this.timer) return;
    this.timer = setInterval(() => { const p = this.sync.nextMove(this.hooks?.local() ?? null); if (p) this.rc.send(JSON.stringify({ t: 'move', x: p.x, z: p.z })); }, SEND_MS);
  }
  private stopTick() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  private async api(path: string, init: RequestInit = {}) {
    const auth: Record<string, string> = this.bearer ? { authorization: `Bearer ${this.bearer}` } : {};
    const r = await this.fetchFn(this.cfg.server + path, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...auth, ...(init.headers ?? {}) } });
    const t = r.headers?.get?.('set-auth-token'); if (t) this.bearer = t;
    let j: any = null; try { j = await r.json(); } catch { /* */ }
    if (path === '/api/auth/get-session' && r.status === 200 && !j?.user?.id) this.bearer = null;   // session gone
    if (r.status === 401) this.bearer = null;
    return { status: r.status, json: j };
  }
  /** One attempt: session check -> single-use ticket for a beach shard -> WebSocket. */
  private async open(): Promise<WsLike> {
    const s = await this.api('/api/auth/get-session');
    if (!s.json?.user?.id) throw new FatalOpenError('not_signed_in');
    const j = await this.api('/api/rooms/beach/join', { method: 'POST', body: '{}' });
    if (j.status === 401) throw new FatalOpenError('not_signed_in');
    if (j.status !== 200 || !j.json?.ticket) throw new Error(`join_${j.status}`);
    return this.mkWs(`${this.cfg.ws}/ws/${encodeURIComponent(j.json.room)}?ticket=${encodeURIComponent(j.json.ticket)}`);
  }
  async signIn(email: string, password: string) {
    const r = await this.api('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (r.status !== 200) return r.json?.code ?? `http_${r.status}`;
    this.hideLogin(); if (this.hooks?.location() === 'beach') { this.rc.start(); this.startTick(); }
    return null;
  }
  /** Minimal DOM form (dev mode only). Credentials go straight to the local server; nothing is stored client-side. */
  private showLogin() {
    if (this.login || typeof document === 'undefined') return;
    const el = document.createElement('form'); el.className = 'yw-net-login'; el.setAttribute('data-net-login', '');
    el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(20,24,40,.92);color:#fff;padding:10px;border-radius:10px;font:13px system-ui;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:96vw';
    el.innerHTML = '<b>Serveur local (?net=1)</b><input name="email" type="email" placeholder="email" autocomplete="username" required style="width:150px"><input name="password" type="password" placeholder="mot de passe" autocomplete="current-password" required style="width:120px"><button type="submit">Connexion</button><span data-err style="color:#f99"></span>';
    el.onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(el);
      const err = await this.signIn(String(f.get('email')), String(f.get('password')));
      if (err) (el.querySelector('[data-err]') as HTMLElement).textContent = err;
    };
    document.body.appendChild(el); this.login = el;
  }
  private hideLogin() { this.login?.remove(); this.login = null; }
}
