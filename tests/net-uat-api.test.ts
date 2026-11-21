// ?net=1 against the uat Worker: build-config API URL validated against a hardcoded allowlist (never from the query),
// and the bearer-token fallback (memory only) for browsers that block third-party cookies.
import { describe, it, expect } from 'vitest';
import { liveNetConfig, allowedBuildApi, ALLOWED_API_ORIGINS } from '../src/net/live/netFlag';
import { LiveTransport } from '../src/net/live/LiveTransport';
import type { WsLike } from '../src/net/live/Reconnector';
const UAT = 'https://yoland-api-uat.yoland.workers.dev';

describe('netFlag: build-config API URL (VITE_YW_API_URL)', () => {
  it('flag off stays off whatever the build config', () => {
    expect(liveNetConfig('', UAT)).toBeNull(); expect(liveNetConfig('?lieu=beach', UAT)).toBeNull(); expect(liveNetConfig('?net=0', UAT)).toBeNull();
  });
  it('allowlisted uat origin (exact) or loopback from the build config', () => {
    expect(ALLOWED_API_ORIGINS).toEqual([UAT]);
    expect(liveNetConfig('?net=1', UAT)).toEqual({ server: UAT, ws: 'wss://yoland-api-uat.yoland.workers.dev' });
    expect(liveNetConfig('?net=1', UAT + '/')).toEqual({ server: UAT, ws: 'wss://yoland-api-uat.yoland.workers.dev' });
    expect(liveNetConfig('?net=1', 'http://127.0.0.1:8787')).toEqual({ server: 'http://127.0.0.1:8787', ws: 'ws://127.0.0.1:8787' });
    expect(liveNetConfig('?net=1')).toEqual({ server: 'http://127.0.0.1:8787', ws: 'ws://127.0.0.1:8787' });   // unchanged default
  });
  it('anything else in the build config -> no network at all (null)', () => {
    for (const v of ['https://evil.example', 'http://yoland-api-uat.yoland.workers.dev', 'https://yoland-api-uat.yoland.workers.dev.evil.example',
      'https://x.yoland-api-uat.yoland.workers.dev', 'https://yoland-api-uat.yoland.workers.dev/api', 'https://user@yoland-api-uat.yoland.workers.dev',
      'https://yoland-prod.yoland.workers.dev', 'javascript:alert(1)', 'not a url']) {
      expect(allowedBuildApi(v)).toBeNull(); expect(liveNetConfig('?net=1', v)).toBeNull();
    }
  });
  it('the query string can NEVER select a non-loopback server, not even the allowlisted uat one', () => {
    expect(liveNetConfig(`?net=1&server=${encodeURIComponent(UAT)}`)).toBeNull();
    expect(liveNetConfig(`?net=1&server=${encodeURIComponent(UAT)}`, UAT)).toBeNull();
    expect(liveNetConfig('?net=1&server=https://evil.example', UAT)).toBeNull();
    expect(liveNetConfig('?net=1&server=http://localhost:9999', UAT)).toEqual({ server: 'http://localhost:9999', ws: 'ws://localhost:9999' });
  });
});

describe('LiveTransport bearer fallback', () => {
  it('keeps the set-auth-token in memory, sends it back, forgets it when the session is gone', async () => {
    const calls: { path: string; auth: string | null; cred: string | undefined }[] = []; let signedIn = false;
    const fetchFn = (async (u: string, init: RequestInit) => {
      const path = new URL(u).pathname; const h = new Headers(init.headers); calls.push({ path, auth: h.get('authorization'), cred: init.credentials as string });
      const headers = new Headers();
      if (path === '/api/auth/sign-in/email') { signedIn = true; headers.set('set-auth-token', 'tok.sig'); return new Response('{}', { status: 200, headers }); }
      if (path === '/api/auth/get-session') return new Response(JSON.stringify(signedIn ? { user: { id: 'me' } } : null), { status: 200 });
      return new Response(JSON.stringify({ ticket: 't', room: 'local:beach:0' }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new LiveTransport({ server: UAT, ws: 'wss://yoland-api-uat.yoland.workers.dev' }, fetchFn, () => ({ readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} }) as WsLike);
    t.attach({ location: () => 'beach', local: () => null, changed: () => {} });
    expect(await t.signIn('a@b.c', 'pw')).toBeNull();
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    const after = calls.slice(1);
    expect(calls[0]).toMatchObject({ path: '/api/auth/sign-in/email', auth: null, cred: 'include' });
    expect(after.map((c) => c.path)).toEqual(['/api/auth/get-session', '/api/rooms/beach/join']);
    expect(after.every((c) => c.auth === 'Bearer tok.sig' && c.cred === 'include')).toBe(true);
    signedIn = false; calls.length = 0;
    expect(await (t as any).api('/api/auth/get-session')).toMatchObject({ status: 200 });
    await (t as any).api('/api/auth/get-session');
    expect(calls[1].auth).toBeNull();                                 // token dropped once the session is gone
    t.disconnect();
  });
});
