-- 0001_roles — database roles (cluster-wide, idempotent). NO passwords here: LOGIN passwords are set per
-- environment from its own secret store (local: scripts/migrate.mjs with throwaway local values).
--
--   eco_owner     NOLOGIN. Owns schemas eco, social, prog, mod, audit, their tables and SECURITY DEFINER functions.
--   app_api       API Worker. USAGE on schemas + EXECUTE on a whitelist of functions. No table rights on money/items.
--   app_auth      Better Auth. Owns schema auth and nothing else.
--   app_rw        API Worker. Read/write app.saves, insert mod.reports.
--   backup_ro     pg_dump (pg_read_all_data).
--   reporting_ro  Reconciliation / reporting views only.
--   admin_ops     Admin tool. Protected admin functions only (two-person approval, later milestone).
--   migrator      DDL only (CI). Never used by the application.
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eco_owner') THEN CREATE ROLE eco_owner NOLOGIN; END IF;
  FOREACH r IN ARRAY ARRAY['app_api','app_auth','app_rw','reporting_ro','admin_ops','migrator'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I LOGIN', r); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_ro') THEN CREATE ROLE backup_ro LOGIN IN ROLE pg_read_all_data; END IF;
END $$;

-- Application roles must never be superuser, create roles/databases, or bypass row security.
ALTER ROLE app_api      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT CONNECTION LIMIT 300;
ALTER ROLE app_auth     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE app_rw       NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE reporting_ro NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE admin_ops    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE eco_owner    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Nobody gets anything by default.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()); END $$;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_api, app_auth, app_rw, reporting_ro, admin_ops, backup_ro, migrator', current_database());
  EXECUTE format('GRANT CREATE ON DATABASE %I TO eco_owner', current_database());
END $$;
-- Functions are EXECUTE-able by PUBLIC by default in Postgres: switch that off for everything eco_owner creates.
ALTER DEFAULT PRIVILEGES FOR ROLE eco_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE eco_owner REVOKE ALL ON TABLES FROM PUBLIC;
