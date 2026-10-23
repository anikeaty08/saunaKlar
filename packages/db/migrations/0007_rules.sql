-- 0007 Database-enforced business rules 1-8 (implementation-plan "Database-enforced rules").
--
-- Every rule raises raise_rule('<CODE>', ...) = SQLSTATE P0001, message "<CODE>: ...",
-- HINT <CODE>, DETAIL = optional sub-reason. Functions that must read rows the caller's role
-- cannot see (catalog rules, other tables' RLS) are SECURITY DEFINER with a pinned search_path;
-- they only validate or write derived rows and never return data.

-- updated_at on every table that has the column.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END
$$;

-- Is the staff user an ACTIVE admin of the reseller? (used by several rules)
CREATE FUNCTION is_active_reseller_admin(p_reseller_id uuid, p_staff_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM reseller_admins ra JOIN staff_users s ON s.id = ra.staff_user_id
    WHERE ra.reseller_id = p_reseller_id AND ra.staff_user_id = p_staff_id AND s.status = 'ACTIVE'
  )
$$;

CREATE FUNCTION assert_reseller_staff(p_reseller_id uuid, p_staff_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_staff_id IS NOT NULL AND NOT is_active_reseller_admin(p_reseller_id, p_staff_id) THEN
    PERFORM raise_rule('STAFF_NOT_RESELLER_ADMIN', 'staff user is not an active admin of this reseller');
  END IF;
END
$$;

-- =============================================================================================
-- Rule 3: slug format + reserved slugs; immutable reseller fields; self-bump of catalog_version.
-- =============================================================================================
CREATE FUNCTION resellers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- Checked here (before the CHECK constraint) to return a specific code.
    IF NEW.slug IS NULL OR NEW.slug !~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$' THEN
      PERFORM raise_rule('SLUG_INVALID', format('"%s" is not a valid subdomain label', NEW.slug));
    END IF;
    IF EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = NEW.slug) THEN
      PERFORM raise_rule('SLUG_RESERVED', format('"%s" is reserved', NEW.slug));
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- The currency pins every price, discount, snapshot and quote; the manufacturer pins the catalog.
    IF NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.manufacturer_id IS DISTINCT FROM OLD.manufacturer_id THEN
      PERFORM raise_rule('RESELLER_IMMUTABLE_FIELD', 'currency and manufacturer of a reseller cannot change');
    END IF;
    IF NEW.catalog_version < OLD.catalog_version THEN
      PERFORM raise_rule('RESELLER_IMMUTABLE_FIELD', 'catalog_version only increases');
    END IF;
    -- Tenant config is cached by catalog_version, so changes to it bump the version (rule 9).
    IF NEW.catalog_version = OLD.catalog_version AND (
         NEW.name IS DISTINCT FROM OLD.name OR NEW.slug IS DISTINCT FROM OLD.slug
         OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.default_share_expiry_days IS DISTINCT FROM OLD.default_share_expiry_days) THEN
      NEW.catalog_version := OLD.catalog_version + 1;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER resellers_guard BEFORE INSERT OR UPDATE ON resellers
  FOR EACH ROW EXECUTE FUNCTION resellers_guard();

-- =============================================================================================
-- Rule 1: discounts within the manufacturer's cap.
--   per-sauna: PERCENT <= cap; FIXED <= floor(list × cap / 10000) (cap on the bare list price,
--   the smallest possible subtotal).
--   default:   the same test against every assigned sauna, i.e. the lowest cap.
-- Lowering a cap later never invalidates rows: every discount is clamped when priced (G5).
-- =============================================================================================
CREATE FUNCTION reseller_sauna_discounts_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_list bigint;
  v_cap  integer;
BEGIN
  SELECT p.list_price_minor, p.max_discount_bps INTO v_list, v_cap
  FROM resellers r
  JOIN sauna_model_prices p ON p.sauna_model_id = NEW.sauna_model_id AND p.currency_code = r.currency_code
  WHERE r.id = NEW.reseller_id;
  IF NOT FOUND THEN
    PERFORM raise_rule('DISCOUNT_EXCEEDS_CAP', 'the sauna has no list price in the reseller currency', 'NO_PRICE');
  END IF;
  IF NEW.discount_type = 'PERCENT' AND NEW.discount_value > v_cap THEN
    PERFORM raise_rule('DISCOUNT_EXCEEDS_CAP',
      format('%s bps exceeds the cap of %s bps', NEW.discount_value, v_cap), 'PERCENT');
  END IF;
  IF NEW.discount_type = 'FIXED' AND NEW.discount_value > v_list * v_cap / 10000 THEN
    PERFORM raise_rule('DISCOUNT_EXCEEDS_CAP',
      format('%s exceeds the cap of %s minor units', NEW.discount_value, v_list * v_cap / 10000), 'FIXED');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reseller_sauna_discounts_cap BEFORE INSERT OR UPDATE ON reseller_sauna_discounts
  FOR EACH ROW EXECUTE FUNCTION reseller_sauna_discounts_cap();

CREATE FUNCTION reseller_default_discounts_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_min_bps   integer;
  v_min_fixed bigint;
BEGIN
  SELECT min(p.max_discount_bps), min(p.list_price_minor * p.max_discount_bps / 10000)
    INTO v_min_bps, v_min_fixed
  FROM resellers r
  JOIN reseller_saunas rs ON rs.reseller_id = r.id
  JOIN sauna_model_prices p ON p.sauna_model_id = rs.sauna_model_id AND p.currency_code = r.currency_code
  WHERE r.id = NEW.reseller_id;
  -- No assigned saunas yet: nothing to compare with; pricing clamps later.
  IF v_min_bps IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.discount_type = 'PERCENT' AND NEW.discount_value > v_min_bps THEN
    PERFORM raise_rule('DISCOUNT_EXCEEDS_CAP',
      format('%s bps exceeds the lowest cap of the assigned saunas (%s bps)', NEW.discount_value, v_min_bps), 'PERCENT');
  END IF;
  IF NEW.discount_type = 'FIXED' AND NEW.discount_value > v_min_fixed THEN
    PERFORM raise_rule('DISCOUNT_EXCEEDS_CAP',
      format('%s exceeds the lowest fixed cap of the assigned saunas (%s)', NEW.discount_value, v_min_fixed), 'FIXED');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reseller_default_discounts_cap BEFORE INSERT OR UPDATE ON reseller_default_discounts
  FOR EACH ROW EXECUTE FUNCTION reseller_default_discounts_cap();

-- =============================================================================================
-- Rule 2: assignment. Same manufacturer, model ACTIVE, list price AND every option price in the
-- reseller currency (review C4). Deferred constraint triggers re-check at commit when the
-- catalog changes under an already assigned model.
-- =============================================================================================

-- First missing price for (model, currency): 'MODEL' or an option code; NULL when complete.
CREATE FUNCTION missing_price_for(p_model_id uuid, p_currency char(3)) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM sauna_model_prices WHERE sauna_model_id = p_model_id AND currency_code = p_currency)
      THEN 'MODEL'
    ELSE (
      SELECT o.code FROM sauna_model_options smo JOIN options o ON o.id = smo.option_id
      WHERE smo.sauna_model_id = p_model_id
        AND NOT EXISTS (SELECT 1 FROM sauna_model_option_prices sop
                        WHERE sop.sauna_model_id = smo.sauna_model_id AND sop.option_id = smo.option_id
                          AND sop.currency_code = p_currency)
      ORDER BY o.code LIMIT 1)
  END
