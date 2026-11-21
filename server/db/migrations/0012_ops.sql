-- 0012_ops — metrics + alerts sink (Phase B: local; the same tables serve uat/prod until a real sink is chosen).
-- Writers go through SECURITY DEFINER functions only (app_api cannot touch the tables). Alerts are deduplicated:
-- one OPEN row per (kind, subject); repeats bump count/last_seen; resolve closes it. Metrics are append-only samples.
CREATE SCHEMA ops AUTHORIZATION eco_owner;
SET LOCAL ROLE eco_owner;

CREATE TABLE ops.metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_.]{1,63}$'),
  value double precision NOT NULL CHECK (value = value AND value BETWEEN -1e15 AND 1e15),   -- no NaN / inf
  tags jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(tags) = 'object' AND length(tags::text) <= 512)
);
CREATE INDEX metrics_name_at ON ops.metrics(name, at);

CREATE TABLE ops.alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.]{1,63}$'),
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 200),
  severity text NOT NULL CHECK (severity IN ('info','warn','critical')),
  detail jsonb NOT NULL DEFAULT '{}' CHECK (length(detail::text) <= 4096),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  count int NOT NULL DEFAULT 1,
  resolved_at timestamptz
);
CREATE UNIQUE INDEX alerts_open_once ON ops.alerts(kind, subject) WHERE resolved_at IS NULL;

-- Batch ingest from the Worker buffer: [{name, value, tags?, at?(ms)}], max 500 per call.
CREATE FUNCTION ops.ingest(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE n int;
BEGIN
  IF jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_batch');
  END IF;
  INSERT INTO ops.metrics(at, name, value, tags)
  SELECT COALESCE(to_timestamp((m->>'at')::double precision / 1000), now()), m->>'name', (m->>'value')::double precision,
         COALESCE(m->'tags', '{}')
  FROM jsonb_array_elements(p) m;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'stored', n);
EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok', false, 'code', 'bad_metric');
END $$;

CREATE FUNCTION ops.raise_alert(p_kind text, p_subject text, p_severity text, p_detail jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r ops.alerts;
BEGIN
  INSERT INTO ops.alerts(kind, subject, severity, detail) VALUES (p_kind, COALESCE(p_subject, ''), p_severity, COALESCE(p_detail, '{}'))
  ON CONFLICT (kind, subject) WHERE resolved_at IS NULL
  DO UPDATE SET count = ops.alerts.count + 1, last_seen = now(), detail = excluded.detail,
                severity = CASE WHEN excluded.severity = 'critical' OR ops.alerts.severity = 'critical' THEN 'critical'
                                WHEN excluded.severity = 'warn' OR ops.alerts.severity = 'warn' THEN 'warn' ELSE 'info' END
  RETURNING * INTO r;
  RETURN jsonb_build_object('ok', true, 'id', r.id, 'count', r.count, 'new', r.count = 1);
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('ok', false, 'code', 'bad_alert');
END $$;

CREATE FUNCTION ops.resolve_alert(p_kind text, p_subject text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH u AS (UPDATE ops.alerts SET resolved_at = now() WHERE kind = p_kind AND subject = COALESCE(p_subject, '') AND resolved_at IS NULL RETURNING 1)
  SELECT jsonb_build_object('ok', true, 'resolved', (SELECT count(*) FROM u)) $$;

-- Reconciliation check: runs eco.recon_summary(); any non-zero counter -> one critical alert per counter; zero -> resolves.
CREATE FUNCTION ops.recon_check() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s jsonb := eco.recon_summary(); k text; v bigint; bad jsonb := '{}';
BEGIN
  FOR k, v IN SELECT key, value::bigint FROM jsonb_each_text(s) LOOP
    IF v <> 0 THEN
      bad := bad || jsonb_build_object(k, v);
      PERFORM ops.raise_alert('recon', k, 'critical', jsonb_build_object('count', v));
    ELSE
      PERFORM ops.resolve_alert('recon', k);
    END IF;
  END LOOP;
  INSERT INTO ops.metrics(name, value, tags) VALUES ('recon.problems', (SELECT COALESCE(sum(value::bigint), 0) FROM jsonb_each_text(bad)), '{}');
  RETURN jsonb_build_object('ok', true, 'clean', bad = '{}', 'problems', bad);
END $$;

CREATE FUNCTION ops.open_alerts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'subject', subject, 'severity', severity, 'count', count,
    'detail', detail, 'first_seen', first_seen, 'last_seen', last_seen) ORDER BY id), '[]')
  FROM ops.alerts WHERE resolved_at IS NULL $$;

CREATE VIEW ops.metrics_hourly AS
  SELECT date_trunc('hour', at) AS hour, name, count(*) AS n, avg(value) AS avg, max(value) AS max, sum(value) AS sum
  FROM ops.metrics GROUP BY 1, 2;

REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ops FROM PUBLIC;
GRANT USAGE ON SCHEMA ops TO app_api, reporting_ro;
GRANT EXECUTE ON FUNCTION ops.ingest(jsonb), ops.raise_alert(text, text, text, jsonb), ops.resolve_alert(text, text),
  ops.recon_check(), ops.open_alerts() TO app_api;
GRANT SELECT ON ops.metrics, ops.alerts, ops.metrics_hourly TO reporting_ro;
GRANT EXECUTE ON FUNCTION ops.open_alerts() TO reporting_ro;
RESET ROLE;
