/** Better Auth on workerd: one instance PER REQUEST (no shared pool), Postgres schema auth (role app_auth). */
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import pg from 'pg';
import type { AppConfig } from '../core/envSchema';
import { DB_TIMEOUT_MS } from './db';

/** onSessionDeleted: called for EVERY deleted session row (sign-out, revoke-session(s), password reset, expiry):
 *  the Worker closes that session's open WebSockets (close 4401). Failures are logged, never block the auth flow. */
export type SessionDeleted = (userId: string, sessionId: string) => Promise<unknown>;
export function makeAuth(cfg: AppConfig, onSessionDeleted?: SessionDeleted) {
  const pool = new pg.Pool({ connectionString: cfg.authDatabaseUrl, max: 1, connectionTimeoutMillis: DB_TIMEOUT_MS, options: '-c search_path=auth' });
  pool.on('error', () => {});
  const deliver = (email: string, kind: 'verify' | 'reset', url: string) => deliverMail(cfg, pool, email, kind, url);
  const auth = betterAuth({
    appName: 'YoLand',
    database: pool,
    secret: cfg.authSecret,
    baseURL: cfg.authUrl,
    basePath: '/api/auth',
    trustedOrigins: [cfg.appOrigin],
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: false,
      revokeSessionsOnPasswordReset: true, resetPasswordTokenExpiresIn: 60 * 30,
      sendResetPassword: async ({ user, url }) => {
        await deliver(user.email, 'reset', url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await deliver(user.email, 'verify', url);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 3600, max: 5 }, '/two-factor/verify-totp': { window: 60, max: 5 },
                     '/two-factor/verify-backup-code': { window: 60, max: 5 }, '/request-password-reset': { window: 3600, max: 5 } },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }, useSecureCookies: true, database: { generateId: 'uuid' } },
    plugins: [twoFactor({ issuer: 'YoLand' })],
    databaseHooks: onSessionDeleted ? { session: { delete: { after: async (sess: { id: string; userId: string }) => {
      try { await onSessionDeleted(sess.userId, sess.id); } catch (e) { console.error('ws revoke failed', e); }
    } } } } : undefined,
  });
  return { auth, close: () => pool.end().catch(() => {}) };
}
/** E-mail delivery by EMAIL_MODE. 'disabled' (uat only) sends nothing and logs WITHOUT the link or address. */
export async function deliverMail(cfg: Pick<AppConfig, 'emailMode'>, db: { query: (q: string, v: unknown[]) => Promise<unknown> }, email: string, kind: 'verify' | 'reset', url: string) {
  if (cfg.emailMode === 'dev_mail') { await db.query('insert into auth.dev_mail(email, kind, url) values ($1, $2, $3)', [email, kind, url]); return 'stored'; }
  if (cfg.emailMode === 'disabled') { console.warn(`email disabled (uat): ${kind} link not sent`); return 'dropped'; }
  throw new Error('no e-mail provider configured (Phase C: Resend, owner account)');
}
export type Auth = ReturnType<typeof makeAuth>['auth'];
