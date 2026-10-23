-- 0008 Rule 9 (catalog_version bumps), rule 10 (TENANT_SYNC outbox), rule 11 (audit trail).

-- =============================================================================================
-- Rule 9. Statement-level triggers with transition tables bump each affected reseller once per
-- statement (an import touching 10 000 rows issues one UPDATE, not 10 000).
--   TG_ARGV[0] = how a row maps to resellers:
--     reseller        rows carry reseller_id                        (key column = TG_ARGV[1])
--     model           resellers offering the model                  (key column = model id)
--     model_currency  resellers offering the model in that currency (sauna_model_id, currency_code)
--     option          resellers offering a model that offers the option
--     option_group    resellers offering a model that exposes the group
--     room            resellers offering the room scene
-- =============================================================================================
CREATE FUNCTION bump_catalog_versions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode text := TG_ARGV[0];
  v_col  text := TG_ARGV[1];
  v_rows text;
  v_ids  text;
BEGIN
  -- Rows of this statement (transition tables are visible to EXECUTE).
  v_rows := CASE TG_OP
    WHEN 'INSERT' THEN 'SELECT * FROM new_rows'
    WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
    ELSE 'SELECT * FROM new_rows UNION ALL SELECT * FROM old_rows'
  END;

  v_ids := CASE v_mode
    WHEN 'reseller' THEN
      format('SELECT %I FROM (%s) t', v_col, v_rows)
    WHEN 'model' THEN
      format('SELECT rs.reseller_id FROM reseller_saunas rs WHERE rs.sauna_model_id IN (SELECT %I FROM (%s) t)', v_col, v_rows)
    WHEN 'model_currency' THEN
      format('SELECT rs.reseller_id FROM reseller_saunas rs JOIN resellers r ON r.id = rs.reseller_id
              JOIN (%s) t ON t.sauna_model_id = rs.sauna_model_id AND t.currency_code = r.currency_code', v_rows)
    WHEN 'option' THEN
      format('SELECT rs.reseller_id FROM reseller_saunas rs JOIN sauna_model_options smo ON smo.sauna_model_id = rs.sauna_model_id
              WHERE smo.option_id IN (SELECT %I FROM (%s) t)', v_col, v_rows)
    WHEN 'option_group' THEN
      format('SELECT rs.reseller_id FROM reseller_saunas rs JOIN sauna_model_option_groups g ON g.sauna_model_id = rs.sauna_model_id
              WHERE g.option_group_id IN (SELECT %I FROM (%s) t)', v_col, v_rows)
    WHEN 'room' THEN
      format('SELECT rr.reseller_id FROM reseller_room_scenes rr WHERE rr.room_scene_id IN (SELECT %I FROM (%s) t)', v_col, v_rows)
  END;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'bump_catalog_versions: unknown mode %', v_mode;
  END IF;

  EXECUTE format('UPDATE resellers SET catalog_version = catalog_version + 1 WHERE id IN (%s)', v_ids);
  RETURN NULL;
END
$$;

-- Creates the three statement triggers (INSERT/UPDATE/DELETE need separate triggers when they
-- reference transition tables).
CREATE FUNCTION pg_temp.add_bump_triggers(p_table text, p_mode text, p_col text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows
                  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_versions(%L, %L)',
                 p_table || '_bump_ins', p_table, p_mode, p_col);
  EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
                  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_versions(%L, %L)',
                 p_table || '_bump_upd', p_table, p_mode, p_col);
  EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows
                  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_versions(%L, %L)',
                 p_table || '_bump_del', p_table, p_mode, p_col);
END
$$;

-- Prices and option prices: only resellers selling in that currency.
SELECT pg_temp.add_bump_triggers('sauna_model_prices', 'model_currency', '');
SELECT pg_temp.add_bump_triggers('sauna_model_option_prices', 'model_currency', '');
-- Reseller-owned catalog settings.
SELECT pg_temp.add_bump_triggers('reseller_saunas', 'reseller', 'reseller_id');
SELECT pg_temp.add_bump_triggers('reseller_sauna_discounts', 'reseller', 'reseller_id');
SELECT pg_temp.add_bump_triggers('reseller_default_discounts', 'reseller', 'reseller_id');
SELECT pg_temp.add_bump_triggers('reseller_branding', 'reseller', 'reseller_id');
SELECT pg_temp.add_bump_triggers('reseller_room_scenes', 'reseller', 'reseller_id');
-- Catalog content shown in the storefront.
SELECT pg_temp.add_bump_triggers('sauna_models', 'model', 'id');
SELECT pg_temp.add_bump_triggers('sauna_model_translations', 'model', 'sauna_model_id');
SELECT pg_temp.add_bump_triggers('sauna_model_attributes', 'model', 'sauna_model_id');
SELECT pg_temp.add_bump_triggers('sauna_model_option_groups', 'model', 'sauna_model_id');
SELECT pg_temp.add_bump_triggers('sauna_model_options', 'model', 'sauna_model_id');
SELECT pg_temp.add_bump_triggers('option_requires', 'model', 'sauna_model_id');
SELECT pg_temp.add_bump_triggers('option_excludes', 'model', 'sauna_model_id');
SELECT pg_temp.add_bump_triggers('sauna_model_assets', 'model', 'sauna_model_id');
SELECT pg_temp.add_bump_triggers('options', 'option', 'id');
SELECT pg_temp.add_bump_triggers('option_translations', 'option', 'option_id');
SELECT pg_temp.add_bump_triggers('option_assets', 'option', 'option_id');
SELECT pg_temp.add_bump_triggers('option_groups', 'option_group', 'id');
SELECT pg_temp.add_bump_triggers('option_group_translations', 'option_group', 'option_group_id');
SELECT pg_temp.add_bump_triggers('room_scenes', 'room', 'id');
SELECT pg_temp.add_bump_triggers('room_scene_translations', 'room', 'room_scene_id');
SELECT pg_temp.add_bump_triggers('room_scene_assets', 'room', 'room_scene_id');
DROP FUNCTION pg_temp.add_bump_triggers(text, text, text);

-- Imports (catalog_admin) may also bump everyone explicitly, e.g. after attribute dictionary changes.
CREATE FUNCTION bump_all_catalog_versions() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  n bigint;
BEGIN
  UPDATE resellers SET catalog_version = catalog_version + 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- =============================================================================================
-- Rule 10. Reseller created, or its status or slug changed -> TENANT_SYNC for the edge
-- KeyValueStore (worker). Payload: {resellerId, slug, previousSlug, status}.
-- =============================================================================================
CREATE FUNCTION resellers_tenant_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO notification_outbox (reseller_id, event_type, payload)
  VALUES (NEW.id, 'TENANT_SYNC', jsonb_build_object(
    'resellerId', NEW.id,
    'slug', NEW.slug,
    'previousSlug', CASE WHEN TG_OP = 'UPDATE' AND OLD.slug <> NEW.slug THEN OLD.slug END,
    'status', NEW.status));
  RETURN NULL;
END
$$;
CREATE TRIGGER resellers_tenant_sync_insert AFTER INSERT ON resellers
  FOR EACH ROW EXECUTE FUNCTION resellers_tenant_sync();
CREATE TRIGGER resellers_tenant_sync_update AFTER UPDATE OF status, slug ON resellers
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.slug IS DISTINCT FROM NEW.slug)
  EXECUTE FUNCTION resellers_tenant_sync();

