-- 0005_prog — progression hooks (YooLife): player_events feed careers, badges, XP and Prestige.
-- Prestige can NEVER be bought: a prestige grant whose source event type is monetary is refused by the DB.
-- VIP gives no Prestige: VIP events are monetary.
CREATE SCHEMA prog AUTHORIZATION eco_owner;
REVOKE ALL ON SCHEMA prog FROM PUBLIC;
SET LOCAL ROLE eco_owner;

CREATE TABLE prog.event_types (id text PRIMARY KEY, version int NOT NULL, monetary boolean NOT NULL, description text NOT NULL);
INSERT INTO prog.event_types VALUES
 ('reward_daily',   1, false, 'daily login reward claimed'),
 ('activity_task',  1, false, 'activity task completed (server clock validated)'),
 ('shop_buy',       1, true,  'item bought (Gold or Diamonds)'),
 ('gift_sent',      1, true,  'gift sent'),
 ('gift_received',  1, true,  'gift received'),
 ('trade_settled',  1, true,  'trade settled'),
 ('iap_purchase',   1, true,  'real-money purchase'),
 ('vip_granted',    1, true,  'VIP entitlement granted (gives no Prestige)'),
 ('dominoes_result',1, false, 'Dominoes game result computed by the server'),
 ('event_hosted',   1, false, 'player-created event took place');

CREATE TABLE prog.player_events (
  id bigint GENERATED ALWAYS AS IDENTITY, player_id uuid NOT NULL,
  type_id text NOT NULL REFERENCES prog.event_types(id), payload jsonb NOT NULL, source text NOT NULL,
  ledger_tx bigint, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id, at)) PARTITION BY RANGE (at);
CREATE TABLE prog.player_events_default PARTITION OF prog.player_events DEFAULT;
CREATE INDEX ON prog.player_events(player_id, at);
CREATE TRIGGER ao_pe   BEFORE UPDATE OR DELETE ON prog.player_events FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();

CREATE TABLE prog.careers (id text PRIMARY KEY, label_fr text NOT NULL, content_version int NOT NULL);
INSERT INTO prog.careers VALUES ('factory', 'Usine', 1);
CREATE TABLE prog.career_progress (player_id uuid NOT NULL, career_id text NOT NULL REFERENCES prog.careers(id),
  xp bigint NOT NULL DEFAULT 0 CHECK (xp >= 0), rank int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (player_id, career_id));   -- switching career resets nothing
CREATE TABLE prog.xp_grants (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, player_id uuid NOT NULL,
  career_id text NOT NULL, xp int NOT NULL CHECK (xp > 0), event_id bigint NOT NULL, rule_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(), UNIQUE (event_id, rule_id));
CREATE TABLE prog.badge_definitions (id text PRIMARY KEY, rule jsonb NOT NULL, content_version int NOT NULL, approved_by text NOT NULL);
CREATE TABLE prog.player_badges (player_id uuid NOT NULL, badge_id text NOT NULL REFERENCES prog.badge_definitions(id),
  granted_at timestamptz NOT NULL DEFAULT now(), source_event bigint, revoked_at timestamptz, revoked_reason text,
  PRIMARY KEY (player_id, badge_id));
CREATE TABLE prog.prestige_grants (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, player_id uuid NOT NULL,
  dimension text NOT NULL, points int NOT NULL, source_type text NOT NULL REFERENCES prog.event_types(id),
  source_event bigint NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER ao_pg   BEFORE UPDATE OR DELETE ON prog.prestige_grants FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();

CREATE FUNCTION prog.trg_prestige_not_bought() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE pe prog.player_events;
BEGIN
  IF (SELECT monetary FROM prog.event_types WHERE id = NEW.source_type) THEN
    RAISE EXCEPTION 'Prestige cannot be bought (source type % is monetary)', NEW.source_type USING ERRCODE = 'check_violation', HINT = 'prestige_bought';
  END IF;
  SELECT * INTO pe FROM prog.player_events WHERE id = NEW.source_event;
  IF pe.id IS NULL OR pe.type_id <> NEW.source_type OR pe.player_id <> NEW.player_id THEN
    RAISE EXCEPTION 'prestige source event mismatch' USING ERRCODE = 'check_violation', HINT = 'prestige_source';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prestige_not_bought BEFORE INSERT ON prog.prestige_grants FOR EACH ROW EXECUTE FUNCTION prog.trg_prestige_not_bought();
CREATE FUNCTION prog.trg_event_type_monetary_sticky() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.monetary AND NOT NEW.monetary THEN RAISE EXCEPTION 'a monetary event type cannot become non-monetary' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_type_sticky BEFORE UPDATE ON prog.event_types FOR EACH ROW EXECUTE FUNCTION prog.trg_event_type_monetary_sticky();

CREATE TABLE prog.privacy_settings (player_id uuid PRIMARY KEY,
  profile text NOT NULL DEFAULT 'public' CHECK (profile IN ('public','friends','private')),
  presence text NOT NULL DEFAULT 'friends', history text NOT NULL DEFAULT 'private');

REVOKE ALL ON ALL TABLES IN SCHEMA prog FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prog FROM PUBLIC;
RESET ROLE;
