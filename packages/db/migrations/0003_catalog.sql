-- 0003 Catalog: sauna models, specs, prices, option groups/options, option rules, rooms, files.
-- Written by the import pipeline (catalog_admin); prices also by the manufacturer admin.

CREATE TABLE sauna_models (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid        NOT NULL REFERENCES manufacturers (id),
  sku             text        NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  slug            text        NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  status          text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  name            text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description     text        CHECK (length(description) <= 5000),
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sauna_models_sku_key UNIQUE (sku),
  CONSTRAINT sauna_models_slug_key UNIQUE (slug)
);
CREATE INDEX sauna_models_manufacturer_idx ON sauna_models (manufacturer_id, sort_order);

CREATE TABLE sauna_model_translations (
  sauna_model_id uuid NOT NULL REFERENCES sauna_models (id) ON DELETE CASCADE,
  locale         text NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description    text CHECK (length(description) <= 5000),
  PRIMARY KEY (sauna_model_id, locale)
);

-- Technical specs as dictionary + values (4NF: independent facts in their own table).
CREATE TABLE attribute_definitions (
  code       text     PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$'),
  label      text     NOT NULL,
  unit       text,
  value_type text     NOT NULL CHECK (value_type IN ('NUMBER', 'TEXT', 'BOOLEAN')),
  sort_order smallint NOT NULL DEFAULT 0
);

CREATE TABLE sauna_model_attributes (
  sauna_model_id uuid    NOT NULL REFERENCES sauna_models (id) ON DELETE CASCADE,
  attribute_code text    NOT NULL REFERENCES attribute_definitions (code),
  value_number   numeric,
  value_text     text    CHECK (length(value_text) <= 1000),
  value_bool     boolean,
  PRIMARY KEY (sauna_model_id, attribute_code),
  CHECK (num_nonnulls(value_number, value_text, value_bool) = 1)
);
CREATE INDEX sauna_model_attributes_code_idx ON sauna_model_attributes (attribute_code);

-- List ("max") price and the reseller discount cap per model and currency.
CREATE TABLE sauna_model_prices (
  sauna_model_id   uuid        NOT NULL REFERENCES sauna_models (id) ON DELETE CASCADE,
  currency_code    char(3)     NOT NULL REFERENCES currencies (code),
  list_price_minor bigint      NOT NULL CHECK (list_price_minor >= 0),
  max_discount_bps integer     NOT NULL CHECK (max_discount_bps BETWEEN 0 AND 10000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sauna_model_id, currency_code)
);

CREATE TABLE option_groups (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text        NOT NULL CHECK (code ~ '^[a-z][a-z0-9-]{0,62}$'),
  name           text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  selection_type text        NOT NULL CHECK (selection_type IN ('SINGLE', 'MULTI')),
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT option_groups_code_key UNIQUE (code)
);

CREATE TABLE option_group_translations (
  option_group_id uuid NOT NULL REFERENCES option_groups (id) ON DELETE CASCADE,
  locale          text NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  PRIMARY KEY (option_group_id, locale)
);

CREATE TABLE options (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  option_group_id uuid        NOT NULL REFERENCES option_groups (id),
  code            text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name            text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description     text        CHECK (length(description) <= 2000),
  swatch_color    char(7)     CHECK (swatch_color ~ '^#[0-9a-f]{6}$'),
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT options_group_code_key UNIQUE (option_group_id, code),
  -- Target of the composite FK that pins a model option to the option's real group.
  CONSTRAINT options_id_group_key UNIQUE (id, option_group_id)
);

CREATE TABLE option_translations (
  option_id   uuid NOT NULL REFERENCES options (id) ON DELETE CASCADE,
  locale      text NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text CHECK (length(description) <= 2000),
  PRIMARY KEY (option_id, locale)
);

-- Which option groups a model exposes, and whether a choice is mandatory.
CREATE TABLE sauna_model_option_groups (
  sauna_model_id  uuid    NOT NULL REFERENCES sauna_models (id) ON DELETE CASCADE,
  option_group_id uuid    NOT NULL REFERENCES option_groups (id),
  is_required     boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (sauna_model_id, option_group_id)
);
CREATE INDEX sauna_model_option_groups_group_idx ON sauna_model_option_groups (option_group_id);

-- Which options are valid for a model. The two composite FKs guarantee that the option belongs to
-- a group the model exposes (design 7.5 "option must belong to a group the model exposes").
CREATE TABLE sauna_model_options (
  sauna_model_id  uuid    NOT NULL,
  option_id       uuid    NOT NULL,
  option_group_id uuid    NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (sauna_model_id, option_id),
  CONSTRAINT sauna_model_options_group_fk FOREIGN KEY (sauna_model_id, option_group_id)
    REFERENCES sauna_model_option_groups (sauna_model_id, option_group_id) ON DELETE CASCADE,
  CONSTRAINT sauna_model_options_option_fk FOREIGN KEY (option_id, option_group_id)
    REFERENCES options (id, option_group_id)
);
CREATE INDEX sauna_model_options_group_idx ON sauna_model_options (sauna_model_id, option_group_id);
CREATE INDEX sauna_model_options_option_idx ON sauna_model_options (option_id, option_group_id);

