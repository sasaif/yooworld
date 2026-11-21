-- 0008_games_admin — server-authoritative mini-game results, activity presence helper,
-- admin two-person approval (admin_adjust) with hash-chained audit.
SET LOCAL ROLE eco_owner;

-- Environment tag for the Worker's runtime check (SECURITY DEFINER wrapper; eco.env stays private).
CREATE FUNCTION eco.env_check() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT eco.env_tag() $$;
REVOKE ALL ON FUNCTION eco.env_check() FROM PUBLIC;

-- Activity room lookup (the API checks that the player is really present in that room before paying a task).
CREATE FUNCTION eco.activity_room(p_player uuid, p_session uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT room_id FROM eco.activity_sessions WHERE id = p_session AND player_id = p_player AND ended_at IS NULL $$;

-- Mini-game results. The API records what the TABLE ROOM computed (rules run on the server, result signed by the
-- room). There is no client-supplied result anywhere. One row per table; a second claim replays; a different
-- result for the same table is refused (result_conflict). No Gold is attached to Dominoes (no economy change).
CREATE TABLE prog.match_results (
  table_id text PRIMARY KEY, game text NOT NULL, players uuid[] NOT NULL, winners uuid[] NOT NULL, scores int[] NOT NULL,
  moves int NOT NULL CHECK (moves > 0), result_hash text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(players) BETWEEN 2 AND 4), CHECK (winners <@ players));
CREATE TRIGGER ao_mr   BEFORE UPDATE OR DELETE ON prog.match_results FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_mr_t BEFORE TRUNCATE ON prog.match_results EXECUTE FUNCTION eco.trg_append_only();

CREATE FUNCTION prog.record_match(p_table text, p_game text, p_players uuid[], p_winners uuid[], p_scores int[], p_moves int, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r prog.match_results; p uuid;
BEGIN
  IF p_game <> 'dominoes' THEN PERFORM eco._err('bad_game', 'unknown game'); END IF;
  SELECT * INTO r FROM prog.match_results WHERE table_id = p_table;
  IF r.table_id IS NOT NULL THEN
    IF r.result_hash <> p_hash THEN PERFORM eco._err('result_conflict', 'a different result is already recorded'); END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'winners', to_jsonb(r.winners));
  END IF;
  INSERT INTO prog.match_results VALUES (p_table, p_game, p_players, p_winners, p_scores, p_moves, p_hash, now());
  FOREACH p IN ARRAY p_players LOOP
    PERFORM eco._player(p);
    INSERT INTO prog.player_events(player_id, type_id, payload, source)
      VALUES (p, 'dominoes_result', jsonb_build_object('table', p_table, 'won', p = ANY(p_winners), 'moves', p_moves), 'server:table');
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'winners', to_jsonb(p_winners));
END $$;

-- ---------------- Admin ----------------
-- Admins are listed here (seeded by the migrator/DBA, never by the API). 2FA is enforced twice: by the Worker
-- (Better Auth session with twoFactorEnabled) and by these functions (auth."user"."twoFactorEnabled").
CREATE TABLE audit.admins (user_id uuid PRIMARY KEY, added_at timestamptz NOT NULL DEFAULT now(), added_by text NOT NULL);
ALTER TABLE audit.admin_approvals
  ADD COLUMN payload jsonb, ADD COLUMN reason text, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours', ADD COLUMN result jsonb;
INSERT INTO eco.config(key, value, status, note) VALUES
 ('admin.adjust_max_gold', 100000, 'pending_approval', 'max absolute Gold per admin_adjust request (two admins required)');
RESET ROLE;
SET LOCAL ROLE app_auth;
GRANT USAGE ON SCHEMA auth TO eco_owner;
GRANT SELECT (id, "twoFactorEnabled") ON auth."user" TO eco_owner;
RESET ROLE;
SET LOCAL ROLE eco_owner;

CREATE FUNCTION audit._admin_ok(p uuid) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit.admins WHERE user_id = p) THEN PERFORM eco._err('not_admin', 'not an admin'); END IF;
  IF NOT coalesce((SELECT "twoFactorEnabled" FROM auth."user" WHERE id = p), false) THEN PERFORM eco._err('admin_2fa', 'admin without 2FA'); END IF;
END $$;

