-- local/0001 Local-only objects (applied only with LOCAL_IDP=1): the local identity provider
-- (schema idp, emulating Cognito's two pools), the dev mailbox (schema devtools) and the local
-- password of the API login. Never applied in production.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'idp_local') THEN
    BEGIN
      CREATE ROLE idp_local NOLOGIN;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sauna_api') THEN
    BEGIN
      CREATE ROLE sauna_api LOGIN NOINHERIT;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
END
$$;

-- Local development password (production authenticates with IAM tokens).
ALTER ROLE sauna_api WITH LOGIN NOINHERIT PASSWORD 'sauna_api';
GRANT idp_local TO sauna_api;

CREATE SCHEMA idp;

-- One row per identity. Customers: sub = customers.id and username = customers.id (design 6.1);
-- staff: sub = staff_users.idp_subject and username = lower(email).
-- password_hash format: scrypt$N$r$p$<salt base64>$<hash base64> (keylen 64), see src/password.ts.
CREATE TABLE idp.users (
  sub            uuid        PRIMARY KEY,
  pool           text        NOT NULL CHECK (pool IN ('CUSTOMER', 'STAFF')),
  username       text        NOT NULL CHECK (length(username) BETWEEN 1 AND 254),
  email          text        NOT NULL CHECK (length(email) <= 254),
  email_verified boolean     NOT NULL DEFAULT false,
  password_hash  text        CHECK (password_hash ~ '^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
  status         text        NOT NULL DEFAULT 'UNCONFIRMED'
                             CHECK (status IN ('UNCONFIRMED', 'CONFIRMED', 'DISABLED', 'FORCE_CHANGE_PASSWORD')),
  mfa_secret     text,
  mfa_enabled    boolean     NOT NULL DEFAULT false,
  attributes     jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pool_username_key UNIQUE (pool, username),
  CHECK (NOT mfa_enabled OR mfa_secret IS NOT NULL)
);
CREATE INDEX users_pool_email_idx ON idp.users (pool, lower(email));
CREATE TRIGGER set_updated_at BEFORE UPDATE ON idp.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- One-time codes (sign-up confirmation, password reset, staff invitation); hashed, short-lived.
CREATE TABLE idp.codes (
  sub        uuid        NOT NULL REFERENCES idp.users (sub) ON DELETE CASCADE,
  purpose    text        NOT NULL CHECK (purpose IN ('SIGNUP', 'RESET', 'INVITE')),
  code_hash  text        NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sub, purpose)
);

-- Refresh-token rotation: a reused (already replaced) token revokes its whole family.
CREATE TABLE idp.refresh_tokens (
  token_hash  bytea       PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  sub         uuid        NOT NULL REFERENCES idp.users (sub) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by bytea       CHECK (replaced_by IS NULL OR octet_length(replaced_by) = 32),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_sub_idx ON idp.refresh_tokens (sub);
CREATE INDEX refresh_tokens_family_idx ON idp.refresh_tokens (family_id);

-- Pending login challenges (Cognito "session"): MFA setup, TOTP, forced password change.
CREATE TABLE idp.mfa_challenges (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sub        uuid        NOT NULL REFERENCES idp.users (sub) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('MFA_SETUP', 'SOFTWARE_TOKEN_MFA', 'NEW_PASSWORD_REQUIRED')),
  attempts   integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_sub_idx ON idp.mfa_challenges (sub);

REVOKE ALL ON SCHEMA idp FROM PUBLIC;
GRANT USAGE ON SCHEMA idp TO idp_local;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA idp TO idp_local;

-- Dev mailbox: the local Mailer writes here; /dev/mailbox shows it.
CREATE SCHEMA devtools;
CREATE TABLE devtools.mailbox (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_address  text        NOT NULL,
  subject     text        NOT NULL,
  html        text,
  text        text,
  reseller_id uuid        REFERENCES public.resellers (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mailbox_to_idx ON devtools.mailbox (lower(to_address), id DESC);
CREATE INDEX mailbox_reseller_idx ON devtools.mailbox (reseller_id, id DESC);

REVOKE ALL ON SCHEMA devtools FROM PUBLIC;
GRANT USAGE ON SCHEMA devtools TO idp_local, app_worker, app_tenant, app_platform;
GRANT SELECT, INSERT, DELETE ON devtools.mailbox TO idp_local, app_worker, app_tenant, app_platform;

-- idp_local may call the shared helper used by the updated_at trigger.
GRANT USAGE ON SCHEMA public TO idp_local;
