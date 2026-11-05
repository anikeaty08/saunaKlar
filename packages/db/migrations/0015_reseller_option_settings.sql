-- 0015 Per-reseller option settings, and localised option-group descriptions.
--
-- A reseller shapes what its customers see and pay for the options of each sauna it offers:
-- an option can be switched off, priced differently (reseller currency, minor units) and
-- described differently. No row = the manufacturer's values (enabled, catalog price and
-- description), so only deviations are stored. See docs/customization.md.
--
-- Invariants:
--   * a row exists only for a sauna the reseller offers and an option that sauna offers
--     (composite FKs, like reseller_sauna_discounts); both cascade on unassignment / removal;
--   * a required option group keeps at least one enabled option, and an enabled option never
--     requires a disabled one (trigger below; raise OPTION_RULES_VIOLATED);
--   * locking a configuration re-checks against the effective price and rejects disabled
--     options (assert_configuration_lockable, replaced below);
--   * tenant RLS (own rows only), catalog_version bump (rule 9) and audit trail (rule 11)
--     follow the other reseller catalog tables. The free-text description never reaches the
--     audit trail.

-- ---------------------------------------------------------------------------------------------
-- Group descriptions (base text = English fallback, translations per locale).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE option_groups ADD COLUMN description text CHECK (length(description) <= 2000);
ALTER TABLE option_group_translations ADD COLUMN description text CHECK (length(description) <= 2000);

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
CREATE TABLE reseller_sauna_options (
  reseller_id          uuid        NOT NULL,
  sauna_model_id       uuid        NOT NULL,
  option_id            uuid        NOT NULL,
  is_enabled           boolean     NOT NULL DEFAULT true,
  -- Replaces the manufacturer's option price for this reseller (reseller currency, minor units).
  price_override_minor bigint      CHECK (price_override_minor >= 0),
  -- Replaces the option description in every locale.
  description_override text        CHECK (length(btrim(description_override)) BETWEEN 1 AND 2000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reseller_id, sauna_model_id, option_id),
  CONSTRAINT reseller_sauna_options_sauna_fk FOREIGN KEY (reseller_id, sauna_model_id)
    REFERENCES reseller_saunas (reseller_id, sauna_model_id) ON DELETE CASCADE,
  CONSTRAINT reseller_sauna_options_option_fk FOREIGN KEY (sauna_model_id, option_id)
    REFERENCES sauna_model_options (sauna_model_id, option_id) ON DELETE CASCADE
);
CREATE INDEX reseller_sauna_options_option_idx ON reseller_sauna_options (sauna_model_id, option_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON reseller_sauna_options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Required groups keep an enabled option; enabled options keep what they require.
-- Row-level AFTER triggers run once the whole statement is applied, so one bulk upsert that
-- disables one option and enables another is judged on the end state.
CREATE FUNCTION reseller_sauna_options_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT g.code INTO v_code
  FROM sauna_model_option_groups smog JOIN option_groups g ON g.id = smog.option_group_id
  WHERE smog.sauna_model_id = NEW.sauna_model_id AND smog.is_required
    AND NOT EXISTS (
      SELECT 1 FROM sauna_model_options smo
      LEFT JOIN reseller_sauna_options rso
        ON rso.reseller_id = NEW.reseller_id AND rso.sauna_model_id = smo.sauna_model_id AND rso.option_id = smo.option_id
      WHERE smo.sauna_model_id = smog.sauna_model_id AND smo.option_group_id = smog.option_group_id
        AND coalesce(rso.is_enabled, true))
  LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('required group %s needs at least one enabled option', v_code), 'REQUIRED_GROUP_DISABLED');
  END IF;

  SELECT o.code INTO v_code
  FROM option_requires r
  JOIN options o ON o.id = r.option_id
  JOIN reseller_sauna_options req
    ON req.reseller_id = NEW.reseller_id AND req.sauna_model_id = r.sauna_model_id AND req.option_id = r.required_option_id
   AND NOT req.is_enabled
  LEFT JOIN reseller_sauna_options own
    ON own.reseller_id = NEW.reseller_id AND own.sauna_model_id = r.sauna_model_id AND own.option_id = r.option_id
  WHERE r.sauna_model_id = NEW.sauna_model_id AND coalesce(own.is_enabled, true)
  LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('option %s requires an option that is disabled', v_code), 'REQUIRED_OPTION_DISABLED');
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER reseller_sauna_options_guard AFTER INSERT OR UPDATE ON reseller_sauna_options
  FOR EACH ROW EXECUTE FUNCTION reseller_sauna_options_guard();

-- Rule 9: storefront caches are keyed by catalog_version.
CREATE TRIGGER reseller_sauna_options_bump_ins AFTER INSERT ON reseller_sauna_options REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_versions('reseller', 'reseller_id');
CREATE TRIGGER reseller_sauna_options_bump_upd AFTER UPDATE ON reseller_sauna_options REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_versions('reseller', 'reseller_id');
CREATE TRIGGER reseller_sauna_options_bump_del AFTER DELETE ON reseller_sauna_options REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_versions('reseller', 'reseller_id');