CREATE FUNCTION audit.admin_request(p_admin uuid, p_action text, p_payload jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE id bigint; amt bigint;
BEGIN
  PERFORM audit._admin_ok(p_admin);
  IF p_action <> 'admin_adjust' THEN PERFORM eco._err('bad_action', 'unknown admin action'); END IF;
  IF coalesce(char_length(trim(p_reason)), 0) < 10 THEN PERFORM eco._err('reason', 'a reason (>= 10 chars) is required'); END IF;
  amt := (p_payload->>'amount')::bigint;
  IF amt IS NULL OR amt = 0 OR abs(amt) > eco.cfg('admin.adjust_max_gold') THEN PERFORM eco._err('amount', 'amount out of range'); END IF;
  IF (p_payload->>'base') NOT IN ('GOLD','DIAMOND') THEN PERFORM eco._err('bad_currency', 'base must be GOLD or DIAMOND'); END IF;
  PERFORM eco._player((p_payload->>'player')::uuid);
  INSERT INTO audit.admin_approvals(action, payload_hash, requested_by, payload, reason)
    VALUES (p_action, md5(p_payload::text), p_admin, p_payload, p_reason) RETURNING admin_approvals.id INTO id;
  INSERT INTO audit.log(actor, action, target, after, reason, correlation_id)
    VALUES ('admin:' || p_admin, 'admin_request', p_payload->>'player', p_payload, p_reason, 'approval:' || id);
  RETURN jsonb_build_object('ok', true, 'request', id);
END $$;

CREATE FUNCTION audit.admin_approve(p_admin uuid, p_request bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a audit.admin_approvals; pl uuid; c text; amt bigint; tx bigint; ik text; before jsonb; res jsonb;
BEGIN
  PERFORM audit._admin_ok(p_admin);
  SELECT * INTO a FROM audit.admin_approvals WHERE id = p_request FOR UPDATE;
  IF a.id IS NULL THEN PERFORM eco._err('unknown_request', 'unknown request'); END IF;
  IF a.approved_by IS NOT NULL THEN PERFORM eco._err('already_approved', 'already approved'); END IF;
  IF a.requested_by = p_admin THEN PERFORM eco._err('same_admin', 'a second, different admin must approve'); END IF;
  IF a.expires_at < now() THEN PERFORM eco._err('expired', 'request expired'); END IF;
  IF md5(a.payload::text) <> a.payload_hash THEN PERFORM eco._err('tampered', 'payload hash mismatch'); END IF;
  pl := (a.payload->>'player')::uuid; amt := (a.payload->>'amount')::bigint; c := eco.cur(a.payload->>'base');
  before := eco.get_balances(pl);
  ik := 'admin_adjust:system:approval-' || a.id;
  INSERT INTO eco.idempotency(key, client_key, actor, op, request_hash) VALUES (ik, 'approval-' || a.id, pl, 'admin_adjust', a.payload_hash);
  tx := eco._tx('admin_adjust', ik, 'admin:' || a.requested_by || '+' || p_admin);
  IF amt > 0 THEN PERFORM eco._move(tx, eco._wallet(NULL, c, 'admin'), eco._wallet(pl, c), c, amt);
  ELSE PERFORM eco._move(tx, eco._wallet(pl, c), eco._wallet(NULL, c, 'admin'), c, -amt); END IF;
  res := jsonb_build_object('ok', true, 'tx', tx, 'currency', c, 'amount', amt);
  UPDATE eco.idempotency SET result = res WHERE key = ik;
  UPDATE audit.admin_approvals SET approved_by = p_admin, approved_at = now(), result = res WHERE id = a.id;
  INSERT INTO audit.log(actor, action, target, before, after, reason, correlation_id)
    VALUES ('admin:' || p_admin, 'admin_adjust', pl::text, before, eco.get_balances(pl), a.reason, 'approval:' || a.id);
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION eco.activity_room(uuid,uuid), prog.record_match(text,text,uuid[],uuid[],int[],int,text),
  audit._admin_ok(uuid), audit.admin_request(uuid,text,jsonb,text), audit.admin_approve(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eco.activity_room(uuid,uuid) TO app_api;
-- Runtime environment check by the Worker (ENV_TAG must equal the DB tag). Reveals only 'local'|'uat'|'prod'.
GRANT EXECUTE ON FUNCTION eco.env_check() TO app_api, admin_ops;
GRANT USAGE ON SCHEMA prog TO app_api;
GRANT EXECUTE ON FUNCTION prog.record_match(text,text,uuid[],uuid[],int[],int,text) TO app_api;
GRANT USAGE ON SCHEMA audit TO admin_ops;
GRANT EXECUTE ON FUNCTION audit.admin_request(uuid,text,jsonb,text), audit.admin_approve(uuid,bigint) TO admin_ops;
GRANT USAGE ON SCHEMA eco TO admin_ops;
GRANT EXECUTE ON FUNCTION eco.get_balances(uuid) TO admin_ops;
RESET ROLE;