CREATE TABLE sauna_model_option_prices (
  sauna_model_id    uuid        NOT NULL,
  option_id         uuid        NOT NULL,
  currency_code     char(3)     NOT NULL REFERENCES currencies (code),
  price_delta_minor bigint      NOT NULL CHECK (price_delta_minor >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sauna_model_id, option_id, currency_code),
  CONSTRAINT sauna_model_option_prices_option_fk FOREIGN KEY (sauna_model_id, option_id)
    REFERENCES sauna_model_options (sauna_model_id, option_id) ON DELETE CASCADE
);

-- "option_id can only be chosen together with required_option_id" (both offered by the model).
CREATE TABLE option_requires (
  sauna_model_id     uuid NOT NULL,
  option_id          uuid NOT NULL,
  required_option_id uuid NOT NULL,
  PRIMARY KEY (sauna_model_id, option_id, required_option_id),
  CHECK (option_id <> required_option_id),
  CONSTRAINT option_requires_option_fk FOREIGN KEY (sauna_model_id, option_id)
    REFERENCES sauna_model_options (sauna_model_id, option_id) ON DELETE CASCADE,
  CONSTRAINT option_requires_required_fk FOREIGN KEY (sauna_model_id, required_option_id)
    REFERENCES sauna_model_options (sauna_model_id, option_id) ON DELETE CASCADE
);
CREATE INDEX option_requires_required_idx ON option_requires (sauna_model_id, required_option_id);

-- Mutually exclusive pair, stored once (a < b) so (a,b) and (b,a) cannot both exist.
CREATE TABLE option_excludes (
  sauna_model_id uuid NOT NULL,
  option_a_id    uuid NOT NULL,
  option_b_id    uuid NOT NULL,
  PRIMARY KEY (sauna_model_id, option_a_id, option_b_id),
  CHECK (option_a_id < option_b_id),
  CONSTRAINT option_excludes_a_fk FOREIGN KEY (sauna_model_id, option_a_id)
    REFERENCES sauna_model_options (sauna_model_id, option_id) ON DELETE CASCADE,
  CONSTRAINT option_excludes_b_fk FOREIGN KEY (sauna_model_id, option_b_id)
    REFERENCES sauna_model_options (sauna_model_id, option_id) ON DELETE CASCADE
);
CREATE INDEX option_excludes_b_idx ON option_excludes (sauna_model_id, option_b_id);

-- Preset 3D room environments. preset holds parametric room parameters for scenes without a GLB,
-- e.g. {"floorMaterial":"oak","wallColor":"#efe9df","widthMm":4000,"depthMm":3500,"heightMm":2600}.
CREATE TABLE room_scenes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid        NOT NULL REFERENCES manufacturers (id),
  code            text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name            text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description     text        CHECK (length(description) <= 2000),
  status          text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  preset          jsonb       CHECK (preset IS NULL OR jsonb_typeof(preset) = 'object'),
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_scenes_code_key UNIQUE (code)
);
CREATE INDEX room_scenes_manufacturer_idx ON room_scenes (manufacturer_id);

-- Files per entity. The constant applies_to column exists only so the composite FK to asset_roles
-- rejects, for example, a room role on a sauna model (design 7.2 exception 5).
-- position orders gallery images; every other role has exactly one file (position 0).
CREATE TABLE sauna_model_assets (
  sauna_model_id uuid     NOT NULL REFERENCES sauna_models (id) ON DELETE CASCADE,
  asset_role     text     NOT NULL,
  applies_to     text     NOT NULL DEFAULT 'SAUNA_MODEL' CHECK (applies_to = 'SAUNA_MODEL'),
  position       smallint NOT NULL DEFAULT 0 CHECK (position >= 0),
  asset_id       uuid     NOT NULL REFERENCES assets (id),
  PRIMARY KEY (sauna_model_id, asset_role, position),
  CHECK (position = 0 OR asset_role = 'MODEL_GALLERY'),
  CONSTRAINT sauna_model_assets_role_fk FOREIGN KEY (asset_role, applies_to) REFERENCES asset_roles (code, applies_to)
);
CREATE INDEX sauna_model_assets_asset_idx ON sauna_model_assets (asset_id);

CREATE TABLE option_assets (
  option_id  uuid NOT NULL REFERENCES options (id) ON DELETE CASCADE,
  asset_role text NOT NULL,
  applies_to text NOT NULL DEFAULT 'OPTION' CHECK (applies_to = 'OPTION'),
  asset_id   uuid NOT NULL REFERENCES assets (id),
  PRIMARY KEY (option_id, asset_role),
  CONSTRAINT option_assets_role_fk FOREIGN KEY (asset_role, applies_to) REFERENCES asset_roles (code, applies_to)
);
CREATE INDEX option_assets_asset_idx ON option_assets (asset_id);

CREATE TABLE room_scene_assets (
  room_scene_id uuid NOT NULL REFERENCES room_scenes (id) ON DELETE CASCADE,
  asset_role    text NOT NULL,
  applies_to    text NOT NULL DEFAULT 'ROOM_SCENE' CHECK (applies_to = 'ROOM_SCENE'),
  asset_id      uuid NOT NULL REFERENCES assets (id),
  PRIMARY KEY (room_scene_id, asset_role),
  CONSTRAINT room_scene_assets_role_fk FOREIGN KEY (asset_role, applies_to) REFERENCES asset_roles (code, applies_to)
);
CREATE INDEX room_scene_assets_asset_idx ON room_scene_assets (asset_id);
