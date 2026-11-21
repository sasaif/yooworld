-- 0003_eco — EconomyGate: append-only double-entry ledger, wallets, items, gifts, rewards, activities, trades.
-- Every write goes through a SECURITY DEFINER function owned by eco_owner; app_api only has EXECUTE on a
-- whitelist (end of file). Errors are raised with HINT = '<code>' (mapped to GateResult.code by the API).
CREATE SCHEMA eco AUTHORIZATION eco_owner;
REVOKE ALL ON SCHEMA eco FROM PUBLIC;
SET LOCAL ROLE eco_owner;

-- ============================================================================================
-- Environment (immutable). 'local' | 'uat' | 'prod'. Set from the migration runner (yoland.env).
-- Outside prod every currency is a *_TEST currency: TEST balances can never meet real balances,
-- and a prod database refuses *_TEST wallets (and a non-prod database refuses real ones).
-- ============================================================================================
CREATE TABLE eco.env (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  tag       text NOT NULL CHECK (tag IN ('local','uat','prod')),
  set_at    timestamptz NOT NULL DEFAULT now());
INSERT INTO eco.env(tag) VALUES (current_setting('yoland.env'));

CREATE FUNCTION eco.env_tag() RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
  AS $$ SELECT tag FROM eco.env $$;
-- Map an API currency ('GOLD' | 'DIAMOND') to the stored currency for this environment.
CREATE FUNCTION eco.cur(base text) RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF base IS NULL OR base NOT IN ('GOLD','DIAMOND') THEN
    RAISE EXCEPTION 'unknown currency %', base USING ERRCODE = 'P0001', HINT = 'bad_currency';
  END IF;
  RETURN CASE WHEN eco.env_tag() = 'prod' THEN base ELSE base || '_TEST' END;
END $$;

-- ============================================================================================
-- Config: every product limit is DATA. status marks what Alessandro has / has not approved.
-- eco.cfg() raises on a missing key (a NULL limit must never silently disable a check).
-- ============================================================================================
CREATE TABLE eco.config (
  key    text PRIMARY KEY,
  value  numeric NOT NULL,
  status text NOT NULL CHECK (status IN ('owner_rule','pending_approval','approved','technical')),
  note   text NOT NULL);
INSERT INTO eco.config(key, value, status, note) VALUES
 ('gift.min_account_age_days',   7,      'pending_approval', 'sender AND receiver account age before any gift'),
 ('gift.gold_max_per_gift',      1000,   'pending_approval', 'max Gold in one gift'),
 ('gift.gold_sent_per_day',      2000,   'pending_approval', 'rolling 24 h, per sender'),
 ('gift.gold_received_per_day',  5000,   'pending_approval', 'rolling 24 h, per receiver'),
 ('gift.count_per_day',          10,     'pending_approval', 'gifts (Gold + items) per sender, rolling 24 h'),
 ('item.diamond_hold_days',      14,     'pending_approval', 'security hold: a Diamond-bought item cannot be traded or gifted for N days after purchase (0 = no hold). Diamond items are TRADABLE by default.'),
 ('trade.min_account_age_days',  7,      'pending_approval', 'both players, before trading'),
 ('trade.lock_minutes',          10,     'technical',        'a locked trade expires (and can be cancelled by anyone) after N minutes'),
 ('trade.max_lines',             16,     'technical',        'max lines (items + gold) in one trade'),
 ('test.grant_max_per_call',     100000, 'technical',        'TEST Gold grant ceiling per call (local/UAT only)'),
 ('event.normal_per_hour',       1,      'owner_rule',       'normal players: 1 event per rolling hour'),
 ('event.vip_per_day',           24,     'pending_approval', 'VIP safeguard: events created per rolling 24 h'),
 ('event.vip_active_max',        5,      'pending_approval', 'VIP safeguard: scheduled+live at once'),
 ('event.capacity_default',      20,     'owner_rule',       'players per event room'),
 ('event.kick_ban_minutes',      60,     'owner_rule',       'kicked player cannot rejoin for N minutes');

CREATE FUNCTION eco.cfg(k text) RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE v numeric;
BEGIN
  SELECT value INTO v FROM eco.config WHERE key = k;
  IF v IS NULL THEN RAISE EXCEPTION 'missing config %', k USING ERRCODE = 'P0001', HINT = 'config_missing'; END IF;
  RETURN v;
END $$;

-- ============================================================================================
-- Players (economy identity; id == auth.user.id) and VIP entitlements (separate from Diamonds).
-- ============================================================================================
CREATE TABLE eco.players (
  id           uuid PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  trade_frozen boolean NOT NULL DEFAULT false,
  is_test      boolean NOT NULL DEFAULT (eco.env_tag() <> 'prod'));

CREATE TABLE eco.entitlements (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  uuid NOT NULL REFERENCES eco.players(id),
  kind       text NOT NULL CHECK (kind IN ('vip')),
  source     text NOT NULL CHECK (source IN ('iap','admin','test')),
  source_ref text,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (ends_at > starts_at));
CREATE INDEX ON eco.entitlements(player_id, kind, ends_at);
-- VIP is used ONLY for non-economic perks (e.g. event creation limits). No economy function reads it.
CREATE FUNCTION eco.is_vip(p uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM eco.entitlements WHERE player_id = p AND kind = 'vip' AND revoked_at IS NULL
                 AND starts_at <= now() AND ends_at > now()) $$;

-- ============================================================================================
-- Wallets and ledger
-- ============================================================================================
CREATE TABLE eco.wallets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind text NOT NULL CHECK (owner_kind IN ('player','system')),
  player_id  uuid REFERENCES eco.players(id),
  currency   text NOT NULL CHECK (currency IN ('GOLD','DIAMOND','GOLD_TEST','DIAMOND_TEST')),
  purpose    text NOT NULL CHECK (purpose IN ('main','escrow','mint:test','mint:reward','sink:shop','iap:sales','admin')),
  balance    bigint NOT NULL DEFAULT 0,
  CHECK (owner_kind = 'system' OR balance >= 0),
  CHECK ((owner_kind = 'player') = (player_id IS NOT NULL)),
  CHECK ((owner_kind = 'player') = (purpose IN ('main','escrow'))),
  UNIQUE NULLS NOT DISTINCT (player_id, currency, purpose));

CREATE FUNCTION eco.trg_wallet_env() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (eco.env_tag() = 'prod') = (NEW.currency LIKE '%\_TEST') THEN
    RAISE EXCEPTION 'currency % not allowed in env %', NEW.currency, eco.env_tag() USING ERRCODE = 'check_violation', HINT = 'env_currency';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.currency, NEW.purpose, NEW.owner_kind, NEW.player_id) IS DISTINCT FROM
                          (OLD.currency, OLD.purpose, OLD.owner_kind, OLD.player_id) THEN
    RAISE EXCEPTION 'wallet identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_env BEFORE INSERT OR UPDATE ON eco.wallets FOR EACH ROW EXECUTE FUNCTION eco.trg_wallet_env();

CREATE TABLE eco.idempotency (
  key          text PRIMARY KEY,         -- op ':' actor ':' client key  (namespaced, see eco._ikey)
  client_key   text NOT NULL,
  actor        uuid,
  op           text NOT NULL,
  request_hash text NOT NULL,
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now());

