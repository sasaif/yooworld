// Build-time save-environment rules (P0.A save isolation). Shared by vite.config.ts and tools/check-save-env.mjs.
// One origin (sasaif.github.io) serves every folder, and localStorage is origin-wide, so the ONLY thing that
// keeps a test folder away from the main game's saves is the env id baked into its bundle. This resolver
// fails closed: an ambiguous or inconsistent gh-pages build throws instead of silently getting the prod keyspace.
export const PROD_BASE = '/yooworld/';
const SEG = /^[a-z0-9][a-z0-9._-]{0,40}$/i;
/** valid env ids: prod | dev | dev/<name> | test/<folder> */
export function isValidEnvId(id) {
  if (id === 'prod' || id === 'dev') return true;
  const m = /^(dev|test)\/(.+)$/.exec(id ?? ''); return !!m && SEG.test(m[2]);
}
/** Production branch of the Vercel project (only a build of this branch may get the prod keyspace). */
export const VERCEL_PROD_BRANCH = 'main';
/** Git branch -> env segment: lowercase, anything outside [a-z0-9._-] becomes '-', max 41 chars.
 *  'feature/vercel-env' -> 'feature-vercel-env'. Returns '' when nothing usable is left. */
export function branchSlug(branch) {
  return String(branch ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '').slice(0, 41).replace(/[-.]+$/, '');
}
/**
 * Vercel: base is always '/', every deployment / branch alias / production domain is its own origin.
 *   VERCEL_ENV=production + VERCEL_GIT_COMMIT_REF=main  -> prod
 *   VERCEL_ENV=preview    + VERCEL_GIT_COMMIT_REF=<b>   -> test/<branchSlug(b)>
 *   VERCEL_ENV=development (vercel dev)                 -> dev (or VITE_YW_ENV dev/<name>)
 * Fails closed: unknown VERCEL_ENV, production without the main branch, a preview without a branch, or a preview /
 * development build asking for prod (e.g. a project env var VITE_YW_ENV=prod applied to all environments) all throw.
 */
export function resolveVercelEnv(e, wanted = e.VITE_YW_ENV || undefined) {
  const env = e.VERCEL_ENV; const ref = e.VERCEL_GIT_COMMIT_REF || undefined;
  if (env === 'production') {
    if (ref !== VERCEL_PROD_BRANCH) throw new Error(`[save-env] Vercel production build must come from git branch "${VERCEL_PROD_BRANCH}" (got ${ref ?? 'no git ref'}); refusing the prod keyspace`);
    if (wanted !== undefined && wanted !== 'prod') throw new Error(`[save-env] Vercel production build: VITE_YW_ENV must be unset or prod (got ${wanted})`);
    return { base: '/', envId: 'prod' };
  }
  if (env === 'preview') {
    if (wanted === 'prod') throw new Error('[save-env] VITE_YW_ENV=prod is never allowed for a Vercel preview build');
    if (!ref) throw new Error('[save-env] Vercel preview build without VERCEL_GIT_COMMIT_REF: cannot derive test/<branch>');
    if (ref === VERCEL_PROD_BRANCH) throw new Error(`[save-env] Vercel preview build of "${VERCEL_PROD_BRANCH}": refused (fail closed: the production branch is misconfigured)`);
    const slug = branchSlug(ref);
    if (!slug || !SEG.test(slug)) throw new Error(`[save-env] cannot derive a test env from branch "${ref}"`);
    const envId = `test/${slug}`;
    if (wanted !== undefined && wanted !== envId) throw new Error(`[save-env] Vercel preview of ${ref} must use VITE_YW_ENV=${envId} or leave it unset (got ${wanted})`);
    return { base: '/', envId };
  }
  if (env === 'development' || env === undefined) {
    if (wanted === 'prod') throw new Error('[save-env] VITE_YW_ENV=prod is not allowed for vercel dev');
    if (wanted !== undefined && !/^dev(\/|$)/.test(wanted)) throw new Error(`[save-env] vercel dev only accepts dev or dev/<name> (got ${wanted})`);
    return { base: '/', envId: wanted ?? 'dev' };
  }
  throw new Error(`[save-env] unknown VERCEL_ENV "${env}" (expected production | preview | development)`);
}
/**
 * @param {{ GH_PAGES?: string, GH_PAGES_BASE?: string, VITE_YW_ENV?: string, VERCEL?: string, VERCEL_ENV?: string, VERCEL_GIT_COMMIT_REF?: string }} e  (process.env)
 * @returns {{ base: string, envId: string }}
 */
export function resolveSaveEnv(e) {
  const ghPages = !!e.GH_PAGES || e.GH_PAGES_BASE !== undefined;
  const wanted = e.VITE_YW_ENV || undefined;
  if (wanted !== undefined && !isValidEnvId(wanted)) throw new Error(`[save-env] invalid VITE_YW_ENV "${wanted}" (expected prod | dev | dev/<name> | test/<folder>)`);
  const vercel = !!e.VERCEL || e.VERCEL_ENV !== undefined;
  if (vercel) {
    if (ghPages) throw new Error('[save-env] a Vercel build must not set GH_PAGES / GH_PAGES_BASE (ambiguous target)');
    return resolveVercelEnv(e, wanted);
  }
  if (!ghPages) {
    // local dev / preview / unit tests: never the production keyspace
    if (wanted === 'prod') throw new Error('[save-env] VITE_YW_ENV=prod is only allowed for the GitHub Pages root build (GH_PAGES_BASE=/yooworld/)');
    return { base: '/', envId: wanted ?? 'dev' };
  }
  const base = e.GH_PAGES_BASE;
  if (!base) throw new Error('[save-env] GH_PAGES=1 requires an explicit GH_PAGES_BASE (/yooworld/ for the main game, /yooworld/<folder>/ for a test folder)');
  if (base === PROD_BASE) {
    if (wanted !== undefined && wanted !== 'prod') throw new Error(`[save-env] GH_PAGES_BASE=${base} is the main game: VITE_YW_ENV must be prod (got ${wanted})`);
    return { base, envId: 'prod' };
  }
  const m = /^\/yooworld\/([^/]+)\/$/.exec(base);
  if (!m || !SEG.test(m[1])) throw new Error(`[save-env] GH_PAGES_BASE "${base}" must be /yooworld/ or /yooworld/<folder>/ (one folder, [a-z0-9._-])`);
  const envId = `test/${m[1]}`;
  if (wanted !== undefined && wanted !== envId) throw new Error(`[save-env] GH_PAGES_BASE=${base} must use VITE_YW_ENV=${envId} (got ${wanted}); a subfolder can never be prod`);
  return { base, envId };
}
