-- 0009 Rule 12: row-level security, least-privilege grants, SECURITY DEFINER API functions.
--
-- Layers: (1) GRANTs decide which statements a role may run at all; (2) RLS policies decide which
-- rows. Tenant scoping uses app_reseller_id() (transaction-local setting, NULL = zero rows).
-- Platform rights come from role membership, never from a client-settable value (design 7.6).
-- `(SELECT fn())` in policies makes Postgres evaluate the setting once per query (init plan).

-- ---------------------------------------------------------------------------------------------
-- Enable + FORCE RLS on every tenant table and every catalog table the tenant reads filtered.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'resellers', 'reseller_branding', 'assets', 'staff_users', 'reseller_admins',
    'customers', 'customer_addresses', 'customer_consents',
    'sauna_models', 'sauna_model_translations', 'sauna_model_attributes', 'sauna_model_prices',
    'option_groups', 'option_group_translations', 'options', 'option_translations',
    'sauna_model_option_groups', 'sauna_model_options', 'sauna_model_option_prices',
    'option_requires', 'option_excludes', 'room_scenes', 'room_scene_translations',
    'sauna_model_assets', 'option_assets', 'room_scene_assets',
    'reseller_saunas', 'reseller_sauna_discounts', 'reseller_default_discounts', 'reseller_room_scenes',
    'configurations', 'configuration_selections', 'configuration_room_placements',
    'configuration_price_snapshots', 'configuration_price_snapshot_lines', 'share_links', 'share_link_views',
    'configuration_requests', 'request_status_history', 'request_notes', 'request_quotes',
    'notification_outbox', 'audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- Reseller currency of the current tenant (for price visibility).
CREATE FUNCTION app_reseller_currency() RETURNS char(3)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT currency_code FROM resellers WHERE id = app_reseller_id() $$;

-- Does the current tenant offer the model? (invoker: runs under the tenant's own RLS)
CREATE FUNCTION app_offers_model(p_model_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM reseller_saunas rs
                 WHERE rs.reseller_id = app_reseller_id() AND rs.sauna_model_id = p_model_id)
$$;

-- ---------------------------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------------------------
CREATE POLICY tenant_read ON resellers FOR SELECT TO app_tenant
  USING (id = (SELECT app_reseller_id()));
CREATE POLICY tenant_update ON resellers FOR UPDATE TO app_tenant
  USING (id = (SELECT app_reseller_id())) WITH CHECK (id = (SELECT app_reseller_id()));
CREATE POLICY platform_all ON resellers FOR ALL TO app_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_read ON resellers FOR SELECT TO app_worker USING (true);

CREATE POLICY tenant_all ON reseller_branding FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY platform_all ON reseller_branding FOR ALL TO app_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_read ON reseller_branding FOR SELECT TO app_worker USING (true);

-- Assets: own uploads, plus catalog files of offered models / their options / offered rooms.
CREATE POLICY tenant_read ON assets FOR SELECT TO app_tenant USING (
  owner_reseller_id = (SELECT app_reseller_id())
  OR (owner_reseller_id IS NULL AND (
       EXISTS (SELECT 1 FROM sauna_model_assets a WHERE a.asset_id = assets.id)
    OR EXISTS (SELECT 1 FROM option_assets a WHERE a.asset_id = assets.id)
    OR EXISTS (SELECT 1 FROM room_scene_assets a WHERE a.asset_id = assets.id)))
);
CREATE POLICY tenant_insert ON assets FOR INSERT TO app_tenant
  WITH CHECK (owner_reseller_id = (SELECT app_reseller_id()));
CREATE POLICY tenant_delete ON assets FOR DELETE TO app_tenant
  USING (owner_reseller_id = (SELECT app_reseller_id()));
CREATE POLICY platform_all ON assets FOR ALL TO app_platform USING (true) WITH CHECK (true);
CREATE POLICY catalog_all ON assets FOR ALL TO catalog_admin
  USING (owner_reseller_id IS NULL) WITH CHECK (owner_reseller_id IS NULL);
CREATE POLICY worker_read ON assets FOR SELECT TO app_worker USING (true);

-- Staff: a tenant sees its own admins; a staff user may rename only itself.
CREATE POLICY tenant_read ON staff_users FOR SELECT TO app_tenant USING (
  id IN (SELECT ra.staff_user_id FROM reseller_admins ra WHERE ra.reseller_id = (SELECT app_reseller_id()))
);
CREATE POLICY tenant_update_self ON staff_users FOR UPDATE TO app_tenant
  USING (id = (SELECT app_actor_staff_id())
         AND id IN (SELECT ra.staff_user_id FROM reseller_admins ra WHERE ra.reseller_id = (SELECT app_reseller_id())))
  WITH CHECK (id = (SELECT app_actor_staff_id()));
CREATE POLICY platform_all ON staff_users FOR ALL TO app_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_read ON staff_users FOR SELECT TO app_worker USING (true);

CREATE POLICY tenant_read ON reseller_admins FOR SELECT TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY platform_all ON reseller_admins FOR ALL TO app_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_read ON reseller_admins FOR SELECT TO app_worker USING (true);

-- ---------------------------------------------------------------------------------------------
-- Customer PII. app_platform has no policy (and no grant): zero rows / permission denied (A10).
-- When app.actor_customer_id is set, a customer sees only its own row and children.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY tenant_all ON customers FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())
         AND ((SELECT app_actor_customer_id()) IS NULL OR id = (SELECT app_actor_customer_id())))
  WITH CHECK (reseller_id = (SELECT app_reseller_id()));