$$;

CREATE FUNCTION reseller_saunas_assignable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r       resellers%ROWTYPE;
  m       sauna_models%ROWTYPE;
  missing text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.reseller_id = OLD.reseller_id AND NEW.sauna_model_id = OLD.sauna_model_id THEN
    RETURN NEW; -- visibility / order only
  END IF;
  SELECT * INTO r FROM resellers WHERE id = NEW.reseller_id;
  SELECT * INTO m FROM sauna_models WHERE id = NEW.sauna_model_id;
  IF NOT FOUND OR r.id IS NULL THEN
    RETURN NEW; -- the foreign keys report it
  END IF;
  IF m.manufacturer_id <> r.manufacturer_id THEN
    PERFORM raise_rule('SAUNA_NOT_ASSIGNABLE', 'the sauna belongs to another manufacturer', 'MANUFACTURER_MISMATCH');
  END IF;
  IF m.status <> 'ACTIVE' THEN
    PERFORM raise_rule('SAUNA_NOT_ASSIGNABLE', format('sauna %s is %s, not ACTIVE', m.slug, m.status), 'NOT_ACTIVE');
  END IF;
  missing := missing_price_for(m.id, r.currency_code);
  IF missing = 'MODEL' THEN
    PERFORM raise_rule('SAUNA_NOT_ASSIGNABLE', format('sauna %s has no list price in %s', m.slug, r.currency_code), 'PRICE_MISSING');
  ELSIF missing IS NOT NULL THEN
    PERFORM raise_rule('SAUNA_NOT_ASSIGNABLE',
      format('option %s of sauna %s has no price in %s', missing, m.slug, r.currency_code), 'OPTION_PRICE_MISSING');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reseller_saunas_assignable BEFORE INSERT OR UPDATE ON reseller_saunas
  FOR EACH ROW EXECUTE FUNCTION reseller_saunas_assignable();

