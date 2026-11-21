-- 0007_rooms_saves — room product values as config, server saves through functions, local-only dev mail outbox.
SET LOCAL ROLE eco_owner;
INSERT INTO eco.config(key, value, status, note) VALUES
 ('room.public_soft_cap',     25,    'pending_approval', 'public location shard: directory fills up to this before opening a new shard'),
 ('room.public_hard_cap',     30,    'pending_approval', 'public location shard: absolute maximum (friends may join up to this)'),
 ('room.apartment_visitors',  10,    'pending_approval', 'visitors in an apartment room (+ the owner); no realtime room for the owner alone'),
 ('save.max_bytes',           65536, 'technical',        'max JSON size of one server save');

-- Server saves (avatar look, apartment layout, profile, prefs). Optimistic concurrency: base_version must match.
-- Inventory is NOT a save: ownership lives in eco.item_instances (read with eco.list_items).
-- There is no import function: production saves are never migrated by this code.
CREATE FUNCTION app.save_load(p_player uuid, p_kind text, p_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('version', version, 'data', data, 'schema', schema, 'updated_at', updated_at)
  FROM app.saves WHERE player_id = p_player AND kind = p_kind AND key = p_key $$;

CREATE FUNCTION app.save_put(p_player uuid, p_kind text, p_key text, p_base_version bigint, p_data jsonb, p_schema int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cur bigint; nv bigint;
BEGIN
  PERFORM eco._player(p_player);
  IF p_kind NOT IN ('profile','apartment','look','prefs') THEN PERFORM eco._err('bad_kind', 'unknown save kind'); END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,40}$' THEN PERFORM eco._err('bad_key', 'bad save key'); END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN PERFORM eco._err('bad_data', 'save must be a JSON object'); END IF;
  IF octet_length(p_data::text) > eco.cfg('save.max_bytes') THEN PERFORM eco._err('too_large', 'save too large'); END IF;
  IF p_schema IS NULL OR p_schema < 1 THEN PERFORM eco._err('bad_schema', 'bad schema'); END IF;
  SELECT version INTO cur FROM app.saves WHERE player_id = p_player AND kind = p_kind AND key = p_key FOR UPDATE;
  IF coalesce(cur, 0) <> p_base_version THEN
    PERFORM eco._err('version_conflict', format('base %s, current %s', p_base_version, coalesce(cur, 0)));
  END IF;
  nv := coalesce(cur, 0) + 1;
  INSERT INTO app.saves(player_id, kind, key, version, data, schema) VALUES (p_player, p_kind, p_key, nv, p_data, p_schema)
    ON CONFLICT (player_id, kind, key) DO UPDATE SET version = EXCLUDED.version, data = EXCLUDED.data, schema = EXCLUDED.schema, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'version', nv);
END $$;
-- Farm foundation (values pending approval, like the factory)
INSERT INTO eco.reward_rules(id, gold, period, approved_by) VALUES ('farm_task', 15, 'task', 'pending_approval');
INSERT INTO eco.activity_definitions VALUES ('farm', 'farm', 45, 'farm_task', 30, true);
INSERT INTO prog.careers VALUES ('farm', 'Ferme', 1);

-- Inventory: equip / place / store an owned item (never while trade-locked, never someone else's item).
CREATE FUNCTION eco.item_set_state(p_player uuid, p_item uuid, p_state text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE it eco.item_instances;
BEGIN
  IF p_state NOT IN ('owned','equipped','placed') THEN PERFORM eco._err('bad_state', 'state must be owned|equipped|placed'); END IF;
  SELECT * INTO it FROM eco.item_instances WHERE id = p_item FOR UPDATE;
  IF it.id IS NULL OR it.owner_id <> p_player THEN PERFORM eco._err('not_owner', 'not the owner'); END IF;
  IF it.state NOT IN ('owned','equipped','placed') THEN PERFORM eco._err('item_state', 'item busy (' || it.state || ')'); END IF;
  UPDATE eco.item_instances SET state = p_state, version = version + 1 WHERE id = p_item;
  RETURN jsonb_build_object('ok', true, 'item', p_item, 'state', p_state);
END $$;
REVOKE ALL ON FUNCTION eco.item_set_state(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eco.item_set_state(uuid,uuid,text) TO app_api;

REVOKE ALL ON FUNCTION app.save_load(uuid,text,text), app.save_put(uuid,text,text,bigint,jsonb,int) FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_api;
GRANT EXECUTE ON FUNCTION app.save_load(uuid,text,text), app.save_put(uuid,text,text,bigint,jsonb,int) TO app_api;
RESET ROLE;

-- LOCAL ONLY: e-mail outbox for verification links (no e-mail provider in Phase B). Not created in uat/prod.
DO $$ BEGIN
  IF current_setting('yoland.env') = 'local' THEN
    SET LOCAL ROLE app_auth;
    CREATE TABLE auth.dev_mail (id serial PRIMARY KEY, email text NOT NULL, kind text NOT NULL, url text NOT NULL, at timestamptz NOT NULL DEFAULT now());
    RESET ROLE;
  END IF;
END $$;