CREATE TABLE eco.ledger_tx (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  op_type    text NOT NULL CHECK (op_type IN ('test_grant','dev_grant','reward','activity','gift_gold','gift_item',
               'shop_buy','trade_lock','trade_settle','trade_cancel','iap_grant','iap_clawback','admin_adjust','reversal')),
  idem_key   text NOT NULL UNIQUE REFERENCES eco.idempotency(key),
  actor      text NOT NULL,
  reverses   bigint REFERENCES eco.ledger_tx(id),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE eco.ledger_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tx_id         bigint NOT NULL REFERENCES eco.ledger_tx(id),
  wallet_id     uuid NOT NULL REFERENCES eco.wallets(id),
  currency      text NOT NULL,
  amount        bigint NOT NULL CHECK (amount <> 0),
  balance_after bigint NOT NULL);
CREATE INDEX ON eco.ledger_entries(wallet_id, id);
CREATE INDEX ON eco.ledger_entries(tx_id);

-- Deferred (checked at COMMIT): per tx and currency entries sum to 0; entry currency = wallet currency;
-- Diamonds never move between two different players (no tx touches DIAMOND wallets of 2 players).
CREATE FUNCTION eco.trg_tx_balanced() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM eco.ledger_entries WHERE tx_id = NEW.tx_id GROUP BY currency HAVING sum(amount) <> 0) THEN
    RAISE EXCEPTION 'ledger tx % unbalanced', NEW.tx_id USING ERRCODE = 'check_violation', HINT = 'unbalanced';
  END IF;
  IF EXISTS (SELECT 1 FROM eco.ledger_entries e JOIN eco.wallets w ON w.id = e.wallet_id
             WHERE e.tx_id = NEW.tx_id AND e.currency <> w.currency) THEN
    RAISE EXCEPTION 'entry currency mismatch in tx %', NEW.tx_id USING ERRCODE = 'check_violation', HINT = 'currency_mismatch';
  END IF;
  IF (SELECT count(DISTINCT w.player_id) FROM eco.ledger_entries e JOIN eco.wallets w ON w.id = e.wallet_id
        WHERE e.tx_id = NEW.tx_id AND e.currency IN ('DIAMOND','DIAMOND_TEST') AND w.owner_kind = 'player') > 1 THEN
    RAISE EXCEPTION 'diamonds are not transferable between players' USING ERRCODE = 'check_violation', HINT = 'diamond_transfer';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tx_balanced AFTER INSERT ON eco.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION eco.trg_tx_balanced();

-- Append-only guard (UPDATE / DELETE / TRUNCATE), applies to every role including eco_owner and superuser
-- (a superuser could still DROP the trigger: that is a DDL change, audited by migrations, never app code).
CREATE FUNCTION eco.trg_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION '%.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege', HINT = 'append_only'; END $$;
CREATE TRIGGER ao_env  BEFORE UPDATE OR DELETE ON eco.env            FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_tx   BEFORE UPDATE OR DELETE ON eco.ledger_tx      FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_en   BEFORE UPDATE OR DELETE ON eco.ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_env_t BEFORE TRUNCATE ON eco.env            EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_tx_t  BEFORE TRUNCATE ON eco.ledger_tx      EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_en_t  BEFORE TRUNCATE ON eco.ledger_entries EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_ws_d  BEFORE DELETE ON eco.wallets FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_ws_t  BEFORE TRUNCATE ON eco.wallets EXECUTE FUNCTION eco.trg_append_only();

-- ============================================================================================
-- Items. tradable defaults to TRUE (Diamond-bought items included). Only an explicit
-- item_definitions.tradable = false makes an item non-tradable / non-giftable.
-- ============================================================================================
CREATE TABLE eco.item_definitions (
  id              text PRIMARY KEY,
  kind            text NOT NULL CHECK (kind NOT IN ('prestige','vip','currency')),   -- Prestige / VIP / currency are never items
  tradable        boolean NOT NULL DEFAULT true,
  price_gold      bigint CHECK (price_gold > 0),
  price_diamond   bigint CHECK (price_diamond > 0),
  stock_limit     int CHECK (stock_limit > 0),
  stock_sold      int NOT NULL DEFAULT 0 CHECK (stock_sold >= 0),
  active          boolean NOT NULL DEFAULT true,
  content_version int NOT NULL DEFAULT 1,
  approved_by     text,
  CHECK (stock_limit IS NULL OR stock_sold <= stock_limit));

CREATE TABLE eco.item_instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  def_id          text NOT NULL REFERENCES eco.item_definitions(id),
  owner_id        uuid NOT NULL REFERENCES eco.players(id),
  state           text NOT NULL DEFAULT 'owned' CHECK (state IN ('owned','equipped','placed','trade_locked','on_hold','revoked')),
  origin          text NOT NULL CHECK (origin IN ('gold','diamond','starter','reward','craft','legacy_test','admin')),
  acquired_at     timestamptz NOT NULL DEFAULT now(),
  hold_until      timestamptz,                -- Diamond-bought: acquired_at + item.diamond_hold_days (if > 0)
  locked_by_trade uuid,
  is_test         boolean NOT NULL DEFAULT (eco.env_tag() <> 'prod'),
  version         bigint NOT NULL DEFAULT 0,
  CHECK ((state = 'trade_locked') = (locked_by_trade IS NOT NULL)));
CREATE INDEX ON eco.item_instances(owner_id);
CREATE TRIGGER ao_ii_d BEFORE DELETE ON eco.item_instances FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_ii_t BEFORE TRUNCATE ON eco.item_instances EXECUTE FUNCTION eco.trg_append_only();

CREATE TABLE eco.item_moves (               -- provenance, append-only
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id  uuid NOT NULL REFERENCES eco.item_instances(id),
  from_id  uuid,
  to_id    uuid NOT NULL,
  reason   text NOT NULL CHECK (reason IN ('shop','gift','trade','reward','admin','starter')),
  idem_key text NOT NULL REFERENCES eco.idempotency(key),
  at       timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON eco.item_moves(item_id, id);
CREATE TRIGGER ao_mv   BEFORE UPDATE OR DELETE ON eco.item_moves FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_mv_t BEFORE TRUNCATE ON eco.item_moves EXECUTE FUNCTION eco.trg_append_only();

-- ============================================================================================
-- Gifts (one-way, no counterpart). Gold or one tradable item. Never Diamonds.
-- ============================================================================================
CREATE TABLE eco.gifts (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idem_key  text NOT NULL UNIQUE REFERENCES eco.idempotency(key),
  from_id   uuid NOT NULL REFERENCES eco.players(id),
  to_id     uuid NOT NULL REFERENCES eco.players(id),
  gold      bigint CHECK (gold > 0),
  item_id   uuid REFERENCES eco.item_instances(id),
  ledger_tx bigint REFERENCES eco.ledger_tx(id),
  at        timestamptz NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id),
  CHECK ((gold IS NULL) <> (item_id IS NULL)));
CREATE INDEX ON eco.gifts(from_id, at);
CREATE INDEX ON eco.gifts(to_id, at);
CREATE TRIGGER ao_gift   BEFORE UPDATE OR DELETE ON eco.gifts FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_gift_t BEFORE TRUNCATE ON eco.gifts EXECUTE FUNCTION eco.trg_append_only();