-- Deferred re-check: every reseller that has the model assigned still has full prices.
CREATE FUNCTION assert_assigned_model_priced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_model uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.sauna_model_id ELSE NEW.sauna_model_id END;
  v_bad   record;
BEGIN
  SELECT r.slug, r.currency_code, missing_price_for(v_model, r.currency_code) AS missing INTO v_bad
  FROM reseller_saunas rs JOIN resellers r ON r.id = rs.reseller_id
  WHERE rs.sauna_model_id = v_model AND missing_price_for(v_model, r.currency_code) IS NOT NULL
  LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('SAUNA_NOT_ASSIGNABLE',
      format('reseller %s offers this sauna but %s has no price in %s', v_bad.slug,
             CASE WHEN v_bad.missing = 'MODEL' THEN 'the sauna' ELSE 'option ' || v_bad.missing END, v_bad.currency_code),
      'ASSIGNED_PRICE_MISSING');
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER sauna_model_prices_assigned_check
  AFTER UPDATE OR DELETE ON sauna_model_prices DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_assigned_model_priced();
CREATE CONSTRAINT TRIGGER sauna_model_option_prices_assigned_check
  AFTER UPDATE OR DELETE ON sauna_model_option_prices DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_assigned_model_priced();
CREATE CONSTRAINT TRIGGER sauna_model_options_assigned_check
  AFTER INSERT OR UPDATE ON sauna_model_options DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_assigned_model_priced();

-- Rooms: same manufacturer and ACTIVE.
CREATE FUNCTION reseller_room_scenes_assignable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resellers r JOIN room_scenes rs ON rs.manufacturer_id = r.manufacturer_id
    WHERE r.id = NEW.reseller_id AND rs.id = NEW.room_scene_id AND rs.status = 'ACTIVE'
  ) THEN
    PERFORM raise_rule('ROOM_NOT_ASSIGNABLE', 'room scene must be ACTIVE and of the reseller''s manufacturer');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reseller_room_scenes_assignable BEFORE INSERT OR UPDATE OF reseller_id, room_scene_id ON reseller_room_scenes
  FOR EACH ROW EXECUTE FUNCTION reseller_room_scenes_assignable();

-- Catalog files are catalog assets (no reseller owner).
CREATE FUNCTION catalog_asset_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assets WHERE id = NEW.asset_id AND owner_reseller_id IS NOT NULL) THEN
    PERFORM raise_rule('ASSET_NOT_CATALOG', 'catalog entities can only use catalog assets');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sauna_model_assets_catalog BEFORE INSERT OR UPDATE ON sauna_model_assets
  FOR EACH ROW EXECUTE FUNCTION catalog_asset_guard();
CREATE TRIGGER option_assets_catalog BEFORE INSERT OR UPDATE ON option_assets
  FOR EACH ROW EXECUTE FUNCTION catalog_asset_guard();
