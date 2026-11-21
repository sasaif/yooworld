// APP_ORIGINS / AUTH_BEARER schema rules (cross-site front for uat; prod untouched).
import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/core/envSchema';
const UAT = {
  ENV_TAG: 'uat', DATABASE_URL: 'postgres://app_api:x@db.example/y?sslmode=require', AUTH_DATABASE_URL: 'postgres://app_auth:x@db.example/y?sslmode=require',
  BETTER_AUTH_SECRET: 'A9'.repeat(20), TICKET_SECRET: 'B8'.repeat(20), RESULT_SECRET: 'C7'.repeat(20),
  BETTER_AUTH_URL: 'https://api.uat.example', APP_ORIGIN: 'https://api.uat.example', TURNSTILE_MODE: 'fake', EMAIL_MODE: 'disabled',
};
const PROD = { ...UAT, ENV_TAG: 'prod', TURNSTILE_MODE: 'turnstile', TURNSTILE_SECRET: 'Zq'.repeat(20), EMAIL_MODE: 'provider' };
const errs = (e: Record<string, string>) => { const r = validateEnv(e); return r.ok ? [] : r.errors; };
describe('APP_ORIGINS / AUTH_BEARER', () => {
  it('default: only APP_ORIGIN, same-site cookies, no bearer', () => {
    const r = validateEnv(UAT); expect(r.ok).toBe(true);
    if (r.ok) { expect(r.cfg.appOrigins).toEqual(['https://api.uat.example']); expect(r.cfg.crossSiteCookies).toBe(false); expect(r.cfg.authBearer).toBe(false); }
  });
  it('uat front on another site: exact origins, cross-site cookies, bearer on', () => {
    const r = validateEnv({ ...UAT, APP_ORIGINS: 'https://front.vercel.example, https://front2.vercel.example', AUTH_BEARER: 'on' }); expect(r.ok).toBe(true);
    if (r.ok) { expect(r.cfg.appOrigins).toEqual(['https://api.uat.example', 'https://front.vercel.example', 'https://front2.vercel.example']); expect(r.cfg.crossSiteCookies).toBe(true); expect(r.cfg.authBearer).toBe(true); }
  });
  it('refuses wildcards, paths, trailing slashes, http outside local, junk', () => {
    for (const o of ['https://*.vercel.app', '*', 'https://front.example/', 'https://front.example/app', 'http://front.example', 'not a url'])
      expect(errs({ ...UAT, APP_ORIGINS: o }).join(' ')).toMatch(/APP_ORIGINS/);
  });
  it('AUTH_BEARER: only empty|on, and never in prod', () => {
    expect(errs({ ...UAT, AUTH_BEARER: 'yes' }).join(' ')).toMatch(/AUTH_BEARER/);
    expect(errs({ ...PROD, AUTH_BEARER: 'on' }).join(' ')).toMatch(/AUTH_BEARER=on is local\/uat only/);
    expect(validateEnv(PROD).ok).toBe(true);
  });
});