-- ============================================================================================
-- Rewards and activities (server clock; one claim per period enforced by the primary key)
-- ============================================================================================
CREATE TABLE eco.reward_rules (
  id              text PRIMARY KEY,
  gold            bigint NOT NULL CHECK (gold > 0),
  period          text NOT NULL CHECK (period IN ('day','week','once','task')),
  daily_cap       bigint,
  min_seconds     int,
  active          boolean NOT NULL DEFAULT true,
  content_version int NOT NULL DEFAULT 1,
  approved_by     text NOT NULL);            -- 'pending_approval' until Alessandro validates the amount
INSERT INTO eco.reward_rules(id, gold, period, approved_by) VALUES
 ('daily', 150, 'day', 'pending_approval'),
 ('factory_task', 20, 'task', 'pending_approval');

CREATE TABLE eco.reward_claims (
  player_id  uuid NOT NULL REFERENCES eco.players(id),
  rule_id    text NOT NULL REFERENCES eco.reward_rules(id),
  period     text NOT NULL,                  -- server-computed ('2026-11-20' Europe/Paris day, or 'task:<session>:<n>')
  ledger_tx  bigint NOT NULL REFERENCES eco.ledger_tx(id),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, rule_id, period));
CREATE INDEX ON eco.reward_claims(player_id, rule_id, claimed_at);
CREATE TRIGGER ao_rc   BEFORE UPDATE OR DELETE ON eco.reward_claims FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_rc_t BEFORE TRUNCATE ON eco.reward_claims EXECUTE FUNCTION eco.trg_append_only();

CREATE TABLE eco.activity_definitions (
  id               text PRIMARY KEY,
  career_id        text,
  task_min_seconds int NOT NULL CHECK (task_min_seconds > 0),
  reward_rule      text NOT NULL REFERENCES eco.reward_rules(id),
  daily_task_cap   int NOT NULL CHECK (daily_task_cap > 0),
  active           boolean NOT NULL DEFAULT true);
INSERT INTO eco.activity_definitions VALUES ('factory', 'factory', 30, 'factory_task', 40, true);

CREATE TABLE eco.activity_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES eco.players(id),
  def_id       text NOT NULL REFERENCES eco.activity_definitions(id),
  room_id      text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_task_at timestamptz,
  tasks_done   int NOT NULL DEFAULT 0,
  ended_at     timestamptz);
CREATE UNIQUE INDEX activity_one_open ON eco.activity_sessions(player_id, def_id) WHERE ended_at IS NULL;

-- ============================================================================================
-- Trades: negotiation lives in the trade room; Postgres only sees lock -> settle | cancel.
-- ============================================================================================
CREATE TABLE eco.trades (
  id            uuid PRIMARY KEY,
  a_id          uuid NOT NULL REFERENCES eco.players(id),
  b_id          uuid NOT NULL REFERENCES eco.players(id),
  status        text NOT NULL CHECK (status IN ('locked','settled','cancelled')),
  offer_version int NOT NULL,
  offer_hash    text NOT NULL,             -- version accepted by BOTH players in the trade room
  lock_tx       bigint REFERENCES eco.ledger_tx(id),
  settle_tx     bigint REFERENCES eco.ledger_tx(id),
  cancel_tx     bigint REFERENCES eco.ledger_tx(id),
  locked_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  closed_at     timestamptz,
  closed_by     uuid,
  CHECK (a_id <> b_id), CHECK (expires_at > locked_at),
  CHECK ((status = 'locked') = (closed_at IS NULL)));
CREATE TABLE eco.trade_lines (
  trade_id uuid NOT NULL REFERENCES eco.trades(id),
  side     char(1) NOT NULL CHECK (side IN ('a','b')),
  item_id  uuid REFERENCES eco.item_instances(id),
  gold     bigint CHECK (gold > 0),
  CHECK ((item_id IS NULL) <> (gold IS NULL)),
  UNIQUE (trade_id, item_id));
CREATE TRIGGER ao_tl   BEFORE UPDATE OR DELETE ON eco.trade_lines FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_tl_t BEFORE TRUNCATE ON eco.trade_lines EXECUTE FUNCTION eco.trg_append_only();
-- State machine guard: locked -> settled | cancelled, terminal states immutable, no delete.
CREATE FUNCTION eco.trg_trade_state() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'trades are never deleted' USING ERRCODE = 'insufficient_privilege', HINT = 'append_only'; END IF;
  IF OLD.status <> 'locked' OR NEW.status NOT IN ('settled','cancelled')
     OR (NEW.id, NEW.a_id, NEW.b_id, NEW.offer_version, NEW.offer_hash, NEW.locked_at, NEW.expires_at, NEW.lock_tx)
        IS DISTINCT FROM (OLD.id, OLD.a_id, OLD.b_id, OLD.offer_version, OLD.offer_hash, OLD.locked_at, OLD.expires_at, OLD.lock_tx) THEN
    RAISE EXCEPTION 'illegal trade transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation', HINT = 'bad_state';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trade_state BEFORE UPDATE OR DELETE ON eco.trades FOR EACH ROW EXECUTE FUNCTION eco.trg_trade_state();
CREATE TRIGGER ao_tr_t BEFORE TRUNCATE ON eco.trades EXECUTE FUNCTION eco.trg_append_only();

