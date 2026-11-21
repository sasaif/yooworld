-- 0004_social — player-created events (foundation; must not delay the core). Owner rules: 1 event per rolling
-- hour for normal players, VIP unlimited with a configurable safeguard (pending approval), 20 players per
-- event room, owner can kick (rejoin banned for 60 min), list by category (keyset pagination).
CREATE SCHEMA social AUTHORIZATION eco_owner;
REVOKE ALL ON SCHEMA social FROM PUBLIC;
SET LOCAL ROLE eco_owner;

CREATE TABLE social.event_categories (id text PRIMARY KEY, label_fr text NOT NULL, sort int NOT NULL, active boolean NOT NULL DEFAULT true);
INSERT INTO social.event_categories VALUES
 ('party','Soirée',1,true),('music','Musique & DJ',2,true),('games','Jeux & Dominos',3,true),
 ('fashion','Mode & défilé',4,true),('chill','Détente & discussion',5,true),('contest','Concours',6,true),('other','Autre',99,true);
CREATE TABLE social.event_create_quota (     -- one row per creator: the lock that serialises creations
  player_id uuid PRIMARY KEY REFERENCES eco.players(id), last_created_at timestamptz);
CREATE TABLE social.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES eco.players(id),
  category_id text NOT NULL REFERENCES social.event_categories(id),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 60),
  location_id text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  capacity    int NOT NULL CHECK (capacity BETWEEN 2 AND 100),
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled','removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '6 hours'));
CREATE INDEX events_browse ON social.events(category_id, status, starts_at, id);
CREATE INDEX events_owner ON social.events(owner_id, created_at);
CREATE TABLE social.event_members (
  event_id uuid NOT NULL REFERENCES social.events(id),
  player_id uuid NOT NULL REFERENCES eco.players(id),
  role text NOT NULL DEFAULT 'guest' CHECK (role IN ('owner','guest')),
  first_joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, player_id));
CREATE TABLE social.event_bans (
  event_id uuid NOT NULL REFERENCES social.events(id), player_id uuid NOT NULL REFERENCES eco.players(id),
  banned_until timestamptz NOT NULL, kicked_by uuid NOT NULL, reason text, at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, player_id));