CREATE TRIGGER room_scene_assets_catalog BEFORE INSERT OR UPDATE ON room_scene_assets
  FOR EACH ROW EXECUTE FUNCTION catalog_asset_guard();

-- Attribute values use the column of their definition's type.
CREATE FUNCTION sauna_model_attributes_type() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
BEGIN
  SELECT value_type INTO v_type FROM attribute_definitions WHERE code = NEW.attribute_code;
  IF (v_type = 'NUMBER' AND NEW.value_number IS NULL)
     OR (v_type = 'TEXT' AND NEW.value_text IS NULL)
     OR (v_type = 'BOOLEAN' AND NEW.value_bool IS NULL) THEN
    PERFORM raise_rule('ATTRIBUTE_TYPE_MISMATCH', format('attribute %s expects a %s value', NEW.attribute_code, v_type));
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sauna_model_attributes_type BEFORE INSERT OR UPDATE ON sauna_model_attributes
  FOR EACH ROW EXECUTE FUNCTION sauna_model_attributes_type();

-- Customers: tenant never changes; anonymisation is one-way.
CREATE FUNCTION customers_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reseller_id <> OLD.reseller_id THEN
    PERFORM raise_rule('CUSTOMER_IMMUTABLE_FIELD', 'a customer cannot move to another reseller');
  END IF;
  IF OLD.status = 'ANONYMISED' AND NEW.status <> 'ANONYMISED' THEN
    PERFORM raise_rule('CUSTOMER_ANONYMISED', 'an anonymised customer cannot be restored');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER customers_guard BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_guard();

-- =============================================================================================
-- Rules 4-6: configurations.
--   4. offered model and same-tenant customer: composite FKs (0005); staff creator must be an
--      active admin of the reseller (here).
--   5. selections: composite FKs prove option validity; one option per SINGLE group (here,
--      serialised with SELECT ... FOR UPDATE on the configuration row).
--   6. lock: locked_at needs a matching price snapshot and a complete, rule-valid selection.
--      Locked rows (configuration, selections, placement, snapshot, lines) are immutable.
-- =============================================================================================