-- Rule 11: prices and availability are audited; the free-text description is not.
CREATE TRIGGER reseller_sauna_options_audit AFTER INSERT OR UPDATE OR DELETE ON reseller_sauna_options
  FOR EACH ROW EXECUTE FUNCTION audit_row('reseller_id,sauna_model_id,option_id', 'is_enabled,price_override_minor');

-- Rule 12: own rows only; the manufacturer reads; nothing for the worker or the import.
ALTER TABLE reseller_sauna_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE reseller_sauna_options FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_all ON reseller_sauna_options FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY platform_read ON reseller_sauna_options FOR SELECT TO app_platform USING (true);
REVOKE ALL ON reseller_sauna_options FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON reseller_sauna_options TO app_tenant;
GRANT SELECT ON reseller_sauna_options TO app_platform;

-- ---------------------------------------------------------------------------------------------
-- Rule 6 (lock) with reseller settings: snapshot lines carry the effective option price, and a
-- disabled option cannot be locked in. Otherwise unchanged from 0007.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_configuration_lockable(p_configuration_id uuid) RETURNS void
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

  SELECT list_price_minor, max_discount_bps INTO v_list, v_cap
  FROM sauna_model_prices WHERE sauna_model_id = c.sauna_model_id AND currency_code = v_cur;
  IF v_list IS DISTINCT FROM s.list_price_minor OR v_cap IS DISTINCT FROM s.max_discount_bps THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'snapshot list price or cap differs from the current price', 'STALE_PRICE');
  END IF;

  -- Options the reseller switched off.
  SELECT o.code INTO v_code
  FROM configuration_selections cs
  JOIN reseller_sauna_options rso
    ON rso.reseller_id = c.reseller_id AND rso.sauna_model_id = cs.sauna_model_id AND rso.option_id = cs.option_id
  JOIN options o ON o.id = cs.option_id
  WHERE cs.configuration_id = p_configuration_id AND NOT rso.is_enabled
  ORDER BY o.code LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('option %s is not offered by this reseller', v_code), 'OPTION_DISABLED');
  END IF;

  IF EXISTS (
       SELECT option_id FROM configuration_selections WHERE configuration_id = p_configuration_id
       EXCEPT SELECT option_id FROM configuration_price_snapshot_lines WHERE configuration_id = p_configuration_id)
     OR EXISTS (
       SELECT option_id FROM configuration_price_snapshot_lines WHERE configuration_id = p_configuration_id
       EXCEPT SELECT option_id FROM configuration_selections WHERE configuration_id = p_configuration_id) THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'snapshot lines must list exactly the selected options', 'LINES');
  END IF;
  -- Effective price: the reseller's override, else the manufacturer's option price.
  IF EXISTS (
       SELECT 1 FROM configuration_price_snapshot_lines l
       LEFT JOIN sauna_model_option_prices p
         ON p.sauna_model_id = c.sauna_model_id AND p.option_id = l.option_id AND p.currency_code = v_cur
       LEFT JOIN reseller_sauna_options rso
         ON rso.reseller_id = c.reseller_id AND rso.sauna_model_id = c.sauna_model_id AND rso.option_id = l.option_id
       WHERE l.configuration_id = p_configuration_id
         AND l.price_delta_minor IS DISTINCT FROM coalesce(rso.price_override_minor, p.price_delta_minor)) THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'a snapshot line differs from the current option price', 'STALE_PRICE');
  END IF;
  SELECT coalesce(sum(price_delta_minor), 0) INTO v_sum
  FROM configuration_price_snapshot_lines WHERE configuration_id = p_configuration_id;
  IF v_sum <> s.options_total_minor THEN
    PERFORM raise_rule('SNAPSHOT_INVALID', 'options_total_minor differs from the sum of the lines', 'LINES');
  END IF;

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

  SELECT g.code INTO v_code
  FROM configuration_selections cs JOIN options o ON o.id = cs.option_id JOIN option_groups g ON g.id = o.option_group_id
  WHERE cs.configuration_id = p_configuration_id AND g.selection_type = 'SINGLE'
  GROUP BY g.code HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', format('group %s allows one option', v_code), 'SINGLE_GROUP_MULTIPLE');
  END IF;

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

  IF EXISTS (
    SELECT 1 FROM option_excludes x
    JOIN configuration_selections a ON a.configuration_id = p_configuration_id AND a.option_id = x.option_a_id
    JOIN configuration_selections b ON b.configuration_id = p_configuration_id AND b.option_id = x.option_b_id
    WHERE x.sauna_model_id = c.sauna_model_id) THEN
    PERFORM raise_rule('OPTION_RULES_VIOLATED', 'two selected options exclude each other', 'EXCLUDED_PAIR');
  END IF;
END
$$;
