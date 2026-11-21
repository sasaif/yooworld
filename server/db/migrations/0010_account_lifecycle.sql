-- 0010_account_lifecycle — self-service account deletion (economy side) and personal-data export.
-- Deletion = CLOSE + ANONYMISE, never a hard delete: the ledger, item provenance, gifts, trades, purchase events and
-- the audit log are append-only and stay intact (they reference only the opaque player uuid). What happens to the
-- remaining wallet balance and items is a PRODUCT POLICY not decided here: by default they are FROZEN in place
-- (no ledger write). See README "Account deletion" for the options proposed to the owner.
SET LOCAL ROLE eco_owner;

ALTER TABLE eco.players ADD COLUMN closed_at timestamptz;
INSERT INTO prog.event_types VALUES ('account_closed', 1, false, 'player closed their account (self-service deletion)');

-- Every economy operation resolves players through eco._player: a closed account can no longer act or receive.
CREATE OR REPLACE FUNCTION eco._player(p uuid) RETURNS eco.players LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE r eco.players;
BEGIN
  SELECT * INTO r FROM eco.players WHERE id = p;
  IF r.id IS NULL THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  IF r.closed_at IS NOT NULL THEN PERFORM eco._err('account_closed', 'account closed'); END IF;
  RETURN r;
END $$;

CREATE FUNCTION eco.close_account(p_key text, p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ik text := eco._ikey('close_account', p_player, p_key); prev jsonb; r eco.players; t record; n_tr int := 0;
        bal jsonb; n_items int; n_saves int; res jsonb;
BEGIN
  prev := eco._claim(ik, p_key, p_player, 'close_account', md5(p_player::text)); IF prev IS NOT NULL THEN RETURN prev; END IF;
  SELECT * INTO r FROM eco.players WHERE id = p_player FOR UPDATE;
  IF r.id IS NULL THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  IF r.closed_at IS NOT NULL THEN RETURN eco._done(ik, jsonb_build_object('ok', true, 'already_closed', true)); END IF;
  -- open trades are cancelled (items and escrowed Gold go back to their owners, through the normal ledger path)
  FOR t IN SELECT id FROM eco.trades WHERE status = 'locked' AND p_player IN (a_id, b_id) ORDER BY id LOOP
    PERFORM eco._trade_close('close-' || t.id, t.id, p_player, false); n_tr := n_tr + 1;
  END LOOP;
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
END $$;

-- Personal-data export (the player's OWN rows). Other players appear only as opaque uuids; moderation reviewer /
-- issuer ids and secrets are never included.
CREATE FUNCTION eco.export_player(p uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE out jsonb := '{}'; q record; v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM eco.players WHERE id = p) THEN PERFORM eco._err('unknown_player', 'unknown player'); END IF;
  FOR q IN SELECT * FROM (VALUES
    ('player',            'SELECT to_jsonb(t) FROM eco.players t WHERE id = $1'),
    ('wallets',           'SELECT jsonb_build_object(''currency'', currency, ''purpose'', purpose, ''balance'', balance) FROM eco.wallets t WHERE player_id = $1'),
    ('ledger',            'SELECT jsonb_build_object(''tx'', e.tx_id, ''op'', x.op_type, ''at'', x.created_at, ''currency'', e.currency, ''amount'', e.amount, ''balance_after'', e.balance_after, ''wallet'', w.purpose) FROM eco.ledger_entries e JOIN eco.wallets w ON w.id = e.wallet_id JOIN eco.ledger_tx x ON x.id = e.tx_id WHERE w.player_id = $1'),
    ('items',             'SELECT to_jsonb(t) FROM eco.item_instances t WHERE owner_id = $1'),
    ('item_moves',        'SELECT to_jsonb(t) - ''idem_key'' FROM eco.item_moves t WHERE from_id = $1 OR to_id = $1'),
    ('gifts',             'SELECT to_jsonb(t) - ''idem_key'' FROM eco.gifts t WHERE from_id = $1 OR to_id = $1'),
    ('purchases',         'SELECT to_jsonb(t) FROM eco.purchase_events t WHERE player_id = $1'),
    ('reward_claims',     'SELECT to_jsonb(t) FROM eco.reward_claims t WHERE player_id = $1'),
    ('activity_sessions', 'SELECT to_jsonb(t) FROM eco.activity_sessions t WHERE player_id = $1'),
    ('trades',            'SELECT to_jsonb(t) || jsonb_build_object(''lines'', (SELECT coalesce(jsonb_agg(to_jsonb(l)), ''[]'') FROM eco.trade_lines l WHERE l.trade_id = t.id)) FROM eco.trades t WHERE a_id = $1 OR b_id = $1'),
    ('entitlements',      'SELECT to_jsonb(t) FROM eco.entitlements t WHERE player_id = $1'),
    ('saves',             'SELECT to_jsonb(t) FROM app.saves t WHERE player_id = $1'),
    ('events_owned',      'SELECT to_jsonb(t) FROM social.events t WHERE owner_id = $1'),
    ('event_memberships', 'SELECT to_jsonb(t) FROM social.event_members t WHERE player_id = $1'),
    ('event_bans',        'SELECT to_jsonb(t) - ''kicked_by'' FROM social.event_bans t WHERE player_id = $1'),
    ('event_kicks',       'SELECT to_jsonb(t) - ''kicked_by'' FROM social.event_kicks t WHERE player_id = $1'),
    ('player_events',     'SELECT to_jsonb(t) FROM prog.player_events t WHERE player_id = $1'),
    ('career_progress',   'SELECT to_jsonb(t) FROM prog.career_progress t WHERE player_id = $1'),
    ('xp_grants',         'SELECT to_jsonb(t) FROM prog.xp_grants t WHERE player_id = $1'),
    ('badges',            'SELECT to_jsonb(t) FROM prog.player_badges t WHERE player_id = $1'),
    ('prestige',          'SELECT to_jsonb(t) FROM prog.prestige_grants t WHERE player_id = $1'),
    ('privacy',           'SELECT to_jsonb(t) FROM prog.privacy_settings t WHERE player_id = $1'),
    ('match_results',     'SELECT to_jsonb(t) FROM prog.match_results t WHERE $1 = ANY (players)'),
    ('blocks',            'SELECT to_jsonb(t) FROM mod.blocks t WHERE player_id = $1'),
    ('reports_filed',     'SELECT to_jsonb(t) - ''reviewer'' FROM mod.reports t WHERE reporter_id = $1'),
    ('sanctions',         'SELECT to_jsonb(t) - ''issued_by'' FROM mod.sanctions t WHERE player_id = $1')
  ) AS s(k, sql) LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(z.j), ''[]''::jsonb) FROM (%s) AS z(j)', q.sql) INTO v USING p;
    out := out || jsonb_build_object(q.k, CASE WHEN q.k IN ('player','privacy') THEN v->0 ELSE v END);
  END LOOP;
  RETURN jsonb_build_object('format', 'yoland-export/1', 'generated_at', now(), 'env', eco.env_tag(), 'data', out);
END $$;

REVOKE ALL ON FUNCTION eco.close_account(text, uuid), eco.export_player(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eco.close_account(text, uuid), eco.export_player(uuid) TO app_api;
RESET ROLE;
