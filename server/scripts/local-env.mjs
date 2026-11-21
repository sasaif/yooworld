// LOCAL-ONLY connection settings. These passwords exist only on a developer machine's throwaway cluster.
// UAT / production credentials are NEVER stored in the repo: they come from the platform secret store
// (wrangler secret / GitHub environment secrets) and the migration runner refuses non-local hosts unless
// YOLAND_ENV and DATABASE_URL are set explicitly (see migrate.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, '..');
export const PG_PORT = Number(process.env.YOLAND_PG_PORT || 54339);
export const PG_HOST = '127.0.0.1';
export const PG_DATA = process.env.YOLAND_PG_DATA || path.join(SERVER_DIR, '.local', 'pgdata');
export const PG_LOG = path.join(SERVER_DIR, '.local', 'pg.log');
export const SUPER = { user: 'postgres', password: 'postgres_local_only' };
export const LOCAL_ROLE_PASSWORDS = {
  app_api: 'app_api_local_only', app_auth: 'app_auth_local_only', app_rw: 'app_rw_local_only',
  reporting_ro: 'reporting_ro_local_only', backup_ro: 'backup_ro_local_only', admin_ops: 'admin_ops_local_only',
  migrator: 'migrator_local_only',
};
export const DB_NAME = process.env.YOLAND_DB || 'yoland_local';
export const conn = (user = SUPER.user, password = SUPER.password, database = DB_NAME) =>
  ({ host: PG_HOST, port: PG_PORT, user, password, database });
