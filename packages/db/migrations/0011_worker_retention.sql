-- 0011 Batched retention for the worker (small transactions, safe to run concurrently).

-- Deletes up to p_limit rows older than p_cutoff from an allow-listed append-only table.
CREATE FUNCTION retention_delete_batch(p_table text, p_cutoff timestamptz, p_limit int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_col text;
  n     int;
BEGIN
  v_col := CASE p_table WHEN 'share_link_views' THEN 'viewed_at' WHEN 'audit_events' THEN 'occurred_at' END;
  IF v_col IS NULL THEN
    PERFORM raise_rule('RETENTION_TABLE_NOT_ALLOWED', format('retention is not allowed on %s', p_table));
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100000' USING ERRCODE = '22023';
  END IF;
  -- Table and column come from the allow-list above, never from the caller verbatim.
  EXECUTE format(
    'DELETE FROM %1$I WHERE id IN (SELECT id FROM %1$I WHERE %2$I < $1 ORDER BY %2$I LIMIT $2 FOR UPDATE SKIP LOCKED)',
    p_table, v_col)
  USING p_cutoff, p_limit;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Deletes unconfirmed sign-ups older than p_cutoff that own no data (review G3) and returns
-- them, so the worker can delete the matching IdP users (sub = customers.id).
CREATE FUNCTION delete_expired_pending_customers(p_cutoff timestamptz, p_limit int)
RETURNS TABLE (id uuid, reseller_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100000' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  DELETE FROM customers c
  WHERE c.id IN (
    SELECT p.id FROM customers p
    WHERE p.status = 'PENDING' AND p.created_at < p_cutoff
      AND NOT EXISTS (SELECT 1 FROM configurations x WHERE x.customer_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM share_links s WHERE s.created_by_customer_id = p.id)
    ORDER BY p.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED)
  RETURNING c.id, c.reseller_id;
END
$$;

REVOKE ALL ON FUNCTION retention_delete_batch(text, timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_expired_pending_customers(timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_delete_batch(text, timestamptz, int) TO app_worker;
GRANT EXECUTE ON FUNCTION delete_expired_pending_customers(timestamptz, int) TO app_worker;