-- Validates a configuration for locking; raises on the first problem.
CREATE FUNCTION assert_configuration_lockable(p_configuration_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c        configurations%ROWTYPE;
  s        configuration_price_snapshots%ROWTYPE;
  v_cur    char(3);
  v_code   text;
  v_list   bigint;
  v_cap    integer;
  v_sum    bigint;
BEGIN
  SELECT * INTO c FROM configurations WHERE id = p_configuration_id;
  SELECT currency_code INTO v_cur FROM resellers WHERE id = c.reseller_id;

  SELECT * INTO s FROM configuration_price_snapshots WHERE configuration_id = p_configuration_id;
  IF NOT FOUND THEN
    PERFORM raise_rule('SNAPSHOT_MISSING', 'locking requires a price snapshot written in the same transaction');
  END IF;
  IF s.currency_code <> v_cur THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'snapshot currency differs from the reseller currency', 'CURRENCY');
  END IF;

  -- Snapshot must reflect the current catalog price (a stale or fabricated price is rejected).
  SELECT list_price_minor, max_discount_bps INTO v_list, v_cap
  FROM sauna_model_prices WHERE sauna_model_id = c.sauna_model_id AND currency_code = v_cur;
  IF v_list IS DISTINCT FROM s.list_price_minor OR v_cap IS DISTINCT FROM s.max_discount_bps THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'snapshot list price or cap differs from the current price', 'STALE_PRICE');
  END IF;

  -- Lines = selections, each at the current option price; their sum = options_total.
  IF EXISTS (
       SELECT option_id FROM configuration_selections WHERE configuration_id = p_configuration_id
       EXCEPT SELECT option_id FROM configuration_price_snapshot_lines WHERE configuration_id = p_configuration_id)
     OR EXISTS (
       SELECT option_id FROM configuration_price_snapshot_lines WHERE configuration_id = p_configuration_id
       EXCEPT SELECT option_id FROM configuration_selections WHERE configuration_id = p_configuration_id) THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'snapshot lines must list exactly the selected options', 'LINES');
  END IF;
  IF EXISTS (
       SELECT 1 FROM configuration_price_snapshot_lines l
       LEFT JOIN sauna_model_option_prices p
         ON p.sauna_model_id = c.sauna_model_id AND p.option_id = l.option_id AND p.currency_code = v_cur
       WHERE l.configuration_id = p_configuration_id AND l.price_delta_minor IS DISTINCT FROM p.price_delta_minor) THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'a snapshot line differs from the current option price', 'STALE_PRICE');
  END IF;
  SELECT coalesce(sum(price_delta_minor), 0) INTO v_sum
  FROM configuration_price_snapshot_lines WHERE configuration_id = p_configuration_id;
  IF v_sum <> s.options_total_minor THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'options_total_minor differs from the sum of the lines', 'LINES');
  END IF;

  -- Required groups filled.
  SELECT g.code INTO v_code
  FROM sauna_model_option_groups smog JOIN option_groups g ON g.id = smog.option_group_id
  WHERE smog.sauna_model_id = c.sauna_model_id AND smog.is_required
    AND NOT EXISTS (
      SELECT 1 FROM configuration_selections cs JOIN options o ON o.id = cs.option_id
      WHERE cs.configuration_id = p_configuration_id AND o.option_group_id = smog.option_group_id)
  ORDER BY smog.sort_order, g.code LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('required group %s has no selection', v_code), 'REQUIRED_GROUP_EMPTY');
  END IF;

  -- One option per SINGLE group (defensive; the selection trigger already prevents it).
  SELECT g.code INTO v_code
  FROM configuration_selections cs JOIN options o ON o.id = cs.option_id JOIN option_groups g ON g.id = o.option_group_id
  WHERE cs.configuration_id = p_configuration_id AND g.selection_type = 'SINGLE'
  GROUP BY g.code HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('group %s allows one option', v_code), 'SINGLE_GROUP_MULTIPLE');
  END IF;

  -- Requires satisfied.
  SELECT o.code INTO v_code
  FROM configuration_selections cs
  JOIN option_requires r ON r.sauna_model_id = cs.sauna_model_id AND r.option_id = cs.option_id
  JOIN options o ON o.id = cs.option_id
  WHERE cs.configuration_id = p_configuration_id
    AND NOT EXISTS (SELECT 1 FROM configuration_selections x
                    WHERE x.configuration_id = p_configuration_id AND x.option_id = r.required_option_id)
  LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('option %s requires another option', v_code), 'REQUIRES_MISSING');
  END IF;

  -- No excluded pair.
  IF EXISTS (
    SELECT 1 FROM option_excludes x
    JOIN configuration_selections a ON a.configuration_id = p_configuration_id AND a.option_id = x.option_a_id
    JOIN configuration_selections b ON b.configuration_id = p_configuration_id AND b.option_id = x.option_b_id
    WHERE x.sauna_model_id = c.sauna_model_id) THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', 'two selected options exclude each other', 'EXCLUDED_PAIR');
  END IF;
END
$$;

CREATE FUNCTION configurations_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      PERFORM raise_rule('CONFIGURATION_LOCKED', 'a locked configuration cannot be deleted');
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.locked_at IS NOT NULL THEN
      -- The snapshot references the configuration, so it cannot exist yet: insert, then lock.
      PERFORM raise_rule('SNAPSHOT_MISSING', 'a configuration is created as a draft and locked afterwards');
    END IF;
    PERFORM assert_reseller_staff(NEW.reseller_id, NEW.created_by_staff_id);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.locked_at IS NOT NULL THEN
    -- Covers clearing locked_at too.
    PERFORM raise_rule('CONFIGURATION_LOCKED', 'a locked configuration is immutable; clone it instead');
  END IF;
  IF NEW.reseller_id <> OLD.reseller_id OR NEW.source_configuration_id IS DISTINCT FROM OLD.source_configuration_id
     OR NEW.created_at <> OLD.created_at THEN
    PERFORM raise_rule('CONFIGURATION_IMMUTABLE_FIELD', 'reseller, source and creation time cannot change');
  END IF;
  IF NEW.created_by_staff_id IS DISTINCT FROM OLD.created_by_staff_id THEN
    PERFORM assert_reseller_staff(NEW.reseller_id, NEW.created_by_staff_id);
  END IF;
  IF NEW.locked_at IS NOT NULL THEN
    PERFORM assert_configuration_lockable(NEW.id);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER configurations_guard BEFORE INSERT OR UPDATE OR DELETE ON configurations
  FOR EACH ROW EXECUTE FUNCTION configurations_guard();

