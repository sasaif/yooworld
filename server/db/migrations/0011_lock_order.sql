-- 0011_lock_order — QA finding B2 (deadlocks under mixed contention on one wallet).
-- Root cause: gift/trade functions locked player rows FOR UPDATE while shop_buy held the wallet row and then
-- inserted item rows whose foreign key to eco.players takes FOR KEY SHARE on the same player row. FOR UPDATE
-- conflicts with FOR KEY SHARE -> lock cycle (player <-> wallet) -> 40P01.
-- Fix = ONE global lock order for every EconomyGate function, and the weakest sufficient lock strength:
--   1. trade row (settle/cancel only)  2. player rows, ascending id, FOR NO KEY UPDATE (does not conflict with the
--   FK checks' FOR KEY SHARE)  3. item rows, ascending id, FOR UPDATE  4. item definition row (stock)
--   5. wallets, ascending id, FOR UPDATE (eco._move, unchanged).
-- Every function that touches a player's wallet now takes that player's row lock first (eco._lock_player), so
-- operations of one player are serialised instead of racing on the wallet. Bodies below are the previous
-- definitions (pg_get_functiondef) with only the lock statements changed.
SET LOCAL ROLE eco_owner;

CREATE FUNCTION eco._lock_player(p uuid) RETURNS eco.players LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE r eco.players;
BEGIN
  SELECT * INTO r FROM eco.players WHERE id = p FOR NO KEY UPDATE;
  IF r.id IS NULL THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  IF r.closed_at IS NOT NULL THEN PERFORM eco._err('account_closed', 'account closed'); END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION eco._lock_player(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION eco._pair_checks(p_from uuid, p_to uuid, age_key text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE f eco.players; t eco.players; min_age interval;
BEGIN
  IF p_from = p_to THEN PERFORM eco._err('self', 'cannot target yourself'); END IF;
  PERFORM 1 FROM eco.players WHERE id IN (p_from, p_to) ORDER BY id FOR NO KEY UPDATE;
  f := eco._player(p_from); t := eco._player(p_to);
  IF f.trade_frozen OR t.trade_frozen THEN PERFORM eco._err('frozen', 'trading/gifting frozen'); END IF;
  min_age := make_interval(days => eco.cfg(age_key)::int);
  IF f.created_at > now() - min_age OR t.created_at > now() - min_age THEN PERFORM eco._err('account_age', 'account too new'); END IF;
  IF EXISTS (SELECT 1 FROM mod.blocks WHERE (player_id = p_to AND blocked_id = p_from) OR (player_id = p_from AND blocked_id = p_to)) THEN
    PERFORM eco._err('blocked', 'blocked');
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION eco.activity_start(p_key text, p_player uuid, p_def text, p_room text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ik text := eco._ikey('activity_start', p_player, p_key); prev jsonb; s uuid; d eco.activity_definitions;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'activity_start', md5(p_player::text || ':' || p_def || ':' || p_room)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM eco._player(p_player);
  SELECT * INTO d FROM eco.activity_definitions WHERE id = p_def AND active;
  IF d.id IS NULL THEN PERFORM eco._err('inactive', 'unknown activity'); END IF;
  PERFORM 1 FROM eco.players WHERE id = p_player FOR NO KEY UPDATE;
  SELECT id INTO s FROM eco.activity_sessions WHERE player_id = p_player AND def_id = p_def AND ended_at IS NULL;
  IF s IS NOT NULL THEN RETURN eco._done(ik, jsonb_build_object('ok', true, 'session', s, 'resumed', true)); END IF;
  INSERT INTO eco.activity_sessions(player_id, def_id, room_id) VALUES (p_player, p_def, p_room) RETURNING id INTO s;
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'session', s, 'min_seconds', d.task_min_seconds));
END $function$;

CREATE OR REPLACE FUNCTION eco.activity_complete_task(p_key text, p_player uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ik text := eco._ikey('activity_task', p_player, p_key); prev jsonb; tx bigint; c text; s eco.activity_sessions;
        d eco.activity_definitions; rr eco.reward_rules; n int; elapsed numeric;
        day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'activity_task', md5(p_player::text || ':' || p_session)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM 1 FROM eco.players WHERE id = p_player FOR NO KEY UPDATE;          -- serialises all tasks of this player
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
END $function$;

CREATE OR REPLACE FUNCTION eco._trade_close(p_key text, p_trade uuid, p_actor uuid, p_settle boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  PERFORM 1 FROM eco.players WHERE id IN (t.a_id, t.b_id) ORDER BY id FOR NO KEY UPDATE;
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
END $function$;

CREATE OR REPLACE FUNCTION eco.shop_buy(p_key text, p_player uuid, p_def text, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ik text := eco._ikey('shop_buy', p_player, p_key); prev jsonb; tx bigint; c text; d eco.item_definitions;
        price bigint; item uuid; hold_days int; hold timestamptz;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'shop_buy', md5(p_player::text || ':' || p_def || ':' || coalesce(p_currency, ''))); IF prev IS NOT NULL THEN RETURN prev; END IF;
  c := eco.cur(p_currency);
  PERFORM eco._lock_player(p_player);
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
END $function$;

CREATE OR REPLACE FUNCTION eco.dev_grant(p_key text, p_player uuid, p_base text, p_amount bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ik text := eco._ikey('dev_grant', p_player, p_key); prev jsonb; tx bigint; c text := eco.cur(p_base);
BEGIN
  IF eco.env_tag() <> 'local' THEN PERFORM eco._err('forbidden_env', 'dev_grant is local only'); END IF;
  prev := eco._claim(ik, p_key, p_player, 'dev_grant', md5(p_player::text || ':' || p_base || ':' || p_amount)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM eco._lock_player(p_player);
  tx := eco._tx('dev_grant', ik, 'system:dev');
  PERFORM eco._move(tx, eco._wallet(NULL, c, 'mint:test'), eco._wallet(p_player, c), c, p_amount);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx, 'currency', c, 'amount', p_amount));
END $function$;

CREATE OR REPLACE FUNCTION eco.claim_daily(p_key text, p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ik text := eco._ikey('claim_daily', p_player, p_key); prev jsonb; tx bigint; c text; rr eco.reward_rules;
        per text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'claim_daily', md5(p_player::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  PERFORM eco._lock_player(p_player);
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
END $function$;

CREATE OR REPLACE FUNCTION eco.test_grant_gold(p_key text, p_player uuid, p_amount bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ik text := eco._ikey('test_grant', p_player, p_key); prev jsonb; tx bigint; c text;
BEGIN
  IF eco.env_tag() = 'prod' THEN PERFORM eco._err('forbidden_env', 'TEST Gold does not exist in production'); END IF;
  prev := eco._claim(ik, p_key, p_player, 'test_grant', md5(p_player::text || ':' || p_amount)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > eco.cfg('test.grant_max_per_call') THEN PERFORM eco._err('amount', 'amount out of range'); END IF;
  PERFORM eco._lock_player(p_player);
  c := eco.cur('GOLD');
  tx := eco._tx('test_grant', ik, 'system:test');
  PERFORM eco._move(tx, eco._wallet(NULL, c, 'mint:test'), eco._wallet(p_player, c), c, p_amount);
  RETURN eco._done(ik, jsonb_build_object('ok', true, 'tx', tx, 'currency', c, 'amount', p_amount));
END $function$;

CREATE OR REPLACE FUNCTION audit.admin_approve(p_admin uuid, p_request bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  PERFORM 1 FROM eco.players WHERE id = pl FOR NO KEY UPDATE;   -- lock order: player row before wallets
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
END $function$;

CREATE OR REPLACE FUNCTION eco.close_account(p_key text, p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ik text := eco._ikey('close_account', p_player, p_key); prev jsonb; r eco.players; t record; n_tr int := 0;
        bal jsonb; n_items int; n_saves int; res jsonb;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'close_account', md5(p_player::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  SELECT * INTO r FROM eco.players WHERE id = p_player;
  IF r.id IS NULL THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  IF r.closed_at IS NOT NULL THEN RETURN eco._done(ik, jsonb_build_object('ok', true, 'already_closed', true)); END IF;
  -- open trades are cancelled (items and escrowed Gold go back to their owners, through the normal ledger path)
  FOR t IN SELECT id FROM eco.trades WHERE status = 'locked' AND p_player IN (a_id, b_id) ORDER BY id LOOP
    PERFORM eco._trade_close('close-' || t.id, t.id, p_player, false); n_tr := n_tr + 1;
  END LOOP;
  PERFORM 1 FROM eco.players WHERE id = p_player FOR NO KEY UPDATE;   -- after the trades (trade row -> players order)
  bal := eco.get_balances(p_player);
  SELECT count(*) INTO n_items FROM eco.item_instances WHERE owner_id = p_player AND state <> 'revoked';
  UPDATE eco.players SET closed_at = now(), trade_frozen = true WHERE id = p_player;
  UPDATE eco.activity_sessions SET ended_at = now() WHERE player_id = p_player AND ended_at IS NULL;
  -- personal, mutable content is erased; append-only history stays (pseudonymous uuid only)
  DELETE FROM app.saves WHERE player_id = p_player; GET DIAGNOSTICS n_saves = ROW_COUNT;
  DELETE FROM social.event_members WHERE player_id = p_player;
  UPDATE social.events SET status = CASE WHEN status IN ('scheduled','live') THEN 'cancelled' ELSE status END,
                           title = '[supprimé]' WHERE owner_id = p_player;
  DELETE FROM mod.blocks WHERE player_id = p_player OR blocked_id = p_player;
  DELETE FROM prog.privacy_settings WHERE player_id = p_player;
  res := jsonb_build_object('ok', true, 'closed', true, 'trades_cancelled', n_tr, 'balances_frozen', bal,
                            'items_frozen', n_items, 'saves_erased', n_saves);
  INSERT INTO prog.player_events(player_id, type_id, payload, source) VALUES (p_player, 'account_closed', res, 'api');
  INSERT INTO audit.log(actor, action, target, after, reason, correlation_id)
    VALUES ('user:' || p_player, 'account_closed', p_player::text, res, 'self-service deletion', ik);
  RETURN eco._done(ik, res);
END $function$;

RESET ROLE;
