// uat QA outbox (EMAIL_MODE=capture), /version (GIT_SHA), fake Turnstile token uat-only, sign-up rate limit kept.
import { describe, it, expect, vi } from 'vitest';
import { validateEnv } from '../../src/core/envSchema';
import { outboxAccess, presentedToken, safeEqual, normalizeRecipient, OUTBOX_TTL_MS } from '../../src/core/qaOutbox';
import { makeVerifier, FAKE_PASS_TOKEN } from '../../src/core/humanCheck';
import { deliverMail, AUTH_RATE_RULES } from '../../src/cf/auth';

const TOKEN = 'Qx7'.repeat(12);
const uat = { ENV_TAG: 'uat', DATABASE_URL: 'postgres://app_api:x@db.neon.tech/y?sslmode=require', AUTH_DATABASE_URL: 'postgres://app_auth:x@db.neon.tech/y?sslmode=require',
  BETTER_AUTH_SECRET: 'A9'.repeat(20), TICKET_SECRET: 'B8'.repeat(20), RESULT_SECRET: 'C7'.repeat(20), BETTER_AUTH_URL: 'https://uat.yoland.test', APP_ORIGIN: 'https://uat.yoland.test',
  TURNSTILE_MODE: 'fake', EMAIL_MODE: 'capture', QA_OUTBOX_TOKEN: TOKEN } as Record<string, unknown>;
const prod = { ...uat, ENV_TAG: 'prod', TURNSTILE_MODE: 'turnstile', TURNSTILE_SECRET: '0x4AAAAAAA' + 'Q'.repeat(20), EMAIL_MODE: 'provider', QA_OUTBOX_TOKEN: '' };
const local = { ENV_TAG: 'local', DATABASE_URL: 'postgres://app_api:x@127.0.0.1:5/y', AUTH_DATABASE_URL: 'postgres://app_auth:x@127.0.0.1:5/y',
  BETTER_AUTH_SECRET: 'a'.repeat(40), TICKET_SECRET: 'b'.repeat(40), RESULT_SECRET: 'c'.repeat(40), BETTER_AUTH_URL: 'http://127.0.0.1:8787', APP_ORIGIN: 'http://127.0.0.1:5173' };
const run = (e: Record<string, unknown>) => { const r = validateEnv(e); return r.ok ? r.cfg : r.errors.join('; '); };