-- =============================================================================================
-- Rule 11. Audit trail for prices, option prices, discounts, assignments, reseller status and
-- request status. TG_ARGV[0] = key columns (comma separated) forming entity_id;
-- TG_ARGV[1] = columns copied into details ('*' = whole row). Request messages and other free
-- text never reach the audit trail.
-- details = {"old": {...} | null, "new": {...} | null}; action = '<table>.<insert|update|delete>'.
-- =============================================================================================
CREATE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_keys  text[] := string_to_array(TG_ARGV[0], ',');
  v_cols  text[] := string_to_array(TG_ARGV[1], ',');
  v_old   jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new   jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row   jsonb := coalesce(v_new, v_old);
  v_res   uuid;
BEGIN
  IF TG_ARGV[1] <> '*' THEN
    v_old := (SELECT jsonb_object_agg(key, value) FROM jsonb_each(v_old) WHERE key = ANY (v_cols));
    v_new := (SELECT jsonb_object_agg(key, value) FROM jsonb_each(v_new) WHERE key = ANY (v_cols));
  ELSE
    v_old := v_old - 'created_at' - 'updated_at';
    v_new := v_new - 'created_at' - 'updated_at';
  END IF;
  v_res := CASE WHEN TG_TABLE_NAME = 'resellers' THEN (v_row ->> 'id')::uuid ELSE (v_row ->> 'reseller_id')::uuid END;

  INSERT INTO audit_events (reseller_id, actor_staff_id, actor_customer_id, action, entity_type, entity_id, details)
  VALUES (
    v_res, app_actor_staff_id(), app_actor_customer_id(),
    TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
    (SELECT string_agg(v_row ->> k, ':' ORDER BY ord) FROM unnest(v_keys) WITH ORDINALITY AS u(k, ord)),
    jsonb_build_object('old', v_old, 'new', v_new));
  RETURN NULL;
