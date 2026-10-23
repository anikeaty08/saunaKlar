-- 0002 Tenancy and identity: manufacturers, resellers (tenants), branding, assets, staff, customers.

CREATE TABLE manufacturers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A tenant. A new reseller is a row, not a deployment (design 5).
CREATE TABLE resellers (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id           uuid        NOT NULL REFERENCES manufacturers (id),
  -- Subdomain label: lowercase letters, digits, inner hyphens, 1-32 chars. Reserved words are
  -- rejected by trigger (they live in reserved_slugs so they can change without a migration).
  slug                      text        NOT NULL
                                        CONSTRAINT resellers_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$'),
  name                      text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  currency_code             char(3)     NOT NULL REFERENCES currencies (code),
  status                    text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  default_share_expiry_days smallint    NOT NULL DEFAULT 30 CHECK (default_share_expiry_days BETWEEN 1 AND 90),
  -- Cache-busting counter for the tenant's catalog responses (rule 9).
  catalog_version           bigint      NOT NULL DEFAULT 1 CHECK (catalog_version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resellers_slug_key UNIQUE (slug),
  -- Target of composite FKs that pin money columns to the reseller's currency.
  CONSTRAINT resellers_id_currency_key UNIQUE (id, currency_code)
);
CREATE INDEX resellers_manufacturer_idx ON resellers (manufacturer_id);

-- Every stored file. owner_reseller_id NULL = catalog asset (manufacturer), otherwise a branding
-- upload of that reseller. Keys are unguessable (random + content hash), never sequential.
CREATE TABLE assets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_reseller_id uuid        REFERENCES resellers (id),
  storage_key       text        NOT NULL
                                CHECK (length(storage_key) <= 512 AND storage_key ~ '^[A-Za-z0-9][A-Za-z0-9/._-]*$' AND storage_key !~ '\.\.|//'),
  content_type      text        NOT NULL CHECK (content_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  byte_size         bigint      CHECK (byte_size >= 0),
  sha256            char(64)    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width             integer     CHECK (width > 0),
  height            integer     CHECK (height > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_storage_key_key UNIQUE (storage_key),
  -- Key = URL path without the leading slash. Catalog files live under assets/lo|hi (protected) or
  -- media/ (public; the tier per role is checked on the link tables); reseller uploads under branding/.
  CONSTRAINT assets_storage_key_prefix CHECK (
    CASE WHEN owner_reseller_id IS NULL THEN storage_key ~ '^(assets/(lo|hi)|media)/'
         ELSE storage_key ~ '^branding/[a-z0-9-]+/' END),
  -- Lets branding reference "an asset of this reseller" structurally.
  CONSTRAINT assets_id_owner_key UNIQUE (id, owner_reseller_id)
);
CREATE INDEX assets_owner_idx ON assets (owner_reseller_id) WHERE owner_reseller_id IS NOT NULL;

CREATE TABLE reseller_branding (
  reseller_id      uuid        PRIMARY KEY REFERENCES resellers (id) ON DELETE CASCADE,
  display_name     text        NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  tagline          text        CHECK (length(tagline) <= 300),
  -- The single hue of the unary design language; lowercase hex.
  primary_color    char(7)     NOT NULL DEFAULT '#1a1a1a' CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
  logo_asset_id    uuid,
  favicon_asset_id uuid,
  support_email    text        CHECK (length(support_email) <= 254 AND support_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  support_phone    text        CHECK (length(support_phone) <= 40),
  legal_name       text        CHECK (length(legal_name) <= 200),
  legal_address    text        CHECK (length(legal_address) <= 500),
  vat_display      text        NOT NULL DEFAULT 'INCLUDED' CHECK (vat_display IN ('INCLUDED', 'EXCLUDED', 'NONE')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Logo and favicon must be uploads of this same reseller (composite FK, MATCH SIMPLE: NULL = none).
  CONSTRAINT reseller_branding_logo_fk FOREIGN KEY (logo_asset_id, reseller_id) REFERENCES assets (id, owner_reseller_id),
  CONSTRAINT reseller_branding_favicon_fk FOREIGN KEY (favicon_asset_id, reseller_id) REFERENCES assets (id, owner_reseller_id)
);
CREATE INDEX reseller_branding_logo_idx ON reseller_branding (logo_asset_id) WHERE logo_asset_id IS NOT NULL;
CREATE INDEX reseller_branding_favicon_idx ON reseller_branding (favicon_asset_id) WHERE favicon_asset_id IS NOT NULL;

-- Manufacturer and reseller admins (staff identity pool). Never hard-deleted.
CREATE TABLE staff_users (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  display_name text        NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  -- Subject of the identity provider (Cognito sub / local IdP sub); NULL until the IdP user exists.
  idp_subject  text        CHECK (length(idp_subject) BETWEEN 1 AND 128),
  status       text        NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_users_idp_subject_key UNIQUE (idp_subject)
);
CREATE UNIQUE INDEX staff_users_email_key ON staff_users (lower(email));

CREATE TABLE manufacturer_admins (
  staff_user_id   uuid        PRIMARY KEY REFERENCES staff_users (id),
  manufacturer_id uuid        NOT NULL REFERENCES manufacturers (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manufacturer_admins_manufacturer_idx ON manufacturer_admins (manufacturer_id);

CREATE TABLE reseller_admins (
  reseller_id   uuid        NOT NULL REFERENCES resellers (id) ON DELETE CASCADE,
  staff_user_id uuid        NOT NULL REFERENCES staff_users (id),
  role          text        NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('OWNER', 'ADMIN')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reseller_id, staff_user_id)
);
CREATE INDEX reseller_admins_staff_idx ON reseller_admins (staff_user_id);

-- Customer accounts are per reseller: the same e-mail can exist at two resellers (design 6.1).
CREATE TABLE customers (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id       uuid        NOT NULL REFERENCES resellers (id),
  email             text        NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  first_name        text        CHECK (length(first_name) <= 100),
  last_name         text        CHECK (length(last_name) <= 100),
  phone             text        CHECK (length(phone) <= 40),
  locale            text        NOT NULL DEFAULT 'en' CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  status            text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'ANONYMISED')),
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_id_reseller_key UNIQUE (id, reseller_id),
  -- An active account has a verified e-mail address.
  CONSTRAINT customers_active_verified CHECK (status <> 'ACTIVE' OR email_verified_at IS NOT NULL),
  -- Erasure (GDPR, design 15.3) removes every identifying column; the e-mail becomes a placeholder.
  CONSTRAINT customers_anonymised_empty CHECK (
    status <> 'ANONYMISED' OR (first_name IS NULL AND last_name IS NULL AND phone IS NULL)
  )
);
-- One live account per e-mail and reseller, case-insensitive; anonymised rows release the address.
CREATE UNIQUE INDEX customers_reseller_email_key ON customers (reseller_id, lower(email)) WHERE status <> 'ANONYMISED';
CREATE INDEX customers_reseller_created_idx ON customers (reseller_id, created_at DESC);
CREATE INDEX customers_pending_idx ON customers (created_at) WHERE status = 'PENDING';

CREATE TABLE customer_addresses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid        NOT NULL,
  reseller_id  uuid        NOT NULL,
  address_type text        NOT NULL CHECK (address_type IN ('BILLING', 'SHIPPING', 'SITE')),
  recipient    text        NOT NULL CHECK (length(btrim(recipient)) BETWEEN 1 AND 200),
  line1        text        NOT NULL CHECK (length(btrim(line1)) BETWEEN 1 AND 200),
  line2        text        CHECK (length(line2) <= 200),
  postal_code  text        NOT NULL CHECK (length(btrim(postal_code)) BETWEEN 1 AND 20),
  city         text        NOT NULL CHECK (length(btrim(city)) BETWEEN 1 AND 120),
  region       text        CHECK (length(region) <= 120),
  country_code char(2)     NOT NULL REFERENCES countries (code),
  is_default   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Same tenant as the customer, structurally.
  CONSTRAINT customer_addresses_customer_fk FOREIGN KEY (customer_id, reseller_id)
    REFERENCES customers (id, reseller_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX customer_addresses_default_key ON customer_addresses (customer_id, address_type) WHERE is_default;
CREATE INDEX customer_addresses_customer_idx ON customer_addresses (customer_id, reseller_id);
CREATE INDEX customer_addresses_reseller_idx ON customer_addresses (reseller_id, customer_id);

-- Versioned, timestamped consent log. Rows are never deleted on erasure (kept without identity).
CREATE TABLE customer_consents (
  customer_id  uuid        NOT NULL,
  reseller_id  uuid        NOT NULL,
  consent_type text        NOT NULL CHECK (consent_type IN ('TERMS', 'PRIVACY', 'MARKETING')),
  version      text        NOT NULL CHECK (length(btrim(version)) BETWEEN 1 AND 40),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  PRIMARY KEY (customer_id, consent_type, granted_at),
  CONSTRAINT customer_consents_customer_fk FOREIGN KEY (customer_id, reseller_id)
    REFERENCES customers (id, reseller_id) ON DELETE CASCADE,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
);
CREATE INDEX customer_consents_customer_idx ON customer_consents (customer_id, reseller_id);
CREATE INDEX customer_consents_reseller_idx ON customer_consents (reseller_id, customer_id);
