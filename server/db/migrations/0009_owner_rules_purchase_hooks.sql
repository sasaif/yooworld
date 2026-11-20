-- 0009_owner_rules_purchase_hooks
-- (1) Owner decision 2026-11-20 (Alessandro): NO hold on Diamond-bought items. The key and the hold mechanism stay;
--     the default becomes 0 with status owner_rule. Diamond-bought items are tradable immediately.
-- (2) Lightweight hooks for a FUTURE chargeback/refund handler (not built in Phase B): every purchase is recorded
--     with the buyer's account age at purchase time; eco.account_age_days() exposes account age.
SET LOCAL ROLE eco_owner;
UPDATE eco.config SET value = 0, status = 'owner_rule',
  note = 'security hold on Diamond-bought items before trade/gift, in days. Owner rule 2026-11-20: 0 = no hold (tradable immediately). Mechanism kept.'
 WHERE key = 'item.diamond_hold_days';

CREATE FUNCTION eco.account_age_days(p uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT round(extract(epoch FROM now() - created_at) / 86400.0, 3) FROM eco.players WHERE id = p $$;

CREATE TABLE eco.purchase_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id        uuid NOT NULL REFERENCES eco.players(id),
  kind             text NOT NULL CHECK (kind IN ('shop','iap')),
  currency         text NOT NULL,             -- GOLD_TEST / DIAMOND_TEST outside prod; for iap: the Diamond currency granted
  amount           bigint NOT NULL CHECK (amount > 0),
  item_id          uuid,                      -- shop purchases: the item instance created
  item_def         text,
  ledger_tx        bigint REFERENCES eco.ledger_tx(id),
  external_ref     text,                      -- iap: store transaction id (future)
  account_age_days numeric NOT NULL,          -- buyer account age at purchase time
  at               timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON eco.purchase_events(player_id, at);
CREATE INDEX ON eco.purchase_events(item_id);
CREATE TRIGGER ao_pev   BEFORE UPDATE OR DELETE ON eco.purchase_events FOR EACH STATEMENT EXECUTE FUNCTION eco.trg_append_only();
CREATE TRIGGER ao_pev_t BEFORE TRUNCATE ON eco.purchase_events EXECUTE FUNCTION eco.trg_append_only();

-- Internal helper (not granted): shop_buy calls it now; a future iap_grant will call it with kind 'iap'.
CREATE FUNCTION eco._purchase_event(p uuid, k text, cur text, amt bigint, item uuid, def text, tx bigint, ref text) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO eco.purchase_events(player_id, kind, currency, amount, item_id, item_def, ledger_tx, external_ref, account_age_days)
  VALUES (p, k, cur, amt, item, def, tx, ref, coalesce(eco.account_age_days(p), 0)) $$;

-- Hook: purchase events are written by an AFTER INSERT trigger on item provenance (reason 'shop'), so the audited
-- shop_buy body from 0003 stays unchanged.
CREATE FUNCTION eco.trg_shop_purchase_event() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE it eco.item_instances; tx bigint; e record;
BEGIN
  IF NEW.reason <> 'shop' THEN RETURN NULL; END IF;
  SELECT * INTO it FROM eco.item_instances WHERE id = NEW.item_id;
  SELECT id INTO tx FROM eco.ledger_tx WHERE idem_key = NEW.idem_key;
  SELECT currency, -amount AS amt INTO e FROM eco.ledger_entries WHERE tx_id = tx AND amount < 0 LIMIT 1;
  PERFORM eco._purchase_event(NEW.to_id, 'shop', e.currency, e.amt, it.id, it.def_id, tx, NULL);
  RETURN NULL;
END $$;
CREATE TRIGGER purchase_event AFTER INSERT ON eco.item_moves FOR EACH ROW EXECUTE FUNCTION eco.trg_shop_purchase_event();

REVOKE ALL ON FUNCTION eco.account_age_days(uuid), eco._purchase_event(uuid,text,text,bigint,uuid,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eco.account_age_days(uuid) TO app_api, admin_ops, reporting_ro;
GRANT SELECT ON eco.purchase_events TO reporting_ro;
RESET ROLE;