-- Worker: e-mail delivery only; columns are limited by the grant below.
CREATE POLICY worker_read ON customers FOR SELECT TO app_worker USING (true);

CREATE POLICY tenant_all ON customer_addresses FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())
         AND ((SELECT app_actor_customer_id()) IS NULL OR customer_id = (SELECT app_actor_customer_id())))
  WITH CHECK (reseller_id = (SELECT app_reseller_id())
         AND ((SELECT app_actor_customer_id()) IS NULL OR customer_id = (SELECT app_actor_customer_id())));

CREATE POLICY tenant_all ON customer_consents FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())
         AND ((SELECT app_actor_customer_id()) IS NULL OR customer_id = (SELECT app_actor_customer_id())))
  WITH CHECK (reseller_id = (SELECT app_reseller_id())
         AND ((SELECT app_actor_customer_id()) IS NULL OR customer_id = (SELECT app_actor_customer_id())));

-- ---------------------------------------------------------------------------------------------
-- Catalog: trusted roles see everything (grants limit writes); a tenant sees only what belongs
-- to the saunas and rooms it offers, and prices only in its own currency.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sauna_models', 'sauna_model_translations', 'sauna_model_attributes', 'sauna_model_prices',
    'option_groups', 'option_group_translations', 'options', 'option_translations',
    'sauna_model_option_groups', 'sauna_model_options', 'sauna_model_option_prices',
    'option_requires', 'option_excludes', 'room_scenes', 'room_scene_translations',
    'sauna_model_assets', 'option_assets', 'room_scene_assets'
  ] LOOP
    EXECUTE format('CREATE POLICY trusted_all ON %I FOR ALL TO app_platform, catalog_admin, app_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;

CREATE POLICY tenant_read ON sauna_models FOR SELECT TO app_tenant USING (app_offers_model(id));
CREATE POLICY tenant_read ON sauna_model_translations FOR SELECT TO app_tenant USING (app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON sauna_model_attributes FOR SELECT TO app_tenant USING (app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON sauna_model_option_groups FOR SELECT TO app_tenant USING (app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON sauna_model_options FOR SELECT TO app_tenant USING (app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON option_requires FOR SELECT TO app_tenant USING (app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON option_excludes FOR SELECT TO app_tenant USING (app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON sauna_model_assets FOR SELECT TO app_tenant USING (app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON sauna_model_prices FOR SELECT TO app_tenant
  USING (currency_code = (SELECT app_reseller_currency()) AND app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON sauna_model_option_prices FOR SELECT TO app_tenant
  USING (currency_code = (SELECT app_reseller_currency()) AND app_offers_model(sauna_model_id));
CREATE POLICY tenant_read ON option_groups FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM sauna_model_option_groups g WHERE g.option_group_id = option_groups.id)
);
CREATE POLICY tenant_read ON option_group_translations FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM sauna_model_option_groups g WHERE g.option_group_id = option_group_translations.option_group_id)
);
CREATE POLICY tenant_read ON options FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM sauna_model_options o WHERE o.option_id = options.id)
);
CREATE POLICY tenant_read ON option_translations FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM sauna_model_options o WHERE o.option_id = option_translations.option_id)
);
CREATE POLICY tenant_read ON option_assets FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM sauna_model_options o WHERE o.option_id = option_assets.option_id)
);
CREATE POLICY tenant_read ON room_scenes FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM reseller_room_scenes rr WHERE rr.room_scene_id = room_scenes.id AND rr.reseller_id = (SELECT app_reseller_id()))
);
CREATE POLICY tenant_read ON room_scene_translations FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM reseller_room_scenes rr WHERE rr.room_scene_id = room_scene_translations.room_scene_id AND rr.reseller_id = (SELECT app_reseller_id()))
);
CREATE POLICY tenant_read ON room_scene_assets FOR SELECT TO app_tenant USING (
  EXISTS (SELECT 1 FROM reseller_room_scenes rr WHERE rr.room_scene_id = room_scene_assets.room_scene_id AND rr.reseller_id = (SELECT app_reseller_id()))
);