CREATE FUNCTION configuration_selections_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conf   uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.configuration_id ELSE NEW.configuration_id END;
  v_locked timestamptz;
  v_group  uuid;
  v_type   text;
  v_gcode  text;
BEGIN
  -- Row lock serialises concurrent selection writes of one configuration.
  SELECT locked_at INTO v_locked FROM configurations WHERE id = v_conf FOR UPDATE;
  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; -- cascade from a deleted draft / FK reports it
  END IF;
  IF v_locked IS NOT NULL THEN
    PERFORM raise_rule('CONFIGURATION_LOCKED', 'selections of a locked configuration cannot change');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT o.option_group_id, g.selection_type, g.code INTO v_group, v_type, v_gcode
  FROM options o JOIN option_groups g ON g.id = o.option_group_id WHERE o.id = NEW.option_id;
  IF v_type = 'SINGLE' AND EXISTS (
       SELECT 1 FROM configuration_selections cs JOIN options o ON o.id = cs.option_id
       WHERE cs.configuration_id = NEW.configuration_id AND o.option_group_id = v_group
         AND cs.option_id <> NEW.option_id
         AND (TG_OP = 'INSERT' OR cs.option_id <> OLD.option_id)) THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('group %s allows only one option', v_gcode), 'SINGLE_GROUP_MULTIPLE');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER configuration_selections_guard BEFORE INSERT OR UPDATE OR DELETE ON configuration_selections
  FOR EACH ROW EXECUTE FUNCTION configuration_selections_guard();

-- Placement, snapshot and snapshot lines follow their configuration's lock.
CREATE FUNCTION configuration_child_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conf   uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.configuration_id ELSE NEW.configuration_id END;
  v_locked timestamptz;
BEGIN
  SELECT locked_at INTO v_locked FROM configurations WHERE id = v_conf;
  IF v_locked IS NULL AND TG_OP = 'UPDATE' AND NEW.configuration_id <> OLD.configuration_id THEN
    SELECT locked_at INTO v_locked FROM configurations WHERE id = OLD.configuration_id;
  END IF;
  IF v_locked IS NOT NULL THEN
    PERFORM raise_rule('CONFIGURATION_LOCKED', format('%s of a locked configuration cannot change', TG_TABLE_NAME));
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER configuration_room_placements_lock BEFORE INSERT OR UPDATE OR DELETE ON configuration_room_placements
  FOR EACH ROW EXECUTE FUNCTION configuration_child_guard();
CREATE TRIGGER configuration_price_snapshots_lock BEFORE INSERT OR UPDATE OR DELETE ON configuration_price_snapshots
  FOR EACH ROW EXECUTE FUNCTION configuration_child_guard();
CREATE TRIGGER configuration_price_snapshot_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON configuration_price_snapshot_lines
  FOR EACH ROW EXECUTE FUNCTION configuration_child_guard();

-- =============================================================================================
-- Rule 8 (rest): share links only for locked configurations; only revoked_at may change, once.
-- =============================================================================================
CREATE FUNCTION share_links_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM configurations WHERE id = NEW.configuration_id AND locked_at IS NOT NULL) THEN
      PERFORM raise_rule('CONFIGURATION_NOT_LOCKED', 'lock the configuration (with its price snapshot) before sharing');
    END IF;
    PERFORM assert_reseller_staff(NEW.reseller_id, NEW.created_by_staff_id);
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at') <> (to_jsonb(OLD) - 'revoked_at') THEN
    PERFORM raise_rule('SHARE_LINK_IMMUTABLE', 'only revoked_at of a share link can change');
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    PERFORM raise_rule('SHARE_LINK_IMMUTABLE', 'a revoked share link stays revoked');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER share_links_guard BEFORE INSERT OR UPDATE ON share_links
  FOR EACH ROW EXECUTE FUNCTION share_links_guard();

