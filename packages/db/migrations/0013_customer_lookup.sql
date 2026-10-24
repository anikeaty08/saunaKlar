-- 0013 Customer e-mail lookup and customer search that can use an index under RLS.
--
-- Under row-level security Postgres only uses a user condition as an index condition when
-- every function in it is LEAKPROOF. lower() and ILIKE are not, so `lower(email) = lower($1)`
-- and `email ILIKE '%…%'` filtered every customer of the reseller row by row (tools/perf: about
-- 11 ms and 30 ms at a reseller with 20k customers), and a pg_trgm index was never used.

-- ---------------------------------------------------------------------------------------------
-- Login / sign-up lookup: compare a stored lower-case copy with plain text equality (leakproof),
-- so `email_lower = lower($1)` is an index condition as app_tenant.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN email_lower text GENERATED ALWAYS AS (lower(email)) STORED;

-- Same uniqueness as before, on the stored column. The name is kept: the API maps unique
-- violations by constraint name (packages/db/src/errors.ts).
DROP INDEX customers_reseller_email_key;
CREATE UNIQUE INDEX customers_reseller_email_key ON customers (reseller_id, email_lower) WHERE status <> 'ANONYMISED';

-- ---------------------------------------------------------------------------------------------
-- Customer search (admin customer list, request search).
-- ---------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- One trigram index over everything the search matches. coalesce() keeps a customer without a
-- name searchable by e-mail (a NULL name would make the whole expression NULL).
CREATE INDEX customers_search_trgm_idx ON customers
  USING gin ((email || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

-- Ids of the current tenant's customers matching p_query (a plain substring, case-insensitive),
-- newest first, at most p_limit (NULL: all), strictly after the keyset cursor
-- (p_before_at, p_before_id) when one is given.
--
-- SECURITY DEFINER so the trigram index can be used; it re-applies the customers policy itself:
-- p_reseller_id must be the session's tenant (app.reseller_id), and a customer session
-- (app.actor_customer_id set) only ever finds itself. It returns ids only; the caller reads the
-- rows through its own RLS.
CREATE FUNCTION search_customer_ids(p_reseller_id uuid, p_query text, p_limit int,
                                    p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
ROWS 100
AS $$
DECLARE
  v_pattern text;
BEGIN
  IF p_reseller_id IS NULL OR p_reseller_id IS DISTINCT FROM app_reseller_id() THEN
    RAISE EXCEPTION 'search_customer_ids: not the current tenant' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 1 THEN
    RAISE EXCEPTION 'p_limit must be at least 1' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NULL OR p_query = '' THEN
    RETURN;
  END IF;
  -- Substring match: escape the LIKE metacharacters of the query.
  v_pattern := '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- Dynamic so every call is planned with its pattern: a long, rare term uses the trigram index,
  -- a short or common one walks customers_reseller_created_id_idx and stops at p_limit.
  -- The second condition keeps the old semantics (e-mail or "first last" contains the term);
  -- the indexed concatenation alone would also match across the field boundaries.
  RETURN QUERY EXECUTE
    $q$SELECT c.id FROM customers c
        WHERE c.reseller_id = $1
          AND (c.email || ' ' || coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ILIKE $2
          AND (c.email ILIKE $2 OR (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ILIKE $2)
          AND (app_actor_customer_id() IS NULL OR c.id = app_actor_customer_id())
          AND ($4::timestamptz IS NULL OR (c.created_at, c.id) < ($4, $5))
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $3$q$
    USING p_reseller_id, v_pattern, p_limit, p_before_at, p_before_id;
END
$$;
REVOKE ALL ON FUNCTION search_customer_ids(uuid, text, int, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customer_ids(uuid, text, int, timestamptz, uuid) TO app_tenant;