-- ---------------------------------------------------------------------------------------------
-- Reseller catalog
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reseller_saunas', 'reseller_sauna_discounts', 'reseller_default_discounts', 'reseller_room_scenes'] LOOP
    EXECUTE format('CREATE POLICY tenant_all ON %I FOR ALL TO app_tenant
                    USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()))', t);
    EXECUTE format('CREATE POLICY platform_all ON %I FOR ALL TO app_platform USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Configurations and sharing
-- ---------------------------------------------------------------------------------------------
CREATE POLICY tenant_all ON configurations FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY worker_read ON configurations FOR SELECT TO app_worker USING (true);

-- Child tables without reseller_id check through the parent (whose own policy applies).
CREATE POLICY tenant_all ON configuration_selections FOR ALL TO app_tenant
  USING (EXISTS (SELECT 1 FROM configurations c WHERE c.id = configuration_selections.configuration_id
                 AND c.reseller_id = (SELECT app_reseller_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM configurations c WHERE c.id = configuration_selections.configuration_id
                 AND c.reseller_id = (SELECT app_reseller_id())));

CREATE POLICY tenant_all ON configuration_room_placements FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));

CREATE POLICY tenant_all ON configuration_price_snapshots FOR ALL TO app_tenant
  USING (EXISTS (SELECT 1 FROM configurations c WHERE c.id = configuration_price_snapshots.configuration_id
                 AND c.reseller_id = (SELECT app_reseller_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM configurations c WHERE c.id = configuration_price_snapshots.configuration_id
                 AND c.reseller_id = (SELECT app_reseller_id())));
CREATE POLICY worker_read ON configuration_price_snapshots FOR SELECT TO app_worker USING (true);

CREATE POLICY tenant_all ON configuration_price_snapshot_lines FOR ALL TO app_tenant
  USING (EXISTS (SELECT 1 FROM configurations c WHERE c.id = configuration_price_snapshot_lines.configuration_id
                 AND c.reseller_id = (SELECT app_reseller_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM configurations c WHERE c.id = configuration_price_snapshot_lines.configuration_id
                 AND c.reseller_id = (SELECT app_reseller_id())));

CREATE POLICY tenant_all ON share_links FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY tenant_all ON share_link_views FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));

