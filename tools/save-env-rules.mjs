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
/**
 * @param {{ GH_PAGES?: string, GH_PAGES_BASE?: string, VITE_YW_ENV?: string }} e  (process.env)
 * @returns {{ base: string, envId: string }}
 */
export function resolveSaveEnv(e) {
  const ghPages = !!e.GH_PAGES || e.GH_PAGES_BASE !== undefined;
  const wanted = e.VITE_YW_ENV || undefined;
  if (wanted !== undefined && !isValidEnvId(wanted)) throw new Error(`[save-env] invalid VITE_YW_ENV "${wanted}" (expected prod | dev | dev/<name> | test/<folder>)`);
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
