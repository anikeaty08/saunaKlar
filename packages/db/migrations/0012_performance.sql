-- 0012 Query performance at design scale (500 resellers, ~1M customers, ~1M configurations).
-- Measured with tools/perf (seed-scale.ts + run.ts); before/after timings are in the PR notes.
--
-- Keyset pagination: every list orders by (timestamp DESC, id DESC) and pages with a row
-- comparison on the same pair, so each index ends in the same two columns. The narrower
-- indexes they replace are strict prefixes and served nothing else.
--
-- At real scale build these with CREATE INDEX CONCURRENTLY outside the migration
-- transaction first; the IF NOT EXISTS / IF EXISTS below then make this file a no-op.

-- Admin configuration list: reseller_id = $1 ORDER BY updated_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS configurations_reseller_updated_idx
  ON configurations (reseller_id, updated_at DESC, id DESC);

-- Customer's own configuration list (same order). Also serves the per-customer counts and the
-- "owns no data" check of delete_expired_pending_customers().
CREATE INDEX IF NOT EXISTS configurations_customer_updated_idx
  ON configurations (customer_id, updated_at DESC, id DESC) WHERE customer_id IS NOT NULL;
DROP INDEX IF EXISTS configurations_customer_idx;

-- Request lists: by created_at, optionally per status.
CREATE INDEX IF NOT EXISTS configuration_requests_reseller_created_id_idx
  ON configuration_requests (reseller_id, created_at DESC, id DESC);
DROP INDEX IF EXISTS configuration_requests_reseller_created_idx;
CREATE INDEX IF NOT EXISTS configuration_requests_reseller_status_created_idx
  ON configuration_requests (reseller_id, status_code, created_at DESC, id DESC);
DROP INDEX IF EXISTS configuration_requests_reseller_status_idx;

-- Admin customer list.
CREATE INDEX IF NOT EXISTS customers_reseller_created_id_idx
  ON customers (reseller_id, created_at DESC, id DESC);
DROP INDEX IF EXISTS customers_reseller_created_idx;

-- Active-customer counts (analytics, manufacturer overview) as index-only scans.
CREATE INDEX IF NOT EXISTS customers_reseller_active_idx
  ON customers (reseller_id, created_at) WHERE status = 'ACTIVE';

-- reseller_stats(): same signature and result, but the time window is now sargable.
-- `p_since IS NULL OR x.created_at >= p_since` cannot use an index in the generic plan a
-- non-inlined SQL function gets, so every call counted every row of the reseller.
CREATE OR REPLACE FUNCTION reseller_stats(p_reseller_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS TABLE (
  reseller_id uuid, customers bigint, configurations bigint, locked_configurations bigint,
  share_links bigint, share_link_views bigint, requests bigint, requests_open bigint, requests_accepted bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id,
    (SELECT count(*) FROM customers c WHERE c.reseller_id = r.id AND c.status = 'ACTIVE'
       AND c.created_at >= coalesce(p_since, '-infinity')),
    (SELECT count(*) FROM configurations c WHERE c.reseller_id = r.id AND c.created_at >= coalesce(p_since, '-infinity')),
    (SELECT count(*) FROM configurations c WHERE c.reseller_id = r.id AND c.locked_at IS NOT NULL
       AND c.created_at >= coalesce(p_since, '-infinity')),
    (SELECT count(*) FROM share_links s WHERE s.reseller_id = r.id AND s.created_at >= coalesce(p_since, '-infinity')),
    (SELECT count(*) FROM share_link_views v WHERE v.reseller_id = r.id AND v.viewed_at >= coalesce(p_since, '-infinity')),
    (SELECT count(*) FROM configuration_requests q WHERE q.reseller_id = r.id AND q.created_at >= coalesce(p_since, '-infinity')),
    (SELECT count(*) FROM configuration_requests q JOIN request_statuses st ON st.code = q.status_code
       WHERE q.reseller_id = r.id AND NOT st.is_terminal AND q.created_at >= coalesce(p_since, '-infinity')),
    (SELECT count(*) FROM configuration_requests q WHERE q.reseller_id = r.id AND q.status_code IN ('ACCEPTED', 'CLOSED')
       AND q.created_at >= coalesce(p_since, '-infinity'))
  FROM resellers r
  WHERE p_reseller_id IS NULL OR r.id = p_reseller_id
  ORDER BY r.slug
$$;

-- The manufacturer's reseller list needs two of the nine counts; reseller_stats() computed all
-- nine (over every configuration and share-link view) for each of the 500 resellers.
CREATE FUNCTION reseller_overview(p_manufacturer_id uuid, p_reseller_id uuid DEFAULT NULL)
RETURNS TABLE (reseller_id uuid, customers bigint, requests_open bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id,
    (SELECT count(*) FROM customers c WHERE c.reseller_id = r.id AND c.status = 'ACTIVE'),
    (SELECT count(*) FROM configuration_requests q
      WHERE q.reseller_id = r.id
        AND q.status_code IN (SELECT st.code FROM request_statuses st WHERE NOT st.is_terminal))
  FROM resellers r
  WHERE r.manufacturer_id = p_manufacturer_id AND (p_reseller_id IS NULL OR r.id = p_reseller_id)
$$;
REVOKE ALL ON FUNCTION reseller_overview(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reseller_overview(uuid, uuid) TO app_platform;
