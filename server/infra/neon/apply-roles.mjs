// Runs infra/neon/setup-roles.sql without psql: substitutes the psql variables (:'name') with SQL literals from the
// environment (ENV_TAG + *_PW), through a pg-compatible client. Passwords are never logged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const VARS = { env: 'ENV_TAG', app_api_pw: 'APP_API_PW', app_auth_pw: 'APP_AUTH_PW', app_rw_pw: 'APP_RW_PW', admin_ops_pw: 'ADMIN_OPS_PW',
  backup_ro_pw: 'BACKUP_RO_PW', reporting_ro_pw: 'REPORTING_RO_PW', migrator_pw: 'MIGRATOR_PW' };
export function rolesSql(values) {
  const raw = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'setup-roles.sql'), 'utf8');
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  return raw.split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(/:'([a-z_]+)'/g, (_, k) => {
    const v = values[VARS[k] ?? '']; if (!v) throw new Error(`missing ${VARS[k] ?? k}`);
    if (k !== 'env' && v.length < 24) throw new Error(`${VARS[k]} too short (>= 24 chars)`);
    return lit(v);
  });
}
export async function applyRoles(client, values) {
  const r = await client.query(rolesSql(values));
  return (Array.isArray(r) ? r.at(-1) : r).rows;
}