-- ---------------------------------------------------------------------------------------------
-- Requests. Customers (actor set) see only their own; internal notes are staff-only.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY tenant_all ON configuration_requests FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())
         AND ((SELECT app_actor_customer_id()) IS NULL OR customer_id = (SELECT app_actor_customer_id())))
  WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY worker_read ON configuration_requests FOR SELECT TO app_worker USING (true);

CREATE POLICY tenant_read ON request_status_history FOR SELECT TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())
         AND EXISTS (SELECT 1 FROM configuration_requests r WHERE r.id = request_status_history.request_id));
CREATE POLICY worker_read ON request_status_history FOR SELECT TO app_worker USING (true);

CREATE POLICY tenant_staff_only ON request_notes FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id()) AND (SELECT app_actor_customer_id()) IS NULL)
  WITH CHECK (reseller_id = (SELECT app_reseller_id()) AND (SELECT app_actor_customer_id()) IS NULL);

CREATE POLICY tenant_all ON request_quotes FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())
         AND EXISTS (SELECT 1 FROM configuration_requests r WHERE r.id = request_quotes.request_id))
  WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY worker_read ON request_quotes FOR SELECT TO app_worker USING (true);

-- ---------------------------------------------------------------------------------------------
-- Platform tables
-- ---------------------------------------------------------------------------------------------
CREATE POLICY tenant_enqueue ON notification_outbox FOR INSERT TO app_tenant
  WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY platform_enqueue ON notification_outbox FOR INSERT TO app_platform WITH CHECK (true);
CREATE POLICY worker_all ON notification_outbox FOR ALL TO app_worker USING (true) WITH CHECK (true);

CREATE POLICY tenant_read ON audit_events FOR SELECT TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY tenant_insert ON audit_events FOR INSERT TO app_tenant
  WITH CHECK (reseller_id = (SELECT app_reseller_id()));
CREATE POLICY platform_all ON audit_events FOR ALL TO app_platform USING (true) WITH CHECK (true);
CREATE POLICY worker_insert ON audit_events FOR INSERT TO app_worker WITH CHECK (true);

-- =============================================================================================
-- Grants (least privilege). Nothing is granted to PUBLIC.
-- =============================================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Reference data: readable by all application roles.
GRANT SELECT ON currencies, countries, request_statuses, request_status_transitions, asset_roles, reserved_slugs,
                manufacturers, attribute_definitions, attribute_definition_translations
  TO app_tenant, app_platform, app_worker, catalog_admin;

-- ---- app_tenant: storefront, customer, reseller admin, asset signer ----
GRANT SELECT ON resellers TO app_tenant;
GRANT UPDATE (default_share_expiry_days) ON resellers TO app_tenant;
GRANT SELECT, INSERT, UPDATE ON reseller_branding TO app_tenant;
GRANT SELECT, INSERT, DELETE ON assets TO app_tenant;
-- Names only (history / notes show who acted); e-mail and IdP subject go through
-- staff_principal_for_reseller() / staff_by_email().
GRANT SELECT (id, display_name) ON staff_users TO app_tenant;
GRANT UPDATE (display_name) ON staff_users TO app_tenant;
GRANT SELECT ON reseller_admins TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON customers, customer_addresses TO app_tenant;
GRANT SELECT, INSERT ON customer_consents TO app_tenant;
GRANT UPDATE (withdrawn_at) ON customer_consents TO app_tenant;
GRANT SELECT ON sauna_models, sauna_model_translations, sauna_model_attributes, sauna_model_prices,
                option_groups, option_group_translations, options, option_translations,
                sauna_model_option_groups, sauna_model_options, sauna_model_option_prices,
                option_requires, option_excludes, room_scenes, room_scene_translations,
                sauna_model_assets, option_assets, room_scene_assets
  TO app_tenant;
GRANT SELECT ON reseller_saunas, reseller_room_scenes TO app_tenant;
GRANT UPDATE (is_visible, sort_order) ON reseller_saunas TO app_tenant;
GRANT UPDATE (sort_order) ON reseller_room_scenes TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON reseller_sauna_discounts, reseller_default_discounts TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON configurations, configuration_room_placements,
                                        configuration_price_snapshots, configuration_price_snapshot_lines TO app_tenant;
