/**
 * Environment schema (portable). The Worker refuses to serve (500 env_invalid) when the configuration mixes
 * environments: e.g. a non-loopback DB in local, a loopback DB in uat/prod, a 'local' placeholder secret in
 * prod, the same secret reused for tickets and sessions, a role/URL mismatch. A second, runtime check compares
 * ENV_TAG with the database's immutable eco.env tag (so TEST currencies can never be served as prod and
 * vice versa) — see cf/db.ts.
 */
export type EnvTag = 'local' | 'uat' | 'prod';
export interface RawEnv { [k: string]: unknown }
export interface AppConfig {
  env: EnvTag; databaseUrl: string; authDatabaseUrl: string; adminDatabaseUrl?: string;
  authSecret: string; ticketSecret: string; resultSecret: string; authUrl: string; appOrigin: string;
  humanMode: 'off' | 'fake' | 'turnstile'; turnstileSecret?: string;
}
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function validateEnv(e: RawEnv): { ok: true; cfg: AppConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '');
  const env = s('ENV_TAG') as EnvTag;
  if (!['local', 'uat', 'prod'].includes(env)) errors.push('ENV_TAG must be local|uat|prod');
  const urls: [string, string, boolean][] = [['DATABASE_URL', 'app_api', true], ['AUTH_DATABASE_URL', 'app_auth', true], ['ADMIN_DATABASE_URL', 'admin_ops', false]];
  for (const [k, role, required] of urls) {
    const v = s(k);
    if (!v) { if (required) errors.push(`${k} missing`); continue; }
    let u: URL; try { u = new URL(v); } catch { errors.push(`${k} is not a URL`); continue; }
    if (!/^postgres(ql)?:$/.test(u.protocol)) errors.push(`${k} must be postgres://`);
    if (decodeURIComponent(u.username) !== role) errors.push(`${k} must connect as ${role}`);
    const loop = LOOPBACK.has(u.hostname);
    if (env === 'local' && !loop) errors.push(`${k}: local must use a loopback database (got ${u.hostname})`);
    if (env !== 'local' && loop) errors.push(`${k}: ${env} cannot use a loopback database`);
    if (env !== 'local' && u.searchParams.get('sslmode') !== 'require') errors.push(`${k}: ${env} requires sslmode=require`);
    if (env !== 'prod' && /prod/i.test(u.hostname + u.pathname)) errors.push(`${k}: looks like a production database in ${env}`);
  }
  for (const k of ['BETTER_AUTH_SECRET', 'TICKET_SECRET', 'RESULT_SECRET']) {
    const v = s(k);
    if (v.length < 32) errors.push(`${k} must be >= 32 chars`);
    if (env !== 'local' && /local|example|changeme|dev/i.test(v)) errors.push(`${k}: placeholder secret in ${env}`);
  }
  if (new Set([s('BETTER_AUTH_SECRET'), s('TICKET_SECRET'), s('RESULT_SECRET')]).size !== 3) errors.push('BETTER_AUTH_SECRET, TICKET_SECRET and RESULT_SECRET must differ');
  for (const k of ['BETTER_AUTH_URL', 'APP_ORIGIN']) {
    try { const u = new URL(s(k)); if (env !== 'local' && u.protocol !== 'https:') errors.push(`${k} must be https in ${env}`); }
    catch { errors.push(`${k} is not a URL`); }
  }
  const hm = s('TURNSTILE_MODE') || (env === 'local' ? 'off' : '');
  if (!['off', 'fake', 'turnstile'].includes(hm)) errors.push('TURNSTILE_MODE must be off|fake|turnstile (required outside local)');
  if (env !== 'local' && hm !== 'turnstile') errors.push(`TURNSTILE_MODE must be turnstile in ${env}`);
  if (hm === 'turnstile' && (s('TURNSTILE_SECRET').length < 20 || (env !== 'local' && /local|example|changeme|dev|test/i.test(s('TURNSTILE_SECRET'))))) errors.push('TURNSTILE_SECRET missing or placeholder');
  if (errors.length) return { ok: false, errors };
  return { ok: true, cfg: { env, databaseUrl: s('DATABASE_URL'), authDatabaseUrl: s('AUTH_DATABASE_URL'), adminDatabaseUrl: s('ADMIN_DATABASE_URL') || undefined,
    authSecret: s('BETTER_AUTH_SECRET'), ticketSecret: s('TICKET_SECRET'), resultSecret: s('RESULT_SECRET'), authUrl: s('BETTER_AUTH_URL'), appOrigin: s('APP_ORIGIN'),
    humanMode: hm as AppConfig['humanMode'], turnstileSecret: s('TURNSTILE_SECRET') || undefined } };
}