-- =============================================================================================
-- Rule 7: requests.
--   insert: by the owning customer (app.actor_customer_id), status SUBMITTED, configuration
--           locked (ownership and tenant via composite FKs, one per configuration via UNIQUE).
--   update: only status_code changes, along request_status_transitions for the actor kind
--           derived from app.actor_*; QUOTED needs an active quote, ACCEPTED an unexpired one.
--   after:  request_status_history + notification_outbox rows, written here so no code path
--           can skip them. An optional note comes from set_config('app.status_note', ..., true).
-- =============================================================================================
CREATE FUNCTION configuration_requests_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind  text := app_actor_kind();
  v_quote request_quotes%ROWTYPE;
BEGIN
  IF v_kind = 'AMBIGUOUS' THEN
    PERFORM raise_rule('ACTOR_AMBIGUOUS', 'set either app.actor_staff_id or app.actor_customer_id, not both');
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_kind <> 'CUSTOMER' OR app_actor_customer_id() <> NEW.customer_id THEN
      PERFORM raise_rule('REQUEST_NOT_OWNER', 'only the owning customer can send a request');
    END IF;
    IF NEW.status_code <> 'SUBMITTED' THEN
      PERFORM raise_rule('INVALID_TRANSITION', 'a request starts as SUBMITTED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM configurations WHERE id = NEW.configuration_id AND locked_at IS NOT NULL) THEN
      PERFORM raise_rule('CONFIGURATION_NOT_LOCKED', 'lock the configuration before sending a request');
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.reseller_id <> OLD.reseller_id OR NEW.customer_id <> OLD.customer_id
     OR NEW.configuration_id <> OLD.configuration_id OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.created_at <> OLD.created_at THEN
    PERFORM raise_rule('REQUEST_IMMUTABLE', 'only the status of a request can change');
  END IF;
  IF NEW.status_code = OLD.status_code THEN
    RETURN NEW;
  END IF;

  IF v_kind = 'CUSTOMER' AND app_actor_customer_id() <> NEW.customer_id THEN
    PERFORM raise_rule('REQUEST_NOT_OWNER', 'the customer does not own this request');
  END IF;
  IF v_kind = 'STAFF' AND NOT is_active_reseller_admin(NEW.reseller_id, app_actor_staff_id()) THEN
    PERFORM raise_rule('STAFF_NOT_RESELLER_ADMIN', 'staff user is not an active admin of this reseller');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM request_status_transitions
    WHERE from_code = OLD.status_code AND to_code = NEW.status_code AND actor_kind = v_kind) THEN
    PERFORM raise_rule('INVALID_TRANSITION',
      format('%s cannot move a request from %s to %s', v_kind, OLD.status_code, NEW.status_code),
      OLD.status_code || '->' || NEW.status_code);
  END IF;

  IF NEW.status_code IN ('QUOTED', 'ACCEPTED') THEN
    SELECT * INTO v_quote FROM request_quotes WHERE request_id = NEW.id AND superseded_at IS NULL;
    IF NOT FOUND THEN
      PERFORM raise_rule('QUOTE_MISSING', 'the request has no active quote');
    END IF;
    IF v_quote.valid_until <= now() THEN
      PERFORM raise_rule('QUOTE_EXPIRED', 'the active quote has expired');
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER configuration_requests_guard BEFORE INSERT OR UPDATE ON configuration_requests
  FOR EACH ROW EXECUTE FUNCTION configuration_requests_guard();

CREATE FUNCTION configuration_requests_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_from  text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status_code END;
  v_note  text := nullif(btrim(current_setting('app.status_note', true)), '');
  v_hist  bigint;
