-- 0013_account_grace — deleted accounts, policy (a) (decided 2026-11-20 by the project director under Alessandro's
-- delegation of technical decisions):
--  * deletion REQUEST = account closed (economy + saves blocked, open trades cancelled, sessions revoked by the API),
--    nothing erased yet; restorable until deletion_due_at = request + eco.config['account.delete_grace_days'].
--  * FINALISATION (scheduled job, eco.finalize_deletions): balances moved by ledger transactions to the system
--    wallet 'sink:account_closed'; items transferred to the SYSTEM player (or revoked, config
--    'account.sweep_items_to_system' = 0) with an item_moves provenance row; personal mutable data erased; one
--    audit.log row per account. Ledger / provenance / audit rows are KEPT (pseudonymous uuid only). The auth side
--    (e-mail, name, credentials) is anonymised by the Worker right after (eco.pending_auth_erasure / mark_auth_erased).
SET LOCAL ROLE eco_owner;

INSERT INTO eco.config(key, value, status, note) VALUES
 ('account.delete_grace_days',     30, 'approved', 'grace period after a deletion request; restorable until it ends (policy (a), project director 2026-11-20)'),
 ('account.sweep_items_to_system', 1,  'approved', '1 = items of a finalised account go to the SYSTEM player (provenance row); 0 = revoked in place');
INSERT INTO prog.event_types VALUES
 ('account_restored',  1, false, 'deletion request cancelled during the grace period'),
 ('account_finalized', 1, true,  'account deletion finalised (balances swept, items transferred, personal data erased)');

ALTER TABLE eco.players ADD COLUMN deletion_due_at timestamptz, ADD COLUMN finalized_at timestamptz,
                        ADD COLUMN auth_erased_at timestamptz, ADD COLUMN frozen_before_close boolean;
ALTER TABLE eco.wallets DROP CONSTRAINT wallets_purpose_check, ADD CONSTRAINT wallets_purpose_check
  CHECK (purpose IN ('main','escrow','mint:test','mint:reward','sink:shop','iap:sales','admin','sink:account_closed'));
ALTER TABLE eco.ledger_tx DROP CONSTRAINT ledger_tx_op_type_check, ADD CONSTRAINT ledger_tx_op_type_check
  CHECK (op_type IN ('test_grant','dev_grant','reward','activity','gift_gold','gift_item','shop_buy','trade_lock','trade_settle',
                     'trade_cancel','iap_grant','iap_clawback','admin_adjust','reversal','account_sweep'));
ALTER TABLE eco.item_moves DROP CONSTRAINT item_moves_reason_check, ADD CONSTRAINT item_moves_reason_check
  CHECK (reason IN ('shop','gift','trade','reward','admin','starter','account_deleted'));

-- The SYSTEM player: owner of items taken over from finalised accounts. Closed, so no economy call can target it.
CREATE FUNCTION eco.system_player() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;
INSERT INTO eco.players(id, created_at, trade_frozen, closed_at, finalized_at, auth_erased_at)
  VALUES (eco.system_player(), now(), true, now(), now(), now());