CREATE TABLE social.event_kicks (            -- append-only history (moderation evidence)
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_id uuid NOT NULL, player_id uuid NOT NULL,
  kicked_by uuid NOT NULL, reason text, at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER ao_kick   BEFORE UPDATE OR DELETE ON social.event_kicks FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_kick_t BEFORE TRUNCATE ON social.event_kicks EXECUTE FUNCTION eco.trg_append_only();

CREATE FUNCTION social.create_event(p_owner uuid, p_cat text, p_title text, p_loc text, p_start timestamptz, p_minutes int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q social.event_create_quota; n_day int; n_active int; e uuid;
BEGIN
  PERFORM eco._player(p_owner);
  IF NOT EXISTS (SELECT 1 FROM social.event_categories WHERE id = p_cat AND active) THEN PERFORM eco._err('bad_category', 'unknown category'); END IF;
  IF p_minutes IS NULL OR p_minutes < 15 OR p_minutes > 360 THEN PERFORM eco._err('bad_duration', 'duration 15..360 min'); END IF;
  IF p_start IS NULL OR p_start < now() - interval '5 minutes' OR p_start > now() + interval '14 days' THEN PERFORM eco._err('bad_start', 'start out of range'); END IF;
  INSERT INTO social.event_create_quota(player_id) VALUES (p_owner) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM social.event_create_quota WHERE player_id = p_owner FOR UPDATE;
  IF NOT eco.is_vip(p_owner) THEN
    IF q.last_created_at IS NOT NULL AND q.last_created_at > now() - make_interval(mins => (60 / eco.cfg('event.normal_per_hour'))::int) THEN
      PERFORM eco._err('rate_hour', 'event limit: next at ' || (q.last_created_at + interval '60 minutes'));
    END IF;
  ELSE
    SELECT count(*) INTO n_day FROM social.events WHERE owner_id = p_owner AND created_at > now() - interval '24 hours';
    SELECT count(*) INTO n_active FROM social.events WHERE owner_id = p_owner AND status IN ('scheduled','live') AND ends_at > now();
    IF n_day >= eco.cfg('event.vip_per_day') THEN PERFORM eco._err('vip_day', 'VIP daily safeguard'); END IF;
    IF n_active >= eco.cfg('event.vip_active_max') THEN PERFORM eco._err('vip_active', 'VIP active safeguard'); END IF;
  END IF;
  BEGIN
    INSERT INTO social.events(owner_id, category_id, title, location_id, starts_at, ends_at, capacity)
      VALUES (p_owner, p_cat, p_title, p_loc, p_start, p_start + make_interval(mins => p_minutes), eco.cfg('event.capacity_default')::int)
      RETURNING id INTO e;
  EXCEPTION WHEN check_violation THEN PERFORM eco._err('bad_event', 'invalid event fields');
  END;
  INSERT INTO social.event_members(event_id, player_id, role) VALUES (e, p_owner, 'owner');
  UPDATE social.event_create_quota SET last_created_at = now() WHERE player_id = p_owner;
  RETURN jsonb_build_object('ok', true, 'event', e);
END $$;

CREATE FUNCTION social.kick(p_event uuid, p_by uuid, p_target uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ow uuid; until timestamptz := now() + make_interval(mins => eco.cfg('event.kick_ban_minutes')::int);
BEGIN
  SELECT owner_id INTO ow FROM social.events WHERE id = p_event;
  IF ow IS NULL THEN PERFORM eco._err('unknown_event', 'unknown event'); END IF;
  IF ow IS DISTINCT FROM p_by THEN PERFORM eco._err('not_owner', 'only the owner can kick'); END IF;
  IF p_target = ow THEN PERFORM eco._err('self', 'owner cannot be kicked'); END IF;
  INSERT INTO social.event_bans VALUES (p_event, p_target, until, p_by, left(p_reason, 200), now())
    ON CONFLICT (event_id, player_id) DO UPDATE SET banned_until = greatest(social.event_bans.banned_until, EXCLUDED.banned_until), at = now();
  INSERT INTO social.event_kicks(event_id, player_id, kicked_by, reason) VALUES (p_event, p_target, p_by, left(p_reason, 200));
  RETURN jsonb_build_object('ok', true, 'banned_until', until);
END $$;

CREATE FUNCTION social.can_join(p_event uuid, p_player uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE b timestamptz; ev social.events;
BEGIN
  SELECT * INTO ev FROM social.events WHERE id = p_event;
  IF ev.id IS NULL OR ev.status NOT IN ('scheduled','live') OR ev.ends_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed'); END IF;
  SELECT banned_until INTO b FROM social.event_bans WHERE event_id = p_event AND player_id = p_player AND banned_until > now();
  IF b IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'kicked', 'until', b); END IF;
  RETURN jsonb_build_object('ok', true, 'capacity', ev.capacity, 'owner', ev.owner_id);
END $$;

CREATE FUNCTION social.list_events(p_cat text, p_after_start timestamptz, p_after_id uuid, p_limit int) RETURNS SETOF social.events
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT * FROM social.events WHERE (p_cat IS NULL OR category_id = p_cat) AND status IN ('scheduled','live') AND ends_at > now()
    AND (p_after_start IS NULL OR (starts_at, id) > (p_after_start, p_after_id))
  ORDER BY starts_at, id LIMIT least(greatest(coalesce(p_limit, 20), 1), 50) $$;

REVOKE ALL ON ALL TABLES IN SCHEMA social FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA social FROM PUBLIC;
GRANT USAGE ON SCHEMA social TO app_api;
GRANT EXECUTE ON FUNCTION social.create_event(uuid,text,text,text,timestamptz,int), social.kick(uuid,uuid,uuid,text),
  social.can_join(uuid,uuid), social.list_events(text,timestamptz,uuid,int) TO app_api;
GRANT SELECT ON social.event_categories TO app_api;
RESET ROLE;
