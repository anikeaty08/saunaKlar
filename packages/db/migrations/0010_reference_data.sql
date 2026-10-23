-- 0010 Reference data: currencies, countries, request workflow, asset roles, reserved slugs.

INSERT INTO currencies (code, minor_units, name) VALUES
  ('EUR', 2, 'Euro'),
  ('CHF', 2, 'Swiss franc'),
  ('SEK', 2, 'Swedish krona'),
  ('NOK', 2, 'Norwegian krone'),
  ('DKK', 2, 'Danish krone'),
  ('PLN', 2, 'Polish złoty'),
  ('CZK', 2, 'Czech koruna'),
  ('GBP', 2, 'Pound sterling');

-- EU 27 + EEA (IS, LI, NO) + CH + GB.
INSERT INTO countries (code, name) VALUES
  ('AT', 'Austria'), ('BE', 'Belgium'), ('BG', 'Bulgaria'), ('HR', 'Croatia'), ('CY', 'Cyprus'),
  ('CZ', 'Czechia'), ('DK', 'Denmark'), ('EE', 'Estonia'), ('FI', 'Finland'), ('FR', 'France'),
  ('DE', 'Germany'), ('GR', 'Greece'), ('HU', 'Hungary'), ('IE', 'Ireland'), ('IT', 'Italy'),
  ('LV', 'Latvia'), ('LT', 'Lithuania'), ('LU', 'Luxembourg'), ('MT', 'Malta'), ('NL', 'Netherlands'),
  ('PL', 'Poland'), ('PT', 'Portugal'), ('RO', 'Romania'), ('SK', 'Slovakia'), ('SI', 'Slovenia'),
  ('ES', 'Spain'), ('SE', 'Sweden'),
  ('IS', 'Iceland'), ('LI', 'Liechtenstein'), ('NO', 'Norway'),
  ('CH', 'Switzerland'), ('GB', 'United Kingdom');

INSERT INTO request_statuses (code, label, is_terminal, sort_order) VALUES
  ('SUBMITTED', 'Submitted', false, 10),
  ('IN_REVIEW', 'In review', false, 20),
  ('QUOTED',    'Quoted',    false, 30),
  ('ACCEPTED',  'Accepted',  false, 40),
  ('CLOSED',    'Closed',    true,  50),
  ('REJECTED',  'Rejected',  true,  60),
  ('CANCELLED', 'Cancelled', true,  70);

-- Design 9.4. STAFF works the request; CUSTOMER accepts a quote or cancels; SYSTEM (no actor,
-- e.g. account erasure jobs) may only cancel open requests.
INSERT INTO request_status_transitions (from_code, to_code, actor_kind) VALUES
  ('SUBMITTED', 'IN_REVIEW', 'STAFF'),
  ('SUBMITTED', 'REJECTED',  'STAFF'),
  ('SUBMITTED', 'CANCELLED', 'STAFF'),
  ('IN_REVIEW', 'QUOTED',    'STAFF'),
  ('IN_REVIEW', 'REJECTED',  'STAFF'),
  ('IN_REVIEW', 'CANCELLED', 'STAFF'),
  ('QUOTED',    'IN_REVIEW', 'STAFF'),   -- re-quote
  ('QUOTED',    'REJECTED',  'STAFF'),
  ('QUOTED',    'CANCELLED', 'STAFF'),
  ('ACCEPTED',  'CLOSED',    'STAFF'),   -- fulfilled
  ('ACCEPTED',  'CANCELLED', 'STAFF'),
  ('QUOTED',    'ACCEPTED',  'CUSTOMER'),
  ('SUBMITTED', 'CANCELLED', 'CUSTOMER'),
  ('IN_REVIEW', 'CANCELLED', 'CUSTOMER'),
  ('QUOTED',    'CANCELLED', 'CUSTOMER'),
  ('SUBMITTED', 'CANCELLED', 'SYSTEM'),
  ('IN_REVIEW', 'CANCELLED', 'SYSTEM'),
  ('QUOTED',    'CANCELLED', 'SYSTEM');

-- Tier: PUBLIC (thumbnails, branding; media/ prefix), LOW (anonymous low-LOD; assets/lo/),
-- FULL (logged-in / share viewers; assets/hi/), AR (short-lived signed URLs; assets/hi/).
INSERT INTO asset_roles (code, applies_to, tier, description) VALUES
  ('MODEL_GLB_LOW',    'SAUNA_MODEL', 'LOW',    'Low-LOD sauna mesh for anonymous visitors'),
  ('MODEL_GLB_HIGH',   'SAUNA_MODEL', 'FULL',   'Full-quality sauna mesh'),
  ('MODEL_AR_GLB',     'SAUNA_MODEL', 'AR',     'Reduced GLB for Android Scene Viewer / WebXR'),
  ('MODEL_AR_USDZ',    'SAUNA_MODEL', 'AR',     'USDZ for iOS AR Quick Look'),
  ('MODEL_THUMBNAIL',  'SAUNA_MODEL', 'PUBLIC', 'Catalog thumbnail'),
  ('MODEL_GALLERY',    'SAUNA_MODEL', 'PUBLIC', 'Gallery image (ordered by position)'),
  ('OPTION_GLB',       'OPTION',      'FULL',   'Per-option mesh or texture set'),
  ('OPTION_THUMBNAIL', 'OPTION',      'PUBLIC', 'Option swatch / thumbnail'),
  ('ROOM_GLB_LOW',     'ROOM_SCENE',  'LOW',    'Low-LOD room scene'),
  ('ROOM_GLB_HIGH',    'ROOM_SCENE',  'FULL',   'Full-quality room scene'),
  ('ROOM_THUMBNAIL',   'ROOM_SCENE',  'PUBLIC', 'Room thumbnail'),
  ('BRAND_LOGO',       'BRANDING',    'PUBLIC', 'Reseller logo'),
  ('BRAND_FAVICON',    'BRANDING',    'PUBLIC', 'Reseller favicon');

INSERT INTO reserved_slugs (slug) VALUES
  ('www'), ('api'), ('admin'), ('app'), ('assets'), ('static'), ('cdn'), ('mail'), ('smtp'),
  ('help'), ('support'), ('status'), ('docs'), ('blog'), ('dev'), ('staging'), ('test');