GRANT SELECT, INSERT, DELETE ON configuration_selections TO app_tenant;
GRANT SELECT, INSERT ON share_links, share_link_views TO app_tenant;
GRANT UPDATE (revoked_at) ON share_links TO app_tenant;
GRANT SELECT, INSERT ON configuration_requests TO app_tenant;
GRANT UPDATE (status_code) ON configuration_requests TO app_tenant;
GRANT SELECT ON request_status_history TO app_tenant;
GRANT SELECT, INSERT ON request_notes, request_quotes TO app_tenant;
GRANT INSERT ON notification_outbox TO app_tenant;
GRANT SELECT, INSERT ON audit_events TO app_tenant;

-- ---- app_platform: manufacturer admin. No customer PII, no configurations, no requests. ----
GRANT SELECT, INSERT, UPDATE ON resellers, reseller_branding TO app_platform;
GRANT SELECT, INSERT ON assets TO app_platform;
GRANT SELECT, INSERT, UPDATE ON staff_users TO app_platform;
GRANT SELECT, INSERT, DELETE ON manufacturer_admins TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON reseller_admins TO app_platform;
GRANT SELECT ON sauna_models, sauna_model_translations, sauna_model_attributes, sauna_model_prices,
                option_groups, option_group_translations, options, option_translations,
                sauna_model_option_groups, sauna_model_options, sauna_model_option_prices,
                option_requires, option_excludes, room_scenes, room_scene_translations,
                sauna_model_assets, option_assets, room_scene_assets
  TO app_platform;
GRANT INSERT, UPDATE, DELETE ON sauna_model_prices, sauna_model_option_prices TO app_platform;
GRANT UPDATE (status, sort_order) ON sauna_models TO app_platform;
GRANT UPDATE (status, sort_order) ON room_scenes TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON reseller_saunas, reseller_room_scenes TO app_platform;
GRANT SELECT ON reseller_sauna_discounts, reseller_default_discounts TO app_platform;
GRANT INSERT ON notification_outbox TO app_platform;
GRANT SELECT, INSERT ON audit_events TO app_platform;

-- ---- app_worker: outbox, suppressions, KVS sync, e-mail rendering, retention (review C3) ----
GRANT SELECT ON resellers, reseller_branding, assets, reseller_admins TO app_worker;
GRANT SELECT (id, email, display_name, status) ON staff_users TO app_worker;
GRANT SELECT (id, reseller_id, email, first_name, locale, status) ON customers TO app_worker;
GRANT SELECT ON sauna_models, sauna_model_translations, options, option_translations,
                option_groups, option_group_translations TO app_worker;
GRANT SELECT (id, reseller_id, sauna_model_id, customer_id, name, locked_at, created_at) ON configurations TO app_worker;
GRANT SELECT ON configuration_price_snapshots TO app_worker;
GRANT SELECT (id, reseller_id, customer_id, configuration_id, status_code, created_at, updated_at)
  ON configuration_requests TO app_worker;
GRANT SELECT ON request_status_history, request_quotes TO app_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_outbox, email_suppressions TO app_worker;
GRANT INSERT ON audit_events TO app_worker;

-- ---- catalog_admin: import pipeline. Catalog + catalog assets; no tenant data. ----
GRANT SELECT, INSERT, UPDATE, DELETE ON
  sauna_models, sauna_model_translations, attribute_definitions, attribute_definition_translations,
  sauna_model_attributes, sauna_model_prices, option_groups, option_group_translations, options,
  option_translations, sauna_model_option_groups, sauna_model_options, sauna_model_option_prices,
  option_requires, option_excludes, room_scenes, room_scene_translations,
  sauna_model_assets, option_assets, room_scene_assets, assets
  TO catalog_admin;

