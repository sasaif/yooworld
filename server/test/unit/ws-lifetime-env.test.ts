// M4: WS_MAX_LIFETIME_S validation and the session id (sid) carried by room tickets.
import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/core/envSchema';
import { signTicket, verifyTicket } from '../../src/core/ticket';

const base = { ENV_TAG: 'local', DATABASE_URL: 'postgres://app_api:x@127.0.0.1:54339/y', AUTH_DATABASE_URL: 'postgres://app_auth:x@127.0.0.1:54339/y',
  BETTER_AUTH_SECRET: 'a'.repeat(40), TICKET_SECRET: 'b'.repeat(40), RESULT_SECRET: 'c'.repeat(40), BETTER_AUTH_URL: 'http://127.0.0.1:8787', APP_ORIGIN: 'http://127.0.0.1:5173' };
const uat = { ...base, ENV_TAG: 'uat', DATABASE_URL: 'postgres://app_api:x@db.neon.tech/y?sslmode=require', AUTH_DATABASE_URL: 'postgres://app_auth:x@db.neon.tech/y?sslmode=require',
  BETTER_AUTH_SECRET: 'A9'.repeat(20), TICKET_SECRET: 'B8'.repeat(20), RESULT_SECRET: 'C7'.repeat(20), BETTER_AUTH_URL: 'https://uat.yoland.test', APP_ORIGIN: 'https://uat.yoland.test',
  TURNSTILE_MODE: 'turnstile', TURNSTILE_SECRET: '0x4AAAAAAA' + 'Q'.repeat(20) };
const cfg = (e: Record<string, string>) => { const r = validateEnv(e); return r.ok ? r.cfg.wsMaxLifetimeMs : r.errors.join('; '); };

describe('WS_MAX_LIFETIME_S', () => {
  it('defaults to 24 h; local accepts >= 2 s; uat/prod require >= 1 h; max 7 days; integers only', () => {
    expect(cfg(base)).toBe(86_400_000);
    expect(cfg({ ...base, WS_MAX_LIFETIME_S: '3' })).toBe(3_000);
    expect(cfg({ ...base, WS_MAX_LIFETIME_S: '1' })).toMatch(/WS_MAX_LIFETIME_S/);
    expect(cfg(uat)).toBe(86_400_000);
    expect(cfg({ ...uat, WS_MAX_LIFETIME_S: '60' })).toMatch(/WS_MAX_LIFETIME_S/);
    expect(cfg({ ...uat, WS_MAX_LIFETIME_S: '3600' })).toBe(3_600_000);
    expect(cfg({ ...uat, WS_MAX_LIFETIME_S: '604801' })).toMatch(/WS_MAX_LIFETIME_S/);
    expect(cfg({ ...base, WS_MAX_LIFETIME_S: '2.5' })).toMatch(/WS_MAX_LIFETIME_S/);
    expect(cfg({ ...base, WS_MAX_LIFETIME_S: 'abc' })).toMatch(/WS_MAX_LIFETIME_S/);
  });
});
describe('ticket sid claim', () => {
  it('the auth session id is signed into the ticket (tamper-proof)', async () => {
    const s = 'k'.repeat(40);
    const t = await signTicket(s, { sub: 'u1', room: 'local:beach:0', env: 'local', kind: 'public', sid: 'sess-1' });
    const v = await verifyTicket(s, t, 'local:beach:0', 'local');
    expect(v).toMatchObject({ sub: 'u1', sid: 'sess-1' });
    const [p, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sid: 'other' })).toString('base64url') + '.' + sig;
    expect(await verifyTicket(s, forged, 'local:beach:0', 'local')).toEqual({ error: 'bad_signature' });
  });
});
