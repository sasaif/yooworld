// Turnstile hook: interface, real verifier against a FAKE fetch (no network, no keys), fake verifier, env rules.
import { describe, it, expect } from 'vitest';
import { TurnstileVerifier, FakeVerifier, makeVerifier, FAKE_PASS_TOKEN, TURNSTILE_VERIFY_URL } from '../../src/core/humanCheck';
import { validateEnv } from '../../src/core/envSchema';

describe('TurnstileVerifier (siteverify contract, fake fetch)', () => {
  it('posts secret/response/remoteip as a form and accepts only success === true; fails closed', async () => {
    const seen: { url: string; body: URLSearchParams }[] = [];
    const reply = (status: number, j: unknown) => (async (url: string, init: RequestInit) => { seen.push({ url, body: init.body as URLSearchParams }); return new Response(JSON.stringify(j), { status }); }) as unknown as typeof fetch;
    const ok = new TurnstileVerifier('0x' + 's'.repeat(30), reply(200, { success: true }));
    expect(await ok.verify('tok-1', '198.51.100.7')).toEqual({ ok: true, codes: [] });
    expect(seen[0].url).toBe(TURNSTILE_VERIFY_URL);
    expect(Object.fromEntries(seen[0].body)).toEqual({ secret: '0x' + 's'.repeat(30), response: 'tok-1', remoteip: '198.51.100.7' });
    expect(await new TurnstileVerifier('k'.repeat(30), reply(200, { success: false, 'error-codes': ['timeout-or-duplicate'] })).verify('t')).toEqual({ ok: false, codes: ['timeout-or-duplicate'] });
    expect((await new TurnstileVerifier('k'.repeat(30), reply(500, {})).verify('t')).ok).toBe(false);
    expect((await new TurnstileVerifier('k'.repeat(30), reply(200, { success: 'true' })).verify('t')).ok).toBe(false);   // strict
    const boom = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await new TurnstileVerifier('k'.repeat(30), boom).verify('t')).toEqual({ ok: false, codes: ['verify-unavailable'] });
    expect((await ok.verify(undefined)).ok).toBe(false); expect((await ok.verify('x'.repeat(3000))).ok).toBe(false);
    expect(seen).toHaveLength(4);                                                     // missing/oversized tokens never call out
  });
  it('fake verifier accepts only the local pass token; off accepts all', async () => {
    const f = makeVerifier('fake') as FakeVerifier;
    expect((await f.verify(FAKE_PASS_TOKEN)).ok).toBe(true); expect((await f.verify('nope')).ok).toBe(false); expect(f.calls).toHaveLength(2);
    expect((await makeVerifier('off').verify(null)).ok).toBe(true);
    expect(() => makeVerifier('turnstile')).toThrow(/TURNSTILE_SECRET/);
  });
  it('env: local defaults to off; prod requires turnstile (uat: turnstile or fake, Phase C) with a non-placeholder secret', () => {
    const base = { ENV_TAG: 'local', DATABASE_URL: 'postgres://app_api:x@127.0.0.1:54339/y', AUTH_DATABASE_URL: 'postgres://app_auth:x@127.0.0.1:54339/y',
      BETTER_AUTH_SECRET: 'a'.repeat(40), TICKET_SECRET: 'b'.repeat(40), RESULT_SECRET: 'c'.repeat(40), BETTER_AUTH_URL: 'http://127.0.0.1:8787', APP_ORIGIN: 'http://127.0.0.1:5173' };
    const r = validateEnv(base); expect(r.ok && r.cfg.humanMode).toBe('off');
    expect(validateEnv({ ...base, TURNSTILE_MODE: 'maybe' }).ok).toBe(false);
    const uat = { ...base, ENV_TAG: 'uat', DATABASE_URL: 'postgres://app_api:x@db.example/y?sslmode=require', AUTH_DATABASE_URL: 'postgres://app_auth:x@db.example/y?sslmode=require', BETTER_AUTH_URL: 'https://u.example', APP_ORIGIN: 'https://u.example' };
    const errs = (e: Record<string, unknown>) => { const x = validateEnv(e); return x.ok ? '' : x.errors.join(); };
    expect(errs(uat)).toMatch(/TURNSTILE_MODE must be turnstile/);
    expect(errs({ ...uat, TURNSTILE_MODE: 'fake' })).toBe('');
    expect(errs({ ...uat, ENV_TAG: 'prod', TURNSTILE_MODE: 'fake' })).toMatch(/TURNSTILE_MODE must be turnstile in prod/);
    expect(errs({ ...uat, TURNSTILE_MODE: 'turnstile', TURNSTILE_SECRET: 'test-secret-000000000000' })).toMatch(/TURNSTILE_SECRET/);
    expect(errs({ ...uat, TURNSTILE_MODE: 'turnstile', TURNSTILE_SECRET: '0x4AAAAAAA' + 'Q'.repeat(20) })).toBe('');
  });
});