END
$$;

CREATE TRIGGER sauna_model_prices_audit AFTER INSERT OR UPDATE OR DELETE ON sauna_model_prices
  FOR EACH ROW EXECUTE FUNCTION audit_row('sauna_model_id,currency_code', '*');
CREATE TRIGGER sauna_model_option_prices_audit AFTER INSERT OR UPDATE OR DELETE ON sauna_model_option_prices
  FOR EACH ROW EXECUTE FUNCTION audit_row('sauna_model_id,option_id,currency_code', '*');
CREATE TRIGGER reseller_sauna_discounts_audit AFTER INSERT OR UPDATE OR DELETE ON reseller_sauna_discounts
  FOR EACH ROW EXECUTE FUNCTION audit_row('reseller_id,sauna_model_id', '*');
CREATE TRIGGER reseller_default_discounts_audit AFTER INSERT OR UPDATE OR DELETE ON reseller_default_discounts
  FOR EACH ROW EXECUTE FUNCTION audit_row('reseller_id', '*');
CREATE TRIGGER reseller_saunas_audit AFTER INSERT OR UPDATE OR DELETE ON reseller_saunas
  FOR EACH ROW EXECUTE FUNCTION audit_row('reseller_id,sauna_model_id', '*');
CREATE TRIGGER reseller_room_scenes_audit AFTER INSERT OR UPDATE OR DELETE ON reseller_room_scenes
  FOR EACH ROW EXECUTE FUNCTION audit_row('reseller_id,room_scene_id', '*');
CREATE TRIGGER reseller_admins_audit AFTER INSERT OR UPDATE OR DELETE ON reseller_admins
  FOR EACH ROW EXECUTE FUNCTION audit_row('reseller_id,staff_user_id', '*');
CREATE TRIGGER resellers_audit_insert AFTER INSERT ON resellers
  FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'slug,status,currency_code');
CREATE TRIGGER resellers_audit_status AFTER UPDATE OF status ON resellers
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION audit_row('id', 'status');
CREATE TRIGGER configuration_requests_audit_status AFTER UPDATE OF status_code ON configuration_requests
  FOR EACH ROW WHEN (OLD.status_code IS DISTINCT FROM NEW.status_code)
  EXECUTE FUNCTION audit_row('id', 'status_code');
