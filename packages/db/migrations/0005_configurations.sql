-- 0005 Configurations, selections, room placement, price snapshots, share links.

CREATE TABLE configurations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id             uuid        NOT NULL,
  sauna_model_id          uuid        NOT NULL,
  customer_id             uuid,       -- NULL while a reseller admin prepares it
  created_by_staff_id     uuid        REFERENCES staff_users (id),
  name                    text        CHECK (length(name) <= 200),
  source_configuration_id uuid,       -- set when cloned from another configuration
  locked_at               timestamptz, -- immutable once set (rule 6)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configurations_owner CHECK (customer_id IS NOT NULL OR created_by_staff_id IS NOT NULL),
  CONSTRAINT configurations_id_reseller_key UNIQUE (id, reseller_id),
  CONSTRAINT configurations_id_model_key UNIQUE (id, sauna_model_id),
  CONSTRAINT configurations_id_reseller_customer_key UNIQUE (id, reseller_id, customer_id),
  -- Rule 4: only a sauna the reseller offers ...
  CONSTRAINT configurations_offered_fk FOREIGN KEY (reseller_id, sauna_model_id)
    REFERENCES reseller_saunas (reseller_id, sauna_model_id),
  -- ... and only a customer of the same reseller.
  CONSTRAINT configurations_customer_fk FOREIGN KEY (customer_id, reseller_id)
    REFERENCES customers (id, reseller_id),
  -- Clones stay inside the tenant.
  CONSTRAINT configurations_source_fk FOREIGN KEY (source_configuration_id, reseller_id)
    REFERENCES configurations (id, reseller_id)
);
CREATE INDEX configurations_reseller_created_idx ON configurations (reseller_id, created_at DESC);
CREATE INDEX configurations_offered_idx ON configurations (reseller_id, sauna_model_id);
CREATE INDEX configurations_model_idx ON configurations (sauna_model_id);
CREATE INDEX configurations_customer_idx ON configurations (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX configurations_staff_idx ON configurations (created_by_staff_id) WHERE created_by_staff_id IS NOT NULL;
CREATE INDEX configurations_source_idx ON configurations (source_configuration_id) WHERE source_configuration_id IS NOT NULL;

-- Chosen options. sauna_model_id is carried only so two composite FKs can prove that the option
-- is valid for the configuration's model (rule 5); it always equals the configuration's model.
CREATE TABLE configuration_selections (
  configuration_id uuid        NOT NULL,
  sauna_model_id   uuid        NOT NULL,
  option_id        uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (configuration_id, option_id),
  CONSTRAINT configuration_selections_configuration_fk FOREIGN KEY (configuration_id, sauna_model_id)
    REFERENCES configurations (id, sauna_model_id) ON DELETE CASCADE,
  CONSTRAINT configuration_selections_option_fk FOREIGN KEY (sauna_model_id, option_id)
    REFERENCES sauna_model_options (sauna_model_id, option_id)
);
CREATE INDEX configuration_selections_option_idx ON configuration_selections (sauna_model_id, option_id);

CREATE TABLE configuration_room_placements (
  configuration_id uuid         PRIMARY KEY,
  reseller_id      uuid         NOT NULL,
  room_scene_id    uuid         NOT NULL,
  position_x_mm    integer      NOT NULL DEFAULT 0 CHECK (position_x_mm BETWEEN -100000 AND 100000),
  position_z_mm    integer      NOT NULL DEFAULT 0 CHECK (position_z_mm BETWEEN -100000 AND 100000),
  rotation_deg     numeric(6,2) NOT NULL DEFAULT 0 CHECK (rotation_deg >= 0 AND rotation_deg < 360),
  scale            numeric(4,3) NOT NULL DEFAULT 1 CHECK (scale BETWEEN 0.5 AND 2),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  -- Only a room the reseller offers, only a configuration of the same reseller.
  CONSTRAINT configuration_room_placements_room_fk FOREIGN KEY (reseller_id, room_scene_id)
    REFERENCES reseller_room_scenes (reseller_id, room_scene_id),
  CONSTRAINT configuration_room_placements_configuration_fk FOREIGN KEY (configuration_id, reseller_id)
    REFERENCES configurations (id, reseller_id) ON DELETE CASCADE
);
CREATE INDEX configuration_room_placements_room_idx ON configuration_room_placements (reseller_id, room_scene_id);

-- Price frozen at lock time (a historical fact, design 7.2 exception 1). Arithmetic and cap are
-- re-checked here so no code path can store an inconsistent or over-discounted price (rule 8).
CREATE TABLE configuration_price_snapshots (
  configuration_id      uuid        PRIMARY KEY REFERENCES configurations (id) ON DELETE CASCADE,
  currency_code         char(3)     NOT NULL REFERENCES currencies (code),
  list_price_minor      bigint      NOT NULL CHECK (list_price_minor >= 0),
  options_total_minor   bigint      NOT NULL CHECK (options_total_minor >= 0),
  discount_amount_minor bigint      NOT NULL CHECK (discount_amount_minor >= 0),
  final_price_minor     bigint      NOT NULL CHECK (final_price_minor >= 0),
  discount_source       text        NOT NULL CHECK (discount_source IN ('SAUNA', 'DEFAULT', 'NONE')),
  discount_type         text        CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value        bigint      CHECK (discount_value >= 0),
  max_discount_bps      integer     NOT NULL CHECK (max_discount_bps BETWEEN 0 AND 10000),
  price_valid_until     timestamptz NOT NULL DEFAULT now() + interval '30 days',
  computed_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuration_price_snapshots_arithmetic
    CHECK (final_price_minor = list_price_minor + options_total_minor - discount_amount_minor),
  CONSTRAINT configuration_price_snapshots_discount_le_subtotal
    CHECK (discount_amount_minor <= list_price_minor + options_total_minor),
  -- floor(subtotal × cap / 10000): integer division of non-negative bigints floors.
  CONSTRAINT configuration_price_snapshots_discount_le_cap
    CHECK (discount_amount_minor <= (list_price_minor + options_total_minor) * max_discount_bps / 10000),
  CONSTRAINT configuration_price_snapshots_source_shape CHECK (
    (discount_source = 'NONE') = (discount_type IS NULL)
    AND (discount_type IS NULL) = (discount_value IS NULL)
    AND (discount_source <> 'NONE' OR discount_amount_minor = 0)
  ),
  CONSTRAINT configuration_price_snapshots_validity CHECK (price_valid_until > computed_at)
);

CREATE TABLE configuration_price_snapshot_lines (
  configuration_id  uuid   NOT NULL REFERENCES configuration_price_snapshots (configuration_id) ON DELETE CASCADE,
  option_id         uuid   NOT NULL REFERENCES options (id),
  price_delta_minor bigint NOT NULL CHECK (price_delta_minor >= 0),
  PRIMARY KEY (configuration_id, option_id)
);
CREATE INDEX configuration_price_snapshot_lines_option_idx ON configuration_price_snapshot_lines (option_id);

-- Share links: only the SHA-256 of the 256-bit token is stored (design 9.3).
CREATE TABLE share_links (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id            uuid        NOT NULL,
  configuration_id       uuid        NOT NULL,
  token_hash             bytea       NOT NULL CHECK (octet_length(token_hash) = 32),
  created_by_staff_id    uuid        REFERENCES staff_users (id),
  created_by_customer_id uuid,
  expires_at             timestamptz NOT NULL,
  revoked_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT share_links_token_hash_key UNIQUE (token_hash),
  CONSTRAINT share_links_id_reseller_key UNIQUE (id, reseller_id),
  CONSTRAINT share_links_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days'),
  CONSTRAINT share_links_revoked_after_created CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT share_links_one_creator CHECK (num_nonnulls(created_by_staff_id, created_by_customer_id) = 1),
  CONSTRAINT share_links_configuration_fk FOREIGN KEY (configuration_id, reseller_id)
    REFERENCES configurations (id, reseller_id),
  CONSTRAINT share_links_customer_fk FOREIGN KEY (created_by_customer_id, reseller_id)
    REFERENCES customers (id, reseller_id)
);
CREATE INDEX share_links_reseller_created_idx ON share_links (reseller_id, created_at DESC);
CREATE INDEX share_links_configuration_idx ON share_links (configuration_id, reseller_id);
CREATE INDEX share_links_expiry_idx ON share_links (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX share_links_staff_idx ON share_links (created_by_staff_id) WHERE created_by_staff_id IS NOT NULL;
CREATE INDEX share_links_customer_idx ON share_links (created_by_customer_id) WHERE created_by_customer_id IS NOT NULL;

-- Views: time and coarse device class only, never an IP address.
CREATE TABLE share_link_views (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  share_link_id uuid        NOT NULL,
  reseller_id   uuid        NOT NULL,
  viewed_at     timestamptz NOT NULL DEFAULT now(),
  device_class  text        NOT NULL DEFAULT 'OTHER' CHECK (device_class IN ('MOBILE', 'TABLET', 'DESKTOP', 'OTHER')),
  CONSTRAINT share_link_views_link_fk FOREIGN KEY (share_link_id, reseller_id)
    REFERENCES share_links (id, reseller_id) ON DELETE CASCADE
);
CREATE INDEX share_link_views_link_idx ON share_link_views (share_link_id, reseller_id);
CREATE INDEX share_link_views_reseller_idx ON share_link_views (reseller_id, viewed_at DESC);
-- Fastest-growing table: BRIN on the append-ordered timestamp for range scans and retention.
CREATE INDEX share_link_views_viewed_brin ON share_link_views USING brin (viewed_at);
