// Phase C uat: Hyperdrive bindings override the DB URLs; TURNSTILE_MODE=fake and EMAIL_MODE=disabled are uat-only.
import { describe, it, expect, vi } from 'vitest';
import { validateEnv } from '../../src/core/envSchema';
import { deliverMail } from '../../src/cf/auth';

const uat = { ENV_TAG: 'uat', DATABASE_URL: 'postgres://app_api:x@db.neon.tech/y?sslmode=require', AUTH_DATABASE_URL: 'postgres://app_auth:x@db.neon.tech/y?sslmode=require',
  BETTER_AUTH_SECRET: 'A9'.repeat(20), TICKET_SECRET: 'B8'.repeat(20), RESULT_SECRET: 'C7'.repeat(20), BETTER_AUTH_URL: 'https://uat.yoland.test', APP_ORIGIN: 'https://uat.yoland.test',
  TURNSTILE_MODE: 'turnstile', TURNSTILE_SECRET: '0x4AAAAAAA' + 'Q'.repeat(20) } as Record<string, unknown>;
const prod = { ...uat, ENV_TAG: 'prod' };
const local = { ...uat, ENV_TAG: 'local', DATABASE_URL: 'postgres://app_api:x@127.0.0.1:5/y', AUTH_DATABASE_URL: 'postgres://app_auth:x@127.0.0.1:5/y',
  BETTER_AUTH_SECRET: 'a'.repeat(40), TICKET_SECRET: 'b'.repeat(40), RESULT_SECRET: 'c'.repeat(40), BETTER_AUTH_URL: 'http://127.0.0.1:8787', APP_ORIGIN: 'http://127.0.0.1:5173', TURNSTILE_MODE: 'off' };
const hd = (user: string, host = '0123abcd.hyperdrive.local') => ({ connectionString: `postgresql://${user}:pw@${host}:5432/yoland?sslmode=disable` });
const run = (e: Record<string, unknown>) => { const r = validateEnv(e); return r.ok ? r.cfg : r.errors.join('; '); };

describe('Hyperdrive bindings (HD_*)', () => {
  it('override the matching URL, without the sslmode rule (Hyperdrive owns TLS to the origin)', () => {
    const c = run({ ...uat, DATABASE_URL: '', AUTH_DATABASE_URL: undefined, HD_API: hd('app_api'), HD_AUTH: hd('app_auth'), HD_ADMIN: hd('admin_ops') });
    expect(c).toMatchObject({ databaseUrl: hd('app_api').connectionString, authDatabaseUrl: hd('app_auth').connectionString, adminDatabaseUrl: hd('admin_ops').connectionString });
  });
  it('a binding wins over the plain URL; absent bindings fall back to the URL', () => {
    const c = run({ ...uat, HD_API: hd('app_api') });
    expect(c).toMatchObject({ databaseUrl: hd('app_api').connectionString, authDatabaseUrl: uat.AUTH_DATABASE_URL });
  });
  it('binding URLs are Cloudflare-generated (random user, proxy host): URL rules are skipped for them only', () => {
    expect(run({ ...uat, HD_API: hd('a1b2c3', 'whatever.internal') })).toMatchObject({ databaseUrl: hd('a1b2c3', 'whatever.internal').connectionString });
    expect(run({ ...uat, DATABASE_URL: 'postgres://a1b2c3:x@db.neon.tech/y?sslmode=require' })).toMatch(/DATABASE_URL must connect as app_api/);
  });
  it('rejects bindings in local and hand-written hyperdrive.local URLs', () => {
    expect(run({ ...local, HD_API: hd('app_api') })).toMatch(/HD_API: Hyperdrive bindings are for uat\/prod/);
    expect(run({ ...uat, DATABASE_URL: hd('app_api').connectionString })).toMatch(/must come from an HD_API binding/);
  });
  it('ignores malformed bindings (no connectionString)', () => {
    expect(run({ ...uat, HD_API: {} })).toMatchObject({ databaseUrl: uat.DATABASE_URL });
  });
});

describe('uat-only relaxations', () => {
  it('TURNSTILE_MODE=fake: uat yes, prod no; off: never outside local', () => {
    expect(run({ ...uat, TURNSTILE_MODE: 'fake', TURNSTILE_SECRET: '' })).toMatchObject({ humanMode: 'fake' });
    expect(run({ ...prod, TURNSTILE_MODE: 'fake' })).toMatch(/TURNSTILE_MODE must be turnstile in prod/);
    expect(run({ ...uat, TURNSTILE_MODE: 'off' })).toMatch(/turnstile\|fake in uat/);
  });
  it('EMAIL_MODE: local defaults to dev_mail, others to provider; disabled is uat-only, dev_mail local-only', () => {
    expect(run(local)).toMatchObject({ emailMode: 'dev_mail' });
    expect(run(uat)).toMatchObject({ emailMode: 'provider' });
    expect(run({ ...uat, EMAIL_MODE: 'disabled' })).toMatchObject({ emailMode: 'disabled' });
    expect(run({ ...prod, EMAIL_MODE: 'disabled' })).toMatch(/EMAIL_MODE=disabled is uat only/);
    expect(run({ ...local, EMAIL_MODE: 'disabled' })).toMatch(/EMAIL_MODE=disabled is uat only/);
    expect(run({ ...uat, EMAIL_MODE: 'dev_mail' })).toMatch(/dev_mail is local only/);
    expect(run({ ...uat, EMAIL_MODE: 'smtp' })).toMatch(/EMAIL_MODE must be/);
  });
  it('deliverMail: dev_mail stores, disabled drops and never logs the link or address, provider throws', async () => {
    const db = { query: vi.fn(async () => ({})) };
    expect(await deliverMail({ emailMode: 'dev_mail' }, db, 'a@b.c', 'verify', 'https://x/verify?token=T')).toBe('stored');
    expect(db.query).toHaveBeenCalledOnce();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await deliverMail({ emailMode: 'disabled' }, db, 'a@b.c', 'reset', 'https://x/reset?token=SECRET')).toBe('dropped');
    expect(String(warn.mock.calls[0])).not.toMatch(/SECRET|a@b\.c/);
    warn.mockRestore();
    await expect(deliverMail({ emailMode: 'provider' }, db, 'a@b.c', 'verify', 'u')).rejects.toThrow(/no e-mail provider/);
    expect(db.query).toHaveBeenCalledOnce();
  });
});
