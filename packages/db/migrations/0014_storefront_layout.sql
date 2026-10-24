-- 0014 Storefront layout chosen by the reseller (one of five storefront presentations).
--
-- A plain column on reseller_branding: the existing policies (tenant_all for the own tenant,
-- platform_all, worker_read) and the table-level grants (app_tenant SELECT/INSERT/UPDATE,
-- app_platform SELECT/INSERT/UPDATE, app_worker SELECT) already cover it, as they cover the
-- other branding columns. Existing rows get the default.
ALTER TABLE reseller_branding
  ADD COLUMN storefront_layout text NOT NULL DEFAULT 'atelier'
    CHECK (storefront_layout IN ('atelier', 'showroom', 'nordic', 'catalogue', 'journal'));
