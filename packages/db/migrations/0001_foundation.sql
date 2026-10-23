-- 0001 Foundation: database roles, session-context helpers, rule errors, reference tables.
--
-- Roles are cluster-wide objects, so creation is idempotent (several databases, for example the
-- per-file test databases, share one cluster). Everything else in this file is per database.

-- ---------------------------------------------------------------------------------------------
-- Roles (design 7.6, review C3). NOLOGIN group roles; logins are members that SET LOCAL ROLE.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_tenant', 'app_platform', 'app_worker', 'catalog_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN', r);
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL; -- created concurrently by another database's migration
      END;
    END IF;
  END LOOP;

  -- The API login. No password here: production uses IAM authentication; the local password is
  -- set by migrations/local. NOINHERIT: it holds no privileges until it does SET LOCAL ROLE.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sauna_api') THEN
    BEGIN
      CREATE ROLE sauna_api LOGIN NOINHERIT;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
END
$$;

ALTER ROLE sauna_api LOGIN NOINHERIT;
GRANT app_tenant, app_platform, app_worker TO sauna_api;

-- Nobody but the owner creates objects; app roles only use the schema.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_tenant, app_platform, app_worker, catalog_admin;

-- Functions created from here on are not executable by PUBLIC unless granted explicitly
-- (pg_default_acl is per database; the per-schema form cannot revoke the PUBLIC default).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Session context. The API sets these with set_config(name, value, true) (transaction-local)
-- right after SET LOCAL ROLE. Malformed or missing values read as NULL, so policies fail closed.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app_setting_uuid(setting text) RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
           WHEN v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v::uuid
         END
  FROM (SELECT current_setting(setting, true) AS v) s
$$;

CREATE FUNCTION app_reseller_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$ SELECT app_setting_uuid('app.reseller_id') $$;

CREATE FUNCTION app_actor_staff_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$ SELECT app_setting_uuid('app.actor_staff_id') $$;

CREATE FUNCTION app_actor_customer_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$ SELECT app_setting_uuid('app.actor_customer_id') $$;

-- CUSTOMER, STAFF or SYSTEM (neither set). Both set is a programming error: AMBIGUOUS.
CREATE FUNCTION app_actor_kind() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT CASE
           WHEN app_actor_customer_id() IS NOT NULL AND app_actor_staff_id() IS NOT NULL THEN 'AMBIGUOUS'
           WHEN app_actor_customer_id() IS NOT NULL THEN 'CUSTOMER'
           WHEN app_actor_staff_id() IS NOT NULL THEN 'STAFF'
           ELSE 'SYSTEM'
         END
$$;

-- ---------------------------------------------------------------------------------------------
-- Rule errors. Every business-rule trigger raises SQLSTATE P0001 with the message
-- "<CODE>: <text>", HINT = <CODE> and an optional machine-readable DETAIL (sub-reason).
-- The TypeScript helper dbErrorCode() extracts <CODE>.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION raise_rule(code text, message text, detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
BEGIN
  IF detail IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = code || ': ' || message, HINT = code;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = code || ': ' || message, HINT = code, DETAIL = detail;
END
$$;

-- Generic updated_at maintenance (attached to every table with the column in 0007).
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Append-only tables reject UPDATE (retention DELETEs run as the owner via run_retention()).
CREATE FUNCTION forbid_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM raise_rule('APPEND_ONLY', format('%s rows cannot be changed', TG_TABLE_NAME));
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------------------------
CREATE TABLE currencies (
  code        char(3)  PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4),
  name        text     NOT NULL
);

CREATE TABLE countries (
  code char(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name text    NOT NULL
);

-- Request workflow as data (design 9.4): states plus the allowed graph per actor kind.
CREATE TABLE request_statuses (
  code        text     PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]{1,31}$'),
  label       text     NOT NULL,
  is_terminal boolean  NOT NULL DEFAULT false,
  sort_order  smallint NOT NULL DEFAULT 0
);

CREATE TABLE request_status_transitions (
  from_code  text NOT NULL REFERENCES request_statuses (code),
  to_code    text NOT NULL REFERENCES request_statuses (code),
  actor_kind text NOT NULL CHECK (actor_kind IN ('CUSTOMER', 'STAFF', 'SYSTEM')),
  PRIMARY KEY (from_code, to_code, actor_kind),
  CHECK (from_code <> to_code)
);
CREATE INDEX request_status_transitions_to_idx ON request_status_transitions (to_code);

-- What a stored file is. The protection tier is a property of the role, never of the file.
CREATE TABLE asset_roles (
  code         text    PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  applies_to   text    NOT NULL CHECK (applies_to IN ('SAUNA_MODEL', 'OPTION', 'ROOM_SCENE', 'BRANDING')),
  tier         text    NOT NULL CHECK (tier IN ('PUBLIC', 'LOW', 'FULL', 'AR')),
  is_protected boolean GENERATED ALWAYS AS (tier <> 'PUBLIC') STORED,
  description  text,
  UNIQUE (code, applies_to)
);

CREATE TABLE reserved_slugs (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{1,32}$')
);