describe('EMAIL_MODE=capture (QA outbox)', () => {
  it('is accepted in uat with a strong QA_OUTBOX_TOKEN and refused in prod and local', () => {
    expect(run(uat)).toMatchObject({ emailMode: 'capture', qaOutboxToken: TOKEN });
    expect(run({ ...prod, EMAIL_MODE: 'capture', QA_OUTBOX_TOKEN: TOKEN })).toMatch(/EMAIL_MODE=capture is uat only/);
    expect(run({ ...local, EMAIL_MODE: 'capture', QA_OUTBOX_TOKEN: TOKEN })).toMatch(/EMAIL_MODE=capture is uat only/);
  });
  it('requires a QA_OUTBOX_TOKEN >= 32 chars, not a placeholder, distinct from the other secrets', () => {
    expect(run({ ...uat, QA_OUTBOX_TOKEN: '' })).toMatch(/QA_OUTBOX_TOKEN missing/);
    expect(run({ ...uat, QA_OUTBOX_TOKEN: 'short' })).toMatch(/QA_OUTBOX_TOKEN missing/);
    expect(run({ ...uat, QA_OUTBOX_TOKEN: 'test-token-' + 'x'.repeat(30) })).toMatch(/placeholder/);
    expect(run({ ...uat, QA_OUTBOX_TOKEN: uat.TICKET_SECRET })).toMatch(/must differ/);
  });
  it('the token is only exposed in the config when capture is on', () => {
    expect(run({ ...uat, EMAIL_MODE: 'disabled' })).toMatchObject({ emailMode: 'disabled', qaOutboxToken: undefined });
  });
  it('/qa/outbox access: 404 unless uat+capture+token; 401 on missing/wrong token; 200 on the exact token', async () => {
    const cfg = { env: 'uat', emailMode: 'capture', qaOutboxToken: TOKEN };
    expect(await outboxAccess(cfg, TOKEN)).toBe(200);
    expect(await outboxAccess(cfg, TOKEN + 'x')).toBe(401);
    expect(await outboxAccess(cfg, TOKEN.slice(0, -1))).toBe(401);
    expect(await outboxAccess(cfg, null)).toBe(401);
    expect(await outboxAccess({ ...cfg, emailMode: 'disabled' }, TOKEN)).toBe(404);
    expect(await outboxAccess({ ...cfg, env: 'prod' }, TOKEN)).toBe(404);
    expect(await outboxAccess({ ...cfg, qaOutboxToken: undefined }, TOKEN)).toBe(404);
  });
  it('token from Authorization: Bearer or x-qa-token; constant-time compare handles different lengths', async () => {
    expect(presentedToken('Bearer abc', null)).toBe('abc');
    expect(presentedToken('bearer  abc ', 'zzz')).toBe('abc');
    expect(presentedToken(null, 'xyz')).toBe('xyz');
    expect(presentedToken('Basic abc', null)).toBe(null);
    expect(await safeEqual('same', 'same')).toBe(true);
    expect(await safeEqual('same', 'samf')).toBe(false);
    expect(await safeEqual('', 'x')).toBe(false);
    expect(normalizeRecipient('  Smoke@Example.COM ')).toBe('smoke@example.com');
    expect(OUTBOX_TTL_MS).toBeLessThanOrEqual(30 * 60_000);
  });
  it('deliverMail(capture) hands the message to the outbox and never touches the DB', async () => {
    const db = { query: vi.fn(async () => ({})) }; const cap = vi.fn(async () => {});
    expect(await deliverMail({ emailMode: 'capture' }, db, 'a@b.c', 'verify', 'https://x/v?token=T', cap)).toBe('captured');
    expect(cap).toHaveBeenCalledWith({ to: 'a@b.c', kind: 'verify', url: 'https://x/v?token=T' });
    expect(db.query).not.toHaveBeenCalled();
    await expect(deliverMail({ emailMode: 'capture' }, db, 'a@b.c', 'verify', 'u')).rejects.toThrow(/without an outbox/);
  });
});

describe('U2 /version', () => {
  it('GIT_SHA must be hex; defaults to unknown', () => {
    expect(run({ ...uat, GIT_SHA: '01d1f31' })).toMatchObject({ gitSha: '01d1f31' });
    expect(run(uat)).toMatchObject({ gitSha: 'unknown' });
    expect(run({ ...uat, GIT_SHA: 'main; rm -rf' })).toMatch(/GIT_SHA must be a hex commit id/);
  });
});

describe('U3 fake Turnstile token: uat (and local tests) only', () => {
  it('the schema refuses TURNSTILE_MODE=fake in prod', () => {
    expect(run({ ...prod, TURNSTILE_MODE: 'fake' })).toMatch(/TURNSTILE_MODE must be turnstile in prod/);
    expect(run({ ...uat, TURNSTILE_MODE: 'fake' })).toMatchObject({ humanMode: 'fake' });
  });
  it('makeVerifier refuses fake/off in prod even if the schema were bypassed; uat fake accepts only the fake token', async () => {
    expect(() => makeVerifier('fake', undefined, undefined, 'prod')).toThrow(/refused in prod/);
    expect(() => makeVerifier('off', undefined, undefined, 'prod')).toThrow(/refused in prod/);
    const v = makeVerifier('fake', undefined, undefined, 'uat');
    expect((await v.verify(FAKE_PASS_TOKEN)).ok).toBe(true);
    expect((await v.verify('anything-else')).ok).toBe(false);
    expect((await v.verify(null)).ok).toBe(false);
  });
  it('sign-up stays limited to 5 per hour per IP', () => {
    expect(AUTH_RATE_RULES['/sign-up/email']).toEqual({ window: 3600, max: 5 });
  });
});
