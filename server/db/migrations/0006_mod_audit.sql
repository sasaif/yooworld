-- 0006_mod_audit — moderation, hash-chained audit log, admin two-person approvals, server saves.
CREATE SCHEMA mod AUTHORIZATION eco_owner;
CREATE SCHEMA audit AUTHORIZATION eco_owner;
CREATE SCHEMA app AUTHORIZATION eco_owner;
REVOKE ALL ON SCHEMA mod, audit, app FROM PUBLIC;
SET LOCAL ROLE eco_owner;

CREATE TABLE mod.reports (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, reporter_id uuid NOT NULL, target_user uuid,
  target_kind text NOT NULL CHECK (target_kind IN ('message','player','trade','gift','apartment','event')),
  target_ref text NOT NULL, context_r2_key text, category text NOT NULL, status text NOT NULL DEFAULT 'open',
  reviewer uuid, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE mod.sanctions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, player_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mute','trade_freeze','event_ban','suspend','ban')), reason text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, issued_by uuid NOT NULL);
CREATE TABLE mod.blocks (player_id uuid NOT NULL, blocked_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, blocked_id), CHECK (player_id <> blocked_id));

CREATE FUNCTION mod.block(p_player uuid, p_blocked uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_player = p_blocked THEN PERFORM eco._err('self', 'cannot block yourself'); END IF;
  INSERT INTO mod.blocks(player_id, blocked_id) VALUES (p_player, p_blocked) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE FUNCTION mod.unblock(p_player uuid, p_blocked uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM mod.blocks WHERE player_id = p_player AND blocked_id = p_blocked;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Hash-chained, append-only audit log. Serialised by an advisory lock so the chain has no forks.
CREATE TABLE audit.log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL, action text NOT NULL, target text, before jsonb, after jsonb, reason text,
  correlation_id text, prev_hash bytea, hash bytea NOT NULL);
CREATE FUNCTION audit.trg_chain() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit.log'));
  SELECT hash INTO NEW.prev_hash FROM audit.log ORDER BY id DESC LIMIT 1;
  NEW.hash := sha256(convert_to(concat_ws('|', encode(NEW.prev_hash, 'hex'), NEW.at::text, NEW.actor, NEW.action, NEW.target,
                       NEW.before::text, NEW.after::text, NEW.reason, NEW.correlation_id), 'UTF8'));
  RETURN NEW;
END $$;
CREATE TRIGGER chain BEFORE INSERT ON audit.log FOR EACH ROW EXECUTE FUNCTION audit.trg_chain();
CREATE TRIGGER ao_audit   BEFORE UPDATE OR DELETE ON audit.log FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_audit_t BEFORE TRUNCATE ON audit.log EXECUTE FUNCTION eco.trg_append_only();
CREATE FUNCTION audit.verify_chain() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r audit.log; prev bytea; n bigint := 0; bad bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit.log ORDER BY id LOOP
    n := n + 1;
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> sha256(convert_to(concat_ws('|', encode(r.prev_hash, 'hex'), r.at::text, r.actor,
         r.action, r.target, r.before::text, r.after::text, r.reason, r.correlation_id), 'UTF8')) THEN bad := bad + 1; END IF;
    prev := r.hash;
  END LOOP;
  RETURN jsonb_build_object('rows', n, 'broken', bad);
END $$;

CREATE TABLE audit.admin_approvals (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action text NOT NULL,
  payload_hash text NOT NULL, requested_by uuid NOT NULL, approved_by uuid, approved_at timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by));

CREATE TABLE app.saves (player_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('profile','apartment','look','prefs')),
  key text NOT NULL, version bigint NOT NULL, data jsonb NOT NULL, schema int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (player_id, kind, key));

REVOKE ALL ON ALL TABLES IN SCHEMA mod, audit, app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mod, audit, app FROM PUBLIC;
GRANT USAGE ON SCHEMA mod TO app_api, app_rw;
GRANT USAGE ON SCHEMA app TO app_rw;
GRANT USAGE ON SCHEMA audit TO reporting_ro;
GRANT EXECUTE ON FUNCTION mod.block(uuid, uuid), mod.unblock(uuid, uuid) TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.saves TO app_rw;
GRANT INSERT ON mod.reports TO app_rw;
GRANT EXECUTE ON FUNCTION audit.verify_chain() TO reporting_ro;
RESET ROLE;