-- ensure_player also reports the account state (the API blocks pending-deletion accounts except restore/export).
CREATE OR REPLACE FUNCTION eco.ensure_player(p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r eco.players;
BEGIN
  INSERT INTO eco.players(id) VALUES (p_player) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO r FROM eco.players WHERE id = p_player;
  RETURN jsonb_build_object('ok', true, 'player', p_player,
    'state', CASE WHEN r.finalized_at IS NOT NULL THEN 'deleted' WHEN r.closed_at IS NOT NULL THEN 'pending_deletion' ELSE 'active' END,
    'deletion_due_at', r.deletion_due_at);
END $$;

-- Deletion REQUEST (replaces the M3 immediate close+erase): restorable during the grace period.
CREATE OR REPLACE FUNCTION eco.close_account(p_key text, p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('close_account', p_player, p_key); prev jsonb; r eco.players; t record; n_tr int := 0;
        bal jsonb; n_items int; n_ev int; res jsonb; grace numeric;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'close_account', md5(p_player::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  SELECT * INTO r FROM eco.players WHERE id = p_player;
  IF r.id IS NULL THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  IF r.closed_at IS NOT NULL THEN
    RETURN eco._done(ik, jsonb_build_object('ok', true, 'already_closed', true, 'deletion_due_at', r.deletion_due_at));
  END IF;
  SELECT value INTO grace FROM eco.config WHERE key = 'account.delete_grace_days';
  FOR t IN SELECT id FROM eco.trades WHERE status = 'locked' AND p_player IN (a_id, b_id) ORDER BY id LOOP
    PERFORM eco._trade_close('close-' || t.id, t.id, p_player, false); n_tr := n_tr + 1;
  END LOOP;
  PERFORM 1 FROM eco.players WHERE id = p_player FOR NO KEY UPDATE;   -- after the trades (trade row -> players order)
  bal := eco.get_balances(p_player);
  SELECT count(*) INTO n_items FROM eco.item_instances WHERE owner_id = p_player AND state <> 'revoked';
  UPDATE eco.players SET closed_at = now(), deletion_due_at = now() + make_interval(days => grace::int),
                         frozen_before_close = trade_frozen, trade_frozen = true
   WHERE id = p_player RETURNING * INTO r;
  UPDATE eco.activity_sessions SET ended_at = now() WHERE player_id = p_player AND ended_at IS NULL;
  -- events owned by the player cannot run without them: upcoming/live ones are cancelled (not renamed until finalisation)
  UPDATE social.events SET status = 'cancelled' WHERE owner_id = p_player AND status IN ('scheduled','live');
  GET DIAGNOSTICS n_ev = ROW_COUNT;
  res := jsonb_build_object('ok', true, 'closed', true, 'deletion_due_at', r.deletion_due_at, 'grace_days', grace,
                            'trades_cancelled', n_tr, 'events_cancelled', n_ev, 'balances_frozen', bal, 'items_frozen', n_items);
  INSERT INTO prog.player_events(player_id, type_id, payload, source) VALUES (p_player, 'account_closed', res, 'api');
  INSERT INTO audit.log(actor, action, target, after, reason, correlation_id)
    VALUES ('user:' || p_player, 'account_deletion_requested', p_player::text, res, 'self-service deletion (grace period)', ik);
  RETURN eco._done(ik, res);
END $$;

CREATE FUNCTION eco.restore_account(p_key text, p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('restore_account', p_player, p_key); prev jsonb; r eco.players; res jsonb;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'restore_account', md5(p_player::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  SELECT * INTO r FROM eco.players WHERE id = p_player FOR NO KEY UPDATE;
  IF r.id IS NULL OR p_player = eco.system_player() THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  IF r.finalized_at IS NOT NULL THEN PERFORM eco._err('account_deleted', 'account already deleted'); END IF;
  IF r.closed_at IS NULL THEN RETURN eco._done(ik, jsonb_build_object('ok', true, 'already_active', true)); END IF;
  IF r.deletion_due_at <= now() THEN PERFORM eco._err('grace_expired', 'grace period is over'); END IF;
  UPDATE eco.players SET closed_at = NULL, deletion_due_at = NULL, trade_frozen = coalesce(frozen_before_close, false),
                         frozen_before_close = NULL WHERE id = p_player;
  res := jsonb_build_object('ok', true, 'restored', true, 'was_due_at', r.deletion_due_at);
  INSERT INTO prog.player_events(player_id, type_id, payload, source) VALUES (p_player, 'account_restored', res, 'api');
  INSERT INTO audit.log(actor, action, target, after, reason, correlation_id)
    VALUES ('user:' || p_player, 'account_restored', p_player::text, res, 'deletion cancelled during grace', ik);
  RETURN eco._done(ik, res);
END $$;

-- Finalise ONE account (caller holds nothing; lock order: player -> items asc -> wallets asc via _move).
CREATE FUNCTION eco._finalize_account(p uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('finalize_account', NULL, p::text); prev jsonb; r eco.players; w record; tx bigint;
        swept jsonb := '{}'; it record; n_moved int := 0; n_revoked int := 0; to_system boolean; n_saves int; res jsonb;
BEGIN
  prev := eco._claim(ik, p::text, NULL, 'finalize_account', md5(p::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  SELECT * INTO r FROM eco.players WHERE id = p FOR NO KEY UPDATE;
  IF r.closed_at IS NULL OR r.finalized_at IS NOT NULL OR r.deletion_due_at > now() THEN
    RETURN eco._done(ik, jsonb_build_object('ok', false, 'code', 'not_due'));
  END IF;
  SELECT value = 1 INTO to_system FROM eco.config WHERE key = 'account.sweep_items_to_system';
  -- items (ascending id)
  FOR it IN SELECT id, state FROM eco.item_instances WHERE owner_id = p AND state <> 'revoked' ORDER BY id FOR UPDATE LOOP
    IF to_system THEN
      UPDATE eco.item_instances SET owner_id = eco.system_player(), state = 'owned', locked_by_trade = NULL, version = version + 1 WHERE id = it.id;
      INSERT INTO eco.item_moves(item_id, from_id, to_id, reason, idem_key) VALUES (it.id, p, eco.system_player(), 'account_deleted', ik);
      n_moved := n_moved + 1;
    ELSE
      UPDATE eco.item_instances SET state = 'revoked', locked_by_trade = NULL, version = version + 1 WHERE id = it.id;
      n_revoked := n_revoked + 1;
    END IF;
  END LOOP;
  -- balances (one ledger tx, every non-zero player wallet -> system sink of the same currency)
  FOR w IN SELECT id, currency, purpose, balance FROM eco.wallets WHERE player_id = p AND balance > 0 ORDER BY id LOOP
    IF tx IS NULL THEN tx := eco._tx('account_sweep', ik, 'system'); END IF;
    PERFORM eco._move(tx, w.id, eco._wallet(NULL, w.currency, 'sink:account_closed'), w.currency, w.balance);
    swept := swept || jsonb_build_object(w.currency || ':' || w.purpose, w.balance);
  END LOOP;
  -- personal, mutable data (append-only history stays, pseudonymous)
  DELETE FROM app.saves WHERE player_id = p; GET DIAGNOSTICS n_saves = ROW_COUNT;
  DELETE FROM social.event_members WHERE player_id = p;
  UPDATE social.events SET title = '[supprimé]' WHERE owner_id = p;
  DELETE FROM mod.blocks WHERE player_id = p OR blocked_id = p;
  DELETE FROM prog.privacy_settings WHERE player_id = p;
  UPDATE eco.players SET finalized_at = now() WHERE id = p;
  res := jsonb_build_object('ok', true, 'player', p, 'tx', tx, 'swept', swept, 'items_to_system', n_moved, 'items_revoked', n_revoked,
                            'saves_erased', n_saves, 'requested_at', r.closed_at, 'due_at', r.deletion_due_at);
  INSERT INTO prog.player_events(player_id, type_id, payload, source, ledger_tx) VALUES (p, 'account_finalized', res, 'eco', tx);
  INSERT INTO audit.log(actor, action, target, after, reason, correlation_id)
    VALUES ('system:retention', 'account_finalized', p::text, res, 'grace period over (policy a)', ik);
  RETURN eco._done(ik, res);
END $$;

-- Scheduled entry point: finalises up to p_limit due accounts, each in its own savepoint (one failure does not
-- block the others; it is reported and retried next run).
CREATE FUNCTION eco.finalize_deletions(p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE p uuid; done jsonb := '[]'; failed jsonb := '[]'; r jsonb;
BEGIN
  FOR p IN SELECT id FROM eco.players WHERE closed_at IS NOT NULL AND finalized_at IS NULL AND deletion_due_at <= now()
           ORDER BY deletion_due_at, id LIMIT least(greatest(p_limit, 1), 500) LOOP
    BEGIN
      r := eco._finalize_account(p);
      IF (r->>'ok')::boolean THEN done := done || jsonb_build_array(p); END IF;
    EXCEPTION WHEN OTHERS THEN
      failed := failed || jsonb_build_array(jsonb_build_object('player', p, 'error', SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'finalized', done, 'failed', failed);
END $$;

-- Auth-side erasure bookkeeping (the Worker anonymises auth."user" with role app_auth, then marks it here).
CREATE FUNCTION eco.pending_auth_erasure(p_limit int DEFAULT 100) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(id), '[]') FROM (SELECT id FROM eco.players WHERE finalized_at IS NOT NULL AND auth_erased_at IS NULL
    ORDER BY finalized_at LIMIT least(greatest(p_limit, 1), 500)) z $$;
CREATE FUNCTION eco.mark_auth_erased(p uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE eco.players SET auth_erased_at = now() WHERE id = p AND finalized_at IS NOT NULL AND auth_erased_at IS NULL;
  IF FOUND THEN
    INSERT INTO audit.log(actor, action, target, reason) VALUES ('system:retention', 'account_auth_erased', p::text, 'auth identity anonymised');
  END IF;
  RETURN jsonb_build_object('ok', true, 'marked', FOUND);
END $$;

REVOKE ALL ON FUNCTION eco.restore_account(text, uuid), eco._finalize_account(uuid), eco.finalize_deletions(int),
  eco.pending_auth_erasure(int), eco.mark_auth_erased(uuid), eco.system_player() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eco.restore_account(text, uuid), eco.finalize_deletions(int), eco.pending_auth_erasure(int),
  eco.mark_auth_erased(uuid) TO app_api;
RESET ROLE;