-- ============================================================================================
-- Internal helpers (NOT granted to anyone)
-- ============================================================================================
CREATE FUNCTION eco._err(code text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '%', msg USING ERRCODE = 'P0001', HINT = code; END $$;

CREATE FUNCTION eco._wallet(p uuid, cur text, purpose text DEFAULT 'main') RETURNS uuid
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE w uuid;
BEGIN
  SELECT id INTO w FROM eco.wallets x WHERE x.player_id IS NOT DISTINCT FROM p AND x.currency = cur AND x.purpose = _wallet.purpose;
  IF w IS NULL THEN
    INSERT INTO eco.wallets(owner_kind, player_id, currency, purpose)
      VALUES (CASE WHEN p IS NULL THEN 'system' ELSE 'player' END, p, cur, purpose)
      ON CONFLICT DO NOTHING RETURNING id INTO w;
    IF w IS NULL THEN
      SELECT id INTO w FROM eco.wallets x WHERE x.player_id IS NOT DISTINCT FROM p AND x.currency = cur AND x.purpose = _wallet.purpose;
    END IF;
  END IF;
  RETURN w;
END $$;

CREATE FUNCTION eco._ikey(op text, actor uuid, k text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF k IS NULL OR char_length(k) NOT BETWEEN 8 AND 128 OR k !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = 'P0001', HINT = 'bad_key';
  END IF;
  RETURN op || ':' || coalesce(actor::text, 'system') || ':' || k;
END $$;

-- Reserve an idempotency key. NULL = new (caller proceeds). Otherwise the stored result (+replayed).
-- A concurrent duplicate blocks on the PK until the first transaction commits (-> replay) or rolls back (-> proceeds).
CREATE FUNCTION eco._claim(ik text, ck text, actor uuid, op text, h text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE r eco.idempotency;
BEGIN
  INSERT INTO eco.idempotency(key, client_key, actor, op, request_hash) VALUES (ik, ck, actor, op, h) ON CONFLICT (key) DO NOTHING;
  IF FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM eco.idempotency WHERE key = ik;
  IF r.request_hash <> h THEN
    RAISE EXCEPTION 'idempotency key reused with a different request' USING ERRCODE = 'P0001', HINT = 'key_reuse';
  END IF;
  RETURN coalesce(r.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
END $$;
CREATE FUNCTION eco._done(ik text, res jsonb) RETURNS jsonb LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  UPDATE eco.idempotency SET result = res WHERE key = ik RETURNING res $$;

-- Balanced movement of amt from wallet a to wallet b inside tx. Locks both wallets in id order.
CREATE FUNCTION eco._move(tx bigint, a uuid, b uuid, cur text, amt bigint) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE ba bigint; bb bigint;
BEGIN
  IF amt IS NULL OR amt <= 0 THEN PERFORM eco._err('amount', 'amount must be positive'); END IF;
  IF a = b THEN PERFORM eco._err('amount', 'same wallet'); END IF;
  PERFORM 1 FROM eco.wallets WHERE id IN (a, b) ORDER BY id FOR UPDATE;
  BEGIN
    UPDATE eco.wallets SET balance = balance - amt WHERE id = a RETURNING balance INTO ba;   -- CHECK rejects negatives
  EXCEPTION WHEN check_violation THEN PERFORM eco._err('insufficient', 'insufficient funds');
  END;
  UPDATE eco.wallets SET balance = balance + amt WHERE id = b RETURNING balance INTO bb;
  INSERT INTO eco.ledger_entries(tx_id, wallet_id, currency, amount, balance_after) VALUES (tx, a, cur, -amt, ba), (tx, b, cur, amt, bb);
END $$;

CREATE FUNCTION eco._tx(op text, ik text, actor text) RETURNS bigint LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO eco.ledger_tx(op_type, idem_key, actor) VALUES (op, ik, actor) RETURNING id $$;

-- Progression hook: a player_event row (prog schema, 0005). Late-bound: resolved at call time.
CREATE FUNCTION eco._event(p uuid, typ text, payload jsonb, tx bigint) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO prog.player_events(player_id, type_id, payload, source, ledger_tx) VALUES (p, typ, payload, 'eco', tx);
END $$;

CREATE FUNCTION eco._player(p uuid) RETURNS eco.players LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE r eco.players;
BEGIN
  SELECT * INTO r FROM eco.players WHERE id = p;
  IF r.id IS NULL THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  RETURN r;
END $$;

-- Lock two players in id order (deadlock-free), check sanctions, account age and blocks.
CREATE FUNCTION eco._pair_checks(p_from uuid, p_to uuid, age_key text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE f eco.players; t eco.players; min_age interval;
BEGIN
  IF p_from = p_to THEN PERFORM eco._err('self', 'cannot target yourself'); END IF;
  PERFORM 1 FROM eco.players WHERE id IN (p_from, p_to) ORDER BY id FOR UPDATE;
  f := eco._player(p_from); t := eco._player(p_to);
  IF f.trade_frozen OR t.trade_frozen THEN PERFORM eco._err('frozen', 'trading/gifting frozen'); END IF;
  min_age := make_interval(days => eco.cfg(age_key)::int);
  IF f.created_at > now() - min_age OR t.created_at > now() - min_age THEN PERFORM eco._err('account_age', 'account too new'); END IF;
  IF EXISTS (SELECT 1 FROM mod.blocks WHERE (player_id = p_to AND blocked_id = p_from) OR (player_id = p_from AND blocked_id = p_to)) THEN
    PERFORM eco._err('blocked', 'blocked');
  END IF;
END $$;

-- Common item checks before a gift / trade lock (item row must already be locked FOR UPDATE).
CREATE FUNCTION eco._item_transferable(it eco.item_instances, owner uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE d eco.item_definitions;
BEGIN
  IF it.id IS NULL THEN PERFORM eco._err('unknown_item', 'unknown item'); END IF;
  IF it.owner_id <> owner THEN PERFORM eco._err('not_owner', 'not the owner'); END IF;
  SELECT * INTO d FROM eco.item_definitions WHERE id = it.def_id;
  IF NOT d.tradable THEN PERFORM eco._err('not_tradable', 'item explicitly marked non-tradable'); END IF;
  IF it.state <> 'owned' THEN PERFORM eco._err('item_state', 'item busy (' || it.state || ')'); END IF;
  IF it.hold_until IS NOT NULL AND it.hold_until > now() THEN PERFORM eco._err('on_hold', 'item on hold until ' || it.hold_until); END IF;
END $$;

-- ============================================================================================
-- Public API (SECURITY DEFINER). Each call = one SQL statement = one transaction.
-- ============================================================================================
CREATE FUNCTION eco.ensure_player(p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO eco.players(id) VALUES (p_player) ON CONFLICT (id) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'player', p_player);
END $$;

-- TEST Gold grant: local/UAT only, credits the GOLD_TEST currency (never GOLD).
CREATE FUNCTION eco.test_grant_gold(p_key text, p_player uuid, p_amount bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('test_grant', p_player, p_key); prev jsonb; tx bigint; c text;
BEGIN
  IF eco.env_tag() = 'prod' THEN PERFORM eco._err('forbidden_env', 'TEST Gold does not exist in production'); END IF;
  prev := eco._claim(ik, p_key, p_player, 'test_grant', md5(p_player::text || ':' || p_amount)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > eco.cfg('test.grant_max_per_call') THEN PERFORM eco._err('amount', 'amount out of range'); END IF;
  PERFORM eco._player(p_player);
  c := eco.cur('GOLD');
  tx := eco._tx('test_grant', ik, 'system:test');
  PERFORM eco._move(tx, eco._wallet(NULL, c, 'mint:test'), eco._wallet(p_player, c), c, p_amount);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx, 'currency', c, 'amount', p_amount));
END $$;

-- DEV ONLY (env = local), NOT granted to app_api: lets tests/dev seed TEST Diamonds without any payment.
CREATE FUNCTION eco.dev_grant(p_key text, p_player uuid, p_base text, p_amount bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('dev_grant', p_player, p_key); prev jsonb; tx bigint; c text := eco.cur(p_base);
BEGIN
  IF eco.env_tag() <> 'local' THEN PERFORM eco._err('forbidden_env', 'dev_grant is local only'); END IF;
  prev := eco._claim(ik, p_key, p_player, 'dev_grant', md5(p_player::text || ':' || p_base || ':' || p_amount)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM eco._player(p_player);
  tx := eco._tx('dev_grant', ik, 'system:dev');
  PERFORM eco._move(tx, eco._wallet(NULL, c, 'mint:test'), eco._wallet(p_player, c), c, p_amount);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx, 'currency', c, 'amount', p_amount));
END $$;

-- Daily reward: one per Europe/Paris day (PRIMARY KEY), amount from eco.reward_rules (VIP-independent).
CREATE FUNCTION eco.claim_daily(p_key text, p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('claim_daily', p_player, p_key); prev jsonb; tx bigint; c text; rr eco.reward_rules;
        per text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'claim_daily', md5(p_player::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM eco._player(p_player);
  SELECT * INTO rr FROM eco.reward_rules WHERE id = 'daily' AND active;
  IF rr.id IS NULL THEN PERFORM eco._err('inactive', 'daily reward inactive'); END IF;
  c := eco.cur('GOLD');
  tx := eco._tx('reward', ik, 'user:' || p_player);
  BEGIN
    INSERT INTO eco.reward_claims(player_id, rule_id, period, ledger_tx) VALUES (p_player, 'daily', per, tx);
  EXCEPTION WHEN unique_violation THEN PERFORM eco._err('already_claimed', 'daily reward already claimed for ' || per);
  END;
  PERFORM eco._move(tx, eco._wallet(NULL, c, 'mint:reward'), eco._wallet(p_player, c), c, rr.gold);
  PERFORM eco._event(p_player, 'reward_daily', jsonb_build_object('gold', rr.gold, 'period', per), tx);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx, 'gold', rr.gold, 'period', per));
END $$;

-- Shop purchase. Limited stock: the definition row is the lock (1000 buys of stock 1 -> 1 success).
-- Diamond purchases are TRADABLE unless the definition says tradable = false; they only get the
-- configurable security hold (item.diamond_hold_days, pending approval).
CREATE FUNCTION eco.shop_buy(p_key text, p_player uuid, p_def text, p_currency text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('shop_buy', p_player, p_key); prev jsonb; tx bigint; c text; d eco.item_definitions;
        price bigint; item uuid; hold_days int; hold timestamptz;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'shop_buy', md5(p_player::text || ':' || p_def || ':' || coalesce(p_currency, ''))); IF prev IS NOT NULL THEN RETURN prev; END IF;
  c := eco.cur(p_currency);
  PERFORM eco._player(p_player);
  SELECT * INTO d FROM eco.item_definitions WHERE id = p_def;
  IF d.id IS NULL OR NOT d.active THEN PERFORM eco._err('not_for_sale', 'item not for sale'); END IF;
  price := CASE p_currency WHEN 'GOLD' THEN d.price_gold ELSE d.price_diamond END;
  IF price IS NULL THEN PERFORM eco._err('not_for_sale', 'no price in ' || p_currency); END IF;
  IF d.stock_limit IS NOT NULL THEN
    UPDATE eco.item_definitions SET stock_sold = stock_sold + 1 WHERE id = p_def AND stock_sold < stock_limit;
    IF NOT FOUND THEN PERFORM eco._err('sold_out', 'sold out'); END IF;
  END IF;
  tx := eco._tx('shop_buy', ik, 'user:' || p_player);
  PERFORM eco._move(tx, eco._wallet(p_player, c), eco._wallet(NULL, c, 'sink:shop'), c, price);
  IF p_currency = 'DIAMOND' THEN
    hold_days := eco.cfg('item.diamond_hold_days')::int;
    IF hold_days > 0 THEN hold := now() + make_interval(days => hold_days); END IF;
  END IF;
  INSERT INTO eco.item_instances(def_id, owner_id, origin, hold_until)
    VALUES (p_def, p_player, CASE p_currency WHEN 'GOLD' THEN 'gold' ELSE 'diamond' END, hold) RETURNING id INTO item;
  INSERT INTO eco.item_moves(item_id, from_id, to_id, reason, idem_key) VALUES (item, NULL, p_player, 'shop', ik);
  PERFORM eco._event(p_player, 'shop_buy', jsonb_build_object('def', p_def, 'currency', p_currency, 'price', price, 'item', item), tx);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx, 'item', item, 'price', price, 'currency', c,
                                          'tradable', d.tradable, 'hold_until', hold));
END $$;

-- Activity (factory, farm...): start a session; each task is paid only if the SERVER clock says the
-- minimum duration elapsed since the previous task (or the start), within a per-day task cap.
CREATE FUNCTION eco.activity_start(p_key text, p_player uuid, p_def text, p_room text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('activity_start', p_player, p_key); prev jsonb; s uuid; d eco.activity_definitions;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'activity_start', md5(p_player::text || ':' || p_def || ':' || p_room)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM eco._player(p_player);
  SELECT * INTO d FROM eco.activity_definitions WHERE id = p_def AND active;
  IF d.id IS NULL THEN PERFORM eco._err('inactive', 'unknown activity'); END IF;
  PERFORM 1 FROM eco.players WHERE id = p_player FOR UPDATE;
  SELECT id INTO s FROM eco.activity_sessions WHERE player_id = p_player AND def_id = p_def AND ended_at IS NULL;
  IF s IS NOT NULL THEN RETURN eco._done(ik, jsonb_build_object('ok', true, 'session', s, 'resumed', true)); END IF;
  INSERT INTO eco.activity_sessions(player_id, def_id, room_id) VALUES (p_player, p_def, p_room) RETURNING id INTO s;
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'session', s, 'min_seconds', d.task_min_seconds));
END $$;

CREATE FUNCTION eco.activity_complete_task(p_key text, p_player uuid, p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('activity_task', p_player, p_key); prev jsonb; tx bigint; c text; s eco.activity_sessions;
        d eco.activity_definitions; rr eco.reward_rules; n int; elapsed numeric;
        day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'activity_task', md5(p_player::text || ':' || p_session)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM 1 FROM eco.players WHERE id = p_player FOR UPDATE;          -- serialises all tasks of this player
  SELECT * INTO s FROM eco.activity_sessions WHERE id = p_session FOR UPDATE;
  IF s.id IS NULL OR s.player_id <> p_player THEN PERFORM eco._err('bad_session', 'unknown session'); END IF;
  IF s.ended_at IS NOT NULL THEN PERFORM eco._err('session_ended', 'session ended'); END IF;
  SELECT * INTO d FROM eco.activity_definitions WHERE id = s.def_id;
  SELECT * INTO rr FROM eco.reward_rules WHERE id = d.reward_rule AND active;
  IF rr.id IS NULL THEN PERFORM eco._err('inactive', 'reward inactive'); END IF;
  elapsed := extract(epoch FROM now() - coalesce(s.last_task_at, s.started_at));
  IF elapsed < d.task_min_seconds THEN
    PERFORM eco._err('too_fast', format('task needs %s s, %s s elapsed', d.task_min_seconds, floor(elapsed)));
  END IF;
  SELECT count(*) INTO n FROM eco.reward_claims WHERE player_id = p_player AND rule_id = rr.id AND claimed_at >= day_start;
  IF n >= d.daily_task_cap THEN PERFORM eco._err('daily_cap', 'daily task cap reached'); END IF;
  c := eco.cur('GOLD');
  tx := eco._tx('activity', ik, 'user:' || p_player);
  INSERT INTO eco.reward_claims(player_id, rule_id, period, ledger_tx) VALUES (p_player, rr.id, 'task:' || s.id || ':' || (s.tasks_done + 1), tx);
  PERFORM eco._move(tx, eco._wallet(NULL, c, 'mint:reward'), eco._wallet(p_player, c), c, rr.gold);
  UPDATE eco.activity_sessions SET tasks_done = tasks_done + 1, last_task_at = now() WHERE id = s.id;
  PERFORM eco._event(p_player, 'activity_task', jsonb_build_object('def', d.id, 'session', s.id, 'n', s.tasks_done + 1, 'gold', rr.gold), tx);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx, 'gold', rr.gold, 'tasks_done', s.tasks_done + 1));
END $$;

CREATE FUNCTION eco.activity_end(p_player uuid, p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE eco.activity_sessions SET ended_at = now() WHERE id = p_session AND player_id = p_player AND ended_at IS NULL;
  RETURN jsonb_build_object('ok', true, 'ended', FOUND);
END $$;

-- Gifts (foundation; limits are pending approval, see eco.config)
CREATE FUNCTION eco.gift_gold(p_key text, p_from uuid, p_to uuid, p_amount bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('gift_gold', p_from, p_key); prev jsonb; tx bigint; c text; sent bigint; recv bigint; n int;
BEGIN
  prev := eco._claim(ik, p_key, p_from, 'gift_gold', md5(p_from::text || ':' || p_to || ':' || p_amount)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > eco.cfg('gift.gold_max_per_gift') THEN PERFORM eco._err('amount', 'amount out of range'); END IF;
  PERFORM eco._pair_checks(p_from, p_to, 'gift.min_account_age_days');
  SELECT coalesce(sum(gold), 0), count(*) INTO sent, n FROM eco.gifts WHERE from_id = p_from AND at > now() - interval '24 hours';
  SELECT coalesce(sum(gold), 0) INTO recv FROM eco.gifts WHERE to_id = p_to AND at > now() - interval '24 hours';
  IF n >= eco.cfg('gift.count_per_day') THEN PERFORM eco._err('cap_count', 'daily gift count reached'); END IF;
  IF sent + p_amount > eco.cfg('gift.gold_sent_per_day') THEN PERFORM eco._err('cap_sent', 'daily gift gold reached'); END IF;
  IF recv + p_amount > eco.cfg('gift.gold_received_per_day') THEN PERFORM eco._err('cap_received', 'receiver daily cap'); END IF;
  c := eco.cur('GOLD');
  tx := eco._tx('gift_gold', ik, 'user:' || p_from);
  PERFORM eco._move(tx, eco._wallet(p_from, c), eco._wallet(p_to, c), c, p_amount);
  INSERT INTO eco.gifts(idem_key, from_id, to_id, gold, ledger_tx) VALUES (ik, p_from, p_to, p_amount, tx);
  PERFORM eco._event(p_from, 'gift_sent', jsonb_build_object('to', p_to, 'gold', p_amount), tx);
  PERFORM eco._event(p_to, 'gift_received', jsonb_build_object('from', p_from, 'gold', p_amount), tx);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx));
END $$;

CREATE FUNCTION eco.gift_item(p_key text, p_from uuid, p_to uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('gift_item', p_from, p_key); prev jsonb; it eco.item_instances; n int;
BEGIN
  prev := eco._claim(ik, p_key, p_from, 'gift_item', md5(p_from::text || ':' || p_to || ':' || p_item)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM eco._pair_checks(p_from, p_to, 'gift.min_account_age_days');
  SELECT count(*) INTO n FROM eco.gifts WHERE from_id = p_from AND at > now() - interval '24 hours';
  IF n >= eco.cfg('gift.count_per_day') THEN PERFORM eco._err('cap_count', 'daily gift count reached'); END IF;
  SELECT * INTO it FROM eco.item_instances WHERE id = p_item FOR UPDATE;
  PERFORM eco._item_transferable(it, p_from);
  UPDATE eco.item_instances SET owner_id = p_to, version = version + 1 WHERE id = p_item;
  INSERT INTO eco.item_moves(item_id, from_id, to_id, reason, idem_key) VALUES (p_item, p_from, p_to, 'gift', ik);
  INSERT INTO eco.gifts(idem_key, from_id, to_id, item_id) VALUES (ik, p_from, p_to, p_item);
  PERFORM eco._event(p_from, 'gift_sent', jsonb_build_object('to', p_to, 'item', p_item), NULL);
  PERFORM eco._event(p_to, 'gift_received', jsonb_build_object('from', p_from, 'item', p_item), NULL);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'item', p_item));
END $$;

-- Trade lock: both players accepted the same offer version in the trade room. p_lines is a JSON array of
-- {"side":"a"|"b","item":"<uuid>"} or {"side":"a"|"b","gold":<n>}. At least one item (otherwise it is a gift).
-- Items -> trade_locked; Gold -> each side's escrow wallet. Diamonds cannot be represented.
CREATE FUNCTION eco.trade_lock(p_key text, p_trade uuid, p_actor uuid, p_a uuid, p_b uuid, p_version int, p_hash text, p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('trade_lock', p_actor, p_key); prev jsonb; tx bigint; c text; l jsonb; it eco.item_instances;
        items uuid[] := '{}'; ga bigint := 0; gb bigint := 0; side text; n_items int := 0; owner uuid;
BEGIN
  prev := eco._claim(ik, p_key, p_actor, 'trade_lock',
                     md5(concat_ws(':', p_trade, p_a, p_b, p_version, p_hash, p_lines::text))); IF prev IS NOT NULL THEN RETURN prev; END IF;
  IF p_actor IS NULL OR p_actor NOT IN (p_a, p_b) THEN PERFORM eco._err('not_participant', 'actor is not a participant'); END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > eco.cfg('trade.max_lines') THEN PERFORM eco._err('bad_lines', 'invalid lines'); END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    side := l->>'side';
    IF side IS NULL OR side NOT IN ('a','b') OR ((l ? 'item') = (l ? 'gold')) OR (l - 'side' - 'item' - 'gold') <> '{}'::jsonb THEN
      PERFORM eco._err('bad_lines', 'invalid line ' || l::text);
    END IF;
    IF l ? 'item' THEN
      IF (l->>'item')::uuid = ANY (items) THEN PERFORM eco._err('bad_lines', 'duplicate item'); END IF;
      items := items || (l->>'item')::uuid; n_items := n_items + 1;
    ELSE
      IF jsonb_typeof(l->'gold') <> 'number' OR (l->>'gold')::numeric <> floor((l->>'gold')::numeric) OR (l->>'gold')::numeric <= 0 THEN
        PERFORM eco._err('bad_lines', 'invalid gold'); END IF;
      IF side = 'a' THEN ga := ga + (l->>'gold')::bigint; ELSE gb := gb + (l->>'gold')::bigint; END IF;
    END IF;
  END LOOP;
  IF n_items = 0 THEN PERFORM eco._err('no_item', 'a trade needs at least one item (otherwise use a gift)'); END IF;
  PERFORM eco._pair_checks(p_a, p_b, 'trade.min_account_age_days');
  IF EXISTS (SELECT 1 FROM eco.trades WHERE id = p_trade) THEN PERFORM eco._err('trade_exists', 'trade already locked/closed'); END IF;
  -- lock every item in id order, then validate ownership per side
  PERFORM 1 FROM eco.item_instances WHERE id = ANY (items) ORDER BY id FOR UPDATE;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) WHERE value ? 'item' LOOP
    SELECT * INTO it FROM eco.item_instances WHERE id = (l->>'item')::uuid;
    owner := CASE l->>'side' WHEN 'a' THEN p_a ELSE p_b END;
    PERFORM eco._item_transferable(it, owner);
  END LOOP;
  IF ga > 0 OR gb > 0 THEN
    c := eco.cur('GOLD');
    tx := eco._tx('trade_lock', ik, 'user:' || p_actor);
    IF ga > 0 THEN PERFORM eco._move(tx, eco._wallet(p_a, c), eco._wallet(p_a, c, 'escrow'), c, ga); END IF;
    IF gb > 0 THEN PERFORM eco._move(tx, eco._wallet(p_b, c), eco._wallet(p_b, c, 'escrow'), c, gb); END IF;
  END IF;
  BEGIN
    INSERT INTO eco.trades(id, a_id, b_id, status, offer_version, offer_hash, lock_tx, expires_at)
      VALUES (p_trade, p_a, p_b, 'locked', p_version, p_hash, tx, now() + make_interval(mins => eco.cfg('trade.lock_minutes')::int));
  EXCEPTION WHEN unique_violation THEN PERFORM eco._err('trade_exists', 'trade already locked/closed');
  END;
  INSERT INTO eco.trade_lines(trade_id, side, item_id, gold)
    SELECT p_trade, value->>'side', (value->>'item')::uuid, (value->>'gold')::bigint FROM jsonb_array_elements(p_lines);
  UPDATE eco.item_instances SET state = 'trade_locked', locked_by_trade = p_trade, version = version + 1 WHERE id = ANY (items);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'trade', p_trade, 'tx', tx, 'status', 'locked'));
END $$;

-- Release / transfer helpers for settle & cancel (trade row and players already locked by the caller).
CREATE FUNCTION eco._trade_close(p_key text, p_trade uuid, p_actor uuid, p_settle boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE op text := CASE WHEN p_settle THEN 'trade_settle' ELSE 'trade_cancel' END;
        ik text := eco._ikey(op, p_actor, p_key); prev jsonb; t eco.trades; tx bigint; c text := eco.cur('GOLD');
        ga bigint; gb bigint; l eco.trade_lines; it eco.item_instances; to_player uuid; from_player uuid; bad int;
BEGIN
  prev := eco._claim(ik, p_key, p_actor, op, md5(p_trade::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  SELECT * INTO t FROM eco.trades WHERE id = p_trade FOR UPDATE;
  IF t.id IS NULL THEN PERFORM eco._err('unknown_trade', 'unknown trade'); END IF;
  IF t.status <> 'locked' THEN PERFORM eco._err('bad_state', 'trade is ' || t.status); END IF;
  IF p_settle THEN
    IF p_actor IS NULL OR p_actor NOT IN (t.a_id, t.b_id) THEN PERFORM eco._err('not_participant', 'actor is not a participant'); END IF;
    IF t.expires_at <= now() THEN PERFORM eco._err('expired', 'trade lock expired; cancel it'); END IF;
  ELSE
    -- a participant may cancel at any time; anyone (cron/system, p_actor NULL) only once expired
    IF (p_actor IS NULL OR p_actor NOT IN (t.a_id, t.b_id)) AND t.expires_at > now() THEN
      PERFORM eco._err('not_participant', 'only a participant can cancel before expiry');
    END IF;
  END IF;
  PERFORM 1 FROM eco.players WHERE id IN (t.a_id, t.b_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM eco.item_instances WHERE locked_by_trade = p_trade ORDER BY id FOR UPDATE;
  -- invariant: every item line is still locked by THIS trade and owned by its side
  SELECT count(*) INTO bad FROM eco.trade_lines x JOIN eco.item_instances i ON i.id = x.item_id
   WHERE x.trade_id = p_trade AND (i.locked_by_trade IS DISTINCT FROM p_trade OR i.state <> 'trade_locked'
         OR i.owner_id <> CASE x.side WHEN 'a' THEN t.a_id ELSE t.b_id END);
  IF bad > 0 THEN PERFORM eco._err('invariant', 'trade items changed while locked'); END IF;
  SELECT coalesce(sum(gold) FILTER (WHERE side = 'a'), 0), coalesce(sum(gold) FILTER (WHERE side = 'b'), 0) INTO ga, gb
    FROM eco.trade_lines WHERE trade_id = p_trade;
  IF ga > 0 OR gb > 0 THEN
    tx := eco._tx(op, ik, coalesce('user:' || p_actor, 'system:expiry'));
    IF ga > 0 THEN PERFORM eco._move(tx, eco._wallet(t.a_id, c, 'escrow'), eco._wallet(CASE WHEN p_settle THEN t.b_id ELSE t.a_id END, c), c, ga); END IF;
    IF gb > 0 THEN PERFORM eco._move(tx, eco._wallet(t.b_id, c, 'escrow'), eco._wallet(CASE WHEN p_settle THEN t.a_id ELSE t.b_id END, c), c, gb); END IF;
  END IF;
  FOR l IN SELECT * FROM eco.trade_lines WHERE trade_id = p_trade AND item_id IS NOT NULL ORDER BY item_id LOOP
    from_player := CASE l.side WHEN 'a' THEN t.a_id ELSE t.b_id END;
    to_player := CASE WHEN NOT p_settle THEN from_player WHEN l.side = 'a' THEN t.b_id ELSE t.a_id END;
    UPDATE eco.item_instances SET owner_id = to_player, state = 'owned', locked_by_trade = NULL, version = version + 1 WHERE id = l.item_id;
    IF p_settle THEN
      INSERT INTO eco.item_moves(item_id, from_id, to_id, reason, idem_key) VALUES (l.item_id, from_player, to_player, 'trade', ik);
    END IF;
  END LOOP;
  IF p_settle THEN
    UPDATE eco.trades SET status = 'settled', settle_tx = tx, closed_at = now(), closed_by = p_actor WHERE id = p_trade;
    PERFORM eco._event(t.a_id, 'trade_settled', jsonb_build_object('trade', p_trade), tx);
    PERFORM eco._event(t.b_id, 'trade_settled', jsonb_build_object('trade', p_trade), tx);
  ELSE
    UPDATE eco.trades SET status = 'cancelled', cancel_tx = tx, closed_at = now(), closed_by = p_actor WHERE id = p_trade;
  END IF;
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'trade', p_trade, 'tx', tx, 'status', CASE WHEN p_settle THEN 'settled' ELSE 'cancelled' END));
END $$;

CREATE FUNCTION eco.trade_settle(p_key text, p_trade uuid, p_actor uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT eco._trade_close(p_key, p_trade, p_actor, true) $$;
CREATE FUNCTION eco.trade_cancel(p_key text, p_trade uuid, p_actor uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT eco._trade_close(p_key, p_trade, p_actor, false) $$;

-- ============================================================================================
-- Read functions (no table SELECT for app_api: it reads through these)
-- ============================================================================================
CREATE FUNCTION eco.get_balances(p_player uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'gold',    coalesce((SELECT balance FROM eco.wallets WHERE player_id = p_player AND purpose = 'main'   AND currency = eco.cur('GOLD')), 0),
    'diamond', coalesce((SELECT balance FROM eco.wallets WHERE player_id = p_player AND purpose = 'main'   AND currency = eco.cur('DIAMOND')), 0),
    'gold_in_escrow', coalesce((SELECT balance FROM eco.wallets WHERE player_id = p_player AND purpose = 'escrow' AND currency = eco.cur('GOLD')), 0),
    'test', eco.env_tag() <> 'prod') $$;
CREATE FUNCTION eco.list_items(p_player uuid) RETURNS TABLE (id uuid, def_id text, state text, origin text, tradable boolean, hold_until timestamptz, acquired_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT i.id, i.def_id, i.state, i.origin, d.tradable, i.hold_until, i.acquired_at
  FROM eco.item_instances i JOIN eco.item_definitions d ON d.id = i.def_id
  WHERE i.owner_id = p_player AND i.state <> 'revoked' ORDER BY i.acquired_at, i.id $$;
CREATE FUNCTION eco.get_config() RETURNS TABLE (key text, value numeric, status text, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT key, value, status, note FROM eco.config ORDER BY key $$;

-- ============================================================================================
-- Reconciliation (must all be empty / zero)
-- ============================================================================================
CREATE VIEW eco.recon_wallets AS          -- each balance = sum of its entries
  SELECT w.id, w.currency, w.purpose, w.balance, coalesce(sum(e.amount), 0) AS ledger_sum
  FROM eco.wallets w LEFT JOIN eco.ledger_entries e ON e.wallet_id = w.id GROUP BY w.id
  HAVING w.balance <> coalesce(sum(e.amount), 0);
CREATE VIEW eco.recon_unbalanced_tx AS    -- each tx balanced per currency
  SELECT tx_id, currency, sum(amount) AS s FROM eco.ledger_entries GROUP BY tx_id, currency HAVING sum(amount) <> 0;
CREATE VIEW eco.recon_totals AS           -- global sum per currency = 0 (mint wallets are negative)
  SELECT currency, sum(balance) AS total FROM eco.wallets GROUP BY currency;
CREATE VIEW eco.recon_last_balance AS     -- balance = balance_after of the wallet's last entry
  SELECT w.id, w.balance, e.balance_after FROM eco.wallets w
  JOIN LATERAL (SELECT balance_after FROM eco.ledger_entries x WHERE x.wallet_id = w.id ORDER BY x.id DESC LIMIT 1) e ON true
  WHERE w.balance <> e.balance_after;
CREATE VIEW eco.recon_items AS            -- item ownership = last provenance move; locks point to live trades
  SELECT i.id, 'owner_mismatch' AS problem FROM eco.item_instances i
    JOIN LATERAL (SELECT to_id FROM eco.item_moves m WHERE m.item_id = i.id ORDER BY m.id DESC LIMIT 1) m ON true
   WHERE m.to_id <> i.owner_id
  UNION ALL
  SELECT i.id, 'no_provenance' FROM eco.item_instances i WHERE NOT EXISTS (SELECT 1 FROM eco.item_moves m WHERE m.item_id = i.id)
  UNION ALL
  SELECT i.id, 'dangling_trade_lock' FROM eco.item_instances i
   WHERE i.locked_by_trade IS NOT NULL AND NOT EXISTS (SELECT 1 FROM eco.trades t WHERE t.id = i.locked_by_trade AND t.status = 'locked')
  UNION ALL
  SELECT x.item_id, 'open_trade_item_unlocked' FROM eco.trade_lines x JOIN eco.trades t ON t.id = x.trade_id AND t.status = 'locked'
   JOIN eco.item_instances i ON i.id = x.item_id WHERE i.locked_by_trade IS DISTINCT FROM t.id;
CREATE VIEW eco.recon_escrow AS           -- escrow balance = gold of that player's open trades
  SELECT p.player_id, p.balance, coalesce(o.gold, 0) AS open_gold FROM eco.wallets p
  LEFT JOIN (SELECT CASE x.side WHEN 'a' THEN t.a_id ELSE t.b_id END AS pid, sum(x.gold) AS gold
               FROM eco.trade_lines x JOIN eco.trades t ON t.id = x.trade_id AND t.status = 'locked' WHERE x.gold IS NOT NULL GROUP BY 1) o
    ON o.pid = p.player_id
  WHERE p.purpose = 'escrow' AND p.balance <> coalesce(o.gold, 0);
CREATE VIEW eco.recon_stock AS            -- limited stock counter = instances bought in the shop
  SELECT d.id, d.stock_sold, count(i.id) AS shop_instances FROM eco.item_definitions d
  LEFT JOIN eco.item_instances i ON i.def_id = d.id AND i.origin IN ('gold','diamond')
  WHERE d.stock_limit IS NOT NULL GROUP BY d.id HAVING d.stock_sold <> count(i.id);

CREATE FUNCTION eco.recon_summary() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'wallet_mismatch',     (SELECT count(*) FROM eco.recon_wallets),
    'unbalanced_tx',       (SELECT count(*) FROM eco.recon_unbalanced_tx),
    'nonzero_totals',      (SELECT count(*) FROM eco.recon_totals WHERE total <> 0),
    'last_balance_mismatch', (SELECT count(*) FROM eco.recon_last_balance),
    'negative_player',     (SELECT count(*) FROM eco.wallets WHERE owner_kind = 'player' AND balance < 0),
    'item_problems',       (SELECT count(*) FROM eco.recon_items),
    'escrow_mismatch',     (SELECT count(*) FROM eco.recon_escrow),
    'stock_mismatch',      (SELECT count(*) FROM eco.recon_stock),
    'diamond_cross_player_tx', (SELECT count(*) FROM (SELECT e.tx_id FROM eco.ledger_entries e JOIN eco.wallets w ON w.id = e.wallet_id
                               WHERE e.currency IN ('DIAMOND','DIAMOND_TEST') AND w.owner_kind = 'player'
                               GROUP BY e.tx_id HAVING count(DISTINCT w.player_id) > 1) z),
    'test_currency_in_prod', (SELECT count(*) FROM eco.wallets WHERE eco.env_tag() = 'prod' AND currency LIKE '%\_TEST')) $$;
CREATE VIEW eco.mint_24h AS               -- money creation per op type over 24 h (alerting)
  SELECT t.op_type, e.currency, -sum(e.amount) AS minted FROM eco.ledger_entries e
  JOIN eco.ledger_tx t ON t.id = e.tx_id JOIN eco.wallets w ON w.id = e.wallet_id
  WHERE w.purpose LIKE 'mint:%' AND t.created_at > now() - interval '24 hours' GROUP BY 1, 2;

-- ============================================================================================
-- Grants: app_api = EXECUTE on this whitelist ONLY.
-- ============================================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA eco FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA eco FROM PUBLIC;
GRANT USAGE ON SCHEMA eco TO app_api, reporting_ro, admin_ops;
GRANT EXECUTE ON FUNCTION
  eco.ensure_player(uuid),
  eco.test_grant_gold(text, uuid, bigint),
  eco.claim_daily(text, uuid),
  eco.shop_buy(text, uuid, text, text),
  eco.activity_start(text, uuid, text, text),
  eco.activity_complete_task(text, uuid, uuid),
  eco.activity_end(uuid, uuid),
  eco.gift_gold(text, uuid, uuid, bigint),
  eco.gift_item(text, uuid, uuid, uuid),
  eco.trade_lock(text, uuid, uuid, uuid, uuid, int, text, jsonb),
  eco.trade_settle(text, uuid, uuid),
  eco.trade_cancel(text, uuid, uuid),
  eco.get_balances(uuid),
  eco.list_items(uuid),
  eco.get_config(),
  eco.recon_summary()
TO app_api;
GRANT EXECUTE ON FUNCTION eco.recon_summary(), eco.get_config() TO reporting_ro;
GRANT SELECT ON eco.recon_wallets, eco.recon_unbalanced_tx, eco.recon_totals, eco.recon_last_balance, eco.recon_items,
  eco.recon_escrow, eco.recon_stock, eco.mint_24h TO reporting_ro;
RESET ROLE;
