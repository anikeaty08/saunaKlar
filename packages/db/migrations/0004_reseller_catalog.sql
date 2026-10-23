-- 0004 Reseller catalog: assignment of saunas and rooms, visibility/order, discounts.

-- Which saunas a reseller offers. Assignability (same manufacturer, ACTIVE, priced in the
-- reseller currency incl. every option) is enforced by trigger (rule 2).
CREATE TABLE reseller_saunas (
  reseller_id    uuid        NOT NULL REFERENCES resellers (id) ON DELETE CASCADE,
  sauna_model_id uuid        NOT NULL REFERENCES sauna_models (id),
  is_visible     boolean     NOT NULL DEFAULT true,
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reseller_id, sauna_model_id)
);
CREATE INDEX reseller_saunas_model_idx ON reseller_saunas (sauna_model_id);
CREATE INDEX reseller_saunas_listing_idx ON reseller_saunas (reseller_id, sort_order) WHERE is_visible;

-- discount_value: basis points for PERCENT, minor units (reseller currency) for FIXED.
CREATE TABLE reseller_sauna_discounts (
  reseller_id    uuid        NOT NULL,
  sauna_model_id uuid        NOT NULL,
  discount_type  text        NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value bigint      NOT NULL CHECK (discount_value >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reseller_id, sauna_model_id),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 10000),
  CONSTRAINT reseller_sauna_discounts_sauna_fk FOREIGN KEY (reseller_id, sauna_model_id)
    REFERENCES reseller_saunas (reseller_id, sauna_model_id) ON DELETE CASCADE
);

CREATE TABLE reseller_default_discounts (
  reseller_id    uuid        PRIMARY KEY REFERENCES resellers (id) ON DELETE CASCADE,
  discount_type  text        NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value bigint      NOT NULL CHECK (discount_value >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 10000)
);

CREATE TABLE reseller_room_scenes (
  reseller_id   uuid        NOT NULL REFERENCES resellers (id) ON DELETE CASCADE,
  room_scene_id uuid        NOT NULL REFERENCES room_scenes (id),
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reseller_id, room_scene_id)
);
CREATE INDEX reseller_room_scenes_room_idx ON reseller_room_scenes (room_scene_id);