BEGIN
  INSERT INTO request_status_history
    (request_id, reseller_id, from_status, to_status, changed_by_staff_id, changed_by_customer_id, note)
  VALUES
    (NEW.id, NEW.reseller_id, v_from, NEW.status_code, app_actor_staff_id(), app_actor_customer_id(), left(v_note, 2000))
  RETURNING id INTO v_hist;

  INSERT INTO notification_outbox (reseller_id, event_type, payload)
  VALUES (
    NEW.reseller_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'REQUEST_SUBMITTED' ELSE 'REQUEST_STATUS_CHANGED' END,
    jsonb_build_object(
      'requestId', NEW.id,
      'configurationId', NEW.configuration_id,
      'customerId', NEW.customer_id,
      'fromStatus', v_from,
      'toStatus', NEW.status_code,
      'actorKind', app_actor_kind(),
      'historyId', v_hist
    )
  );
  RETURN NULL;
END
$$;
CREATE TRIGGER configuration_requests_history_insert AFTER INSERT ON configuration_requests
  FOR EACH ROW EXECUTE FUNCTION configuration_requests_history();
CREATE TRIGGER configuration_requests_history_update AFTER UPDATE OF status_code ON configuration_requests
  FOR EACH ROW WHEN (OLD.status_code IS DISTINCT FROM NEW.status_code)
  EXECUTE FUNCTION configuration_requests_history();

-- Quotes: only while IN_REVIEW or QUOTED, by an admin of the reseller; a new quote supersedes
-- the active one (G8). After insert: QUOTE_ADDED outbox event.
CREATE FUNCTION request_quotes_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only the supersede step (NULL -> timestamp) is allowed; quotes are otherwise immutable.
    IF (to_jsonb(NEW) - 'superseded_at') <> (to_jsonb(OLD) - 'superseded_at')
       OR OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
      PERFORM raise_rule('QUOTE_IMMUTABLE', 'a quote cannot be changed; add a new quote instead');
    END IF;
    RETURN NEW;
  END IF;

  SELECT status_code INTO v_status FROM configuration_requests WHERE id = NEW.request_id FOR UPDATE;
  IF v_status IS NULL OR v_status NOT IN ('IN_REVIEW', 'QUOTED') THEN
    PERFORM raise_rule('REQUEST_NOT_QUOTABLE', format('a request in status %s cannot be quoted', v_status));
  END IF;
  IF app_actor_kind() = 'CUSTOMER' THEN
    PERFORM raise_rule('STAFF_NOT_RESELLER_ADMIN', 'customers cannot write quotes');
  END IF;
  PERFORM assert_reseller_staff(NEW.reseller_id, NEW.created_by_staff_id);
  IF NEW.superseded_at IS NOT NULL THEN
    PERFORM raise_rule('QUOTE_IMMUTABLE', 'a new quote cannot be superseded already');
  END IF;

  UPDATE request_quotes SET superseded_at = greatest(now(), created_at)
  WHERE request_id = NEW.request_id AND superseded_at IS NULL;
  RETURN NEW;
END
$$;
CREATE TRIGGER request_quotes_guard BEFORE INSERT OR UPDATE ON request_quotes
  FOR EACH ROW EXECUTE FUNCTION request_quotes_guard();

CREATE FUNCTION request_quotes_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO notification_outbox (reseller_id, event_type, payload)
  SELECT NEW.reseller_id, 'QUOTE_ADDED',
         jsonb_build_object('requestId', NEW.request_id, 'quoteId', NEW.id,
                            'configurationId', r.configuration_id, 'customerId', r.customer_id)
  FROM configuration_requests r WHERE r.id = NEW.request_id;
  RETURN NULL;
END
$$;
CREATE TRIGGER request_quotes_outbox AFTER INSERT ON request_quotes
  FOR EACH ROW EXECUTE FUNCTION request_quotes_outbox();

-- Notes: authored by an active admin of the reseller.
CREATE FUNCTION request_notes_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM assert_reseller_staff(NEW.reseller_id, NEW.author_staff_id);
  RETURN NEW;
END
$$;
CREATE TRIGGER request_notes_guard BEFORE INSERT OR UPDATE ON request_notes
  FOR EACH ROW EXECUTE FUNCTION request_notes_guard();

-- Append-only logs.
CREATE TRIGGER request_status_history_append_only BEFORE UPDATE ON request_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER share_link_views_append_only BEFORE UPDATE ON share_link_views
  FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update();
