/** Better Auth on workerd: one instance PER REQUEST (no shared pool), Postgres schema auth (role app_auth). */
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import pg from 'pg';
import type { AppConfig } from '../core/envSchema';
import { DB_TIMEOUT_MS } from './db';

export function makeAuth(cfg: AppConfig) {
  const pool = new pg.Pool({ connectionString: cfg.authDatabaseUrl, max: 1, connectionTimeoutMillis: DB_TIMEOUT_MS, options: '-c search_path=auth' });
  pool.on('error', () => {});
  const auth = betterAuth({
    appName: 'YoLand',
    database: pool,
    secret: cfg.authSecret,
    baseURL: cfg.authUrl,
    basePath: '/api/auth',
    trustedOrigins: [cfg.appOrigin],
    emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: false },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        if (cfg.env !== 'local') throw new Error('no e-mail provider configured (Phase C: Resend, owner account)');
        await pool.query('insert into auth.dev_mail(email, kind, url) values ($1, $2, $3)', [user.email, 'verify', url]);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 3600, max: 5 }, '/two-factor/verify-totp': { window: 60, max: 5 } },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }, useSecureCookies: true, database: { generateId: 'uuid' } },
    plugins: [twoFactor({ issuer: 'YoLand' })],
  });
  return { auth, close: () => pool.end().catch(() => {}) };
}
export type Auth = ReturnType<typeof makeAuth>['auth'];