-- Helper functions used inside policies and invoker triggers.
GRANT EXECUTE ON FUNCTION app_setting_uuid(text), app_reseller_id(), app_actor_staff_id(), app_actor_customer_id(),
                          app_actor_kind(), raise_rule(text, text, text), app_reseller_currency(), app_offers_model(uuid),
                          is_active_reseller_admin(uuid, uuid), assert_reseller_staff(uuid, uuid)
  TO app_tenant, app_platform, app_worker, catalog_admin;

-- =============================================================================================
-- SECURITY DEFINER API functions. Owner = migration superuser; search_path pinned;
-- EXECUTE only for the roles named. They return the minimum the caller needs.
-- =============================================================================================

-- Tenant resolution from the Host header, before any tenant is set. Suspended tenants are
-- returned too; the API decides. Callable by the login itself (outside SET ROLE).
CREATE FUNCTION resolve_tenant(p_slug text)
RETURNS TABLE (id uuid, slug text, status text, currency_code char(3), catalog_version bigint, manufacturer_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.slug, r.status, r.currency_code, r.catalog_version, r.manufacturer_id
  FROM resellers r WHERE r.slug = lower(btrim(p_slug))
$$;
GRANT EXECUTE ON FUNCTION resolve_tenant(text) TO app_tenant, app_platform, app_worker, sauna_api;

-- Staff principal on a reseller host: only ACTIVE staff who administer that reseller.
CREATE FUNCTION staff_principal_for_reseller(p_idp_subject text, p_reseller_id uuid)
RETURNS TABLE (staff_user_id uuid, email text, display_name text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.email, s.display_name, ra.role, s.status
  FROM staff_users s JOIN reseller_admins ra ON ra.staff_user_id = s.id
  WHERE s.idp_subject = p_idp_subject AND ra.reseller_id = p_reseller_id AND s.status = 'ACTIVE'
$$;
GRANT EXECUTE ON FUNCTION staff_principal_for_reseller(text, uuid) TO app_tenant;

-- Staff principal on the manufacturer admin host (any status; the API rejects non-ACTIVE).
CREATE FUNCTION staff_principal_for_manufacturer(p_idp_subject text)
RETURNS TABLE (staff_user_id uuid, email text, display_name text, manufacturer_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.email, s.display_name, ma.manufacturer_id, s.status
  FROM staff_users s JOIN manufacturer_admins ma ON ma.staff_user_id = s.id
  WHERE s.idp_subject = p_idp_subject
$$;
GRANT EXECUTE ON FUNCTION staff_principal_for_manufacturer(text) TO app_platform;

-- Staff login: e-mail -> IdP subject and status (staff IdP username = lower(email)).
CREATE FUNCTION staff_by_email(p_email text)
RETURNS TABLE (staff_user_id uuid, idp_subject text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.idp_subject, s.status FROM staff_users s WHERE lower(s.email) = lower(btrim(p_email))
$$;
GRANT EXECUTE ON FUNCTION staff_by_email(text) TO app_tenant, app_platform;

-- First successful login: INVITED -> ACTIVE. Returns true when the row changed.
-- DISABLED staff are never re-activated here.
CREATE FUNCTION activate_staff_user(p_idp_subject text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE staff_users SET status = 'ACTIVE' WHERE idp_subject = p_idp_subject AND status = 'INVITED';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END
$$;
GRANT EXECUTE ON FUNCTION activate_staff_user(text) TO app_tenant, app_platform;

-- Manufacturer analytics without PII (A10): counts only. p_reseller_id NULL = every reseller;
-- p_since limits every count to rows created (views: viewed) at or after it; NULL = all time.
CREATE FUNCTION reseller_stats(p_reseller_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS TABLE (
  reseller_id uuid, customers bigint, configurations bigint, locked_configurations bigint,
  share_links bigint, share_link_views bigint, requests bigint, requests_open bigint, requests_accepted bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id,
    (SELECT count(*) FROM customers c WHERE c.reseller_id = r.id AND c.status = 'ACTIVE'
       AND (p_since IS NULL OR c.created_at >= p_since)),
    (SELECT count(*) FROM configurations c WHERE c.reseller_id = r.id AND (p_since IS NULL OR c.created_at >= p_since)),
    (SELECT count(*) FROM configurations c WHERE c.reseller_id = r.id AND c.locked_at IS NOT NULL
       AND (p_since IS NULL OR c.created_at >= p_since)),
    (SELECT count(*) FROM share_links s WHERE s.reseller_id = r.id AND (p_since IS NULL OR s.created_at >= p_since)),
    (SELECT count(*) FROM share_link_views v WHERE v.reseller_id = r.id AND (p_since IS NULL OR v.viewed_at >= p_since)),
    (SELECT count(*) FROM configuration_requests q WHERE q.reseller_id = r.id AND (p_since IS NULL OR q.created_at >= p_since)),
    (SELECT count(*) FROM configuration_requests q JOIN request_statuses st ON st.code = q.status_code
       WHERE q.reseller_id = r.id AND NOT st.is_terminal AND (p_since IS NULL OR q.created_at >= p_since)),
    (SELECT count(*) FROM configuration_requests q WHERE q.reseller_id = r.id AND q.status_code IN ('ACCEPTED', 'CLOSED')
       AND (p_since IS NULL OR q.created_at >= p_since))
  FROM resellers r
  WHERE p_reseller_id IS NULL OR r.id = p_reseller_id
  ORDER BY r.slug
$$;
GRANT EXECUTE ON FUNCTION reseller_stats(uuid, timestamptz) TO app_platform;

CREATE FUNCTION reseller_request_status_counts(p_reseller_id uuid)
RETURNS TABLE (reseller_id uuid, status_code text, requests bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT q.reseller_id, q.status_code, count(*)
  FROM configuration_requests q
  WHERE p_reseller_id IS NULL OR q.reseller_id = p_reseller_id
  GROUP BY q.reseller_id, q.status_code
  ORDER BY q.reseller_id, q.status_code
$$;
GRANT EXECUTE ON FUNCTION reseller_request_status_counts(uuid) TO app_platform;

GRANT EXECUTE ON FUNCTION bump_all_catalog_versions() TO catalog_admin, app_platform;

-- GDPR erasure (design 15.3). SECURITY INVOKER: runs under the tenant's RLS, so it can only
-- anonymise a customer of the current tenant. Consent history is kept, addresses are deleted.
CREATE FUNCTION anonymise_customer(p_customer_id uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM customer_addresses WHERE customer_id = p_customer_id;
  UPDATE customers
     SET email = 'anonymised+' || id || '@invalid', first_name = NULL, last_name = NULL, phone = NULL,
         status = 'ANONYMISED'
   WHERE id = p_customer_id AND status <> 'ANONYMISED';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END
$$;
GRANT EXECUTE ON FUNCTION anonymise_customer(uuid) TO app_tenant;

-- Retention (design 15.3 defaults) for the worker. Returns deleted row counts.
CREATE FUNCTION run_retention() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_views bigint; v_audit bigint; v_outbox bigint; v_pending bigint;
BEGIN
  DELETE FROM share_link_views WHERE viewed_at < now() - interval '13 months';
  GET DIAGNOSTICS v_views = ROW_COUNT;
  DELETE FROM audit_events WHERE occurred_at < now() - interval '24 months';
  GET DIAGNOSTICS v_audit = ROW_COUNT;
  DELETE FROM notification_outbox WHERE sent_at < now() - interval '30 days';
  GET DIAGNOSTICS v_outbox = ROW_COUNT;
  -- Unconfirmed sign-ups older than 7 days (review G3); never ones that own data.
  DELETE FROM customers c
   WHERE c.status = 'PENDING' AND c.created_at < now() - interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM configurations x WHERE x.customer_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM share_links s WHERE s.created_by_customer_id = c.id);
  GET DIAGNOSTICS v_pending = ROW_COUNT;
  RETURN jsonb_build_object('shareLinkViews', v_views, 'auditEvents', v_audit,
                            'sentOutbox', v_outbox, 'pendingCustomers', v_pending);
END
$$;
GRANT EXECUTE ON FUNCTION run_retention() TO app_worker;
