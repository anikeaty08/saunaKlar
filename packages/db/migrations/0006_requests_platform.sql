-- 0006 Requests (status workflow, history, notes, quotes) and platform tables (outbox,
-- e-mail suppressions, audit trail).

CREATE TABLE configuration_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id      uuid        NOT NULL,
  customer_id      uuid        NOT NULL,
  configuration_id uuid        NOT NULL,
  status_code      text        NOT NULL DEFAULT 'SUBMITTED' REFERENCES request_statuses (code),
  message          text        CHECK (length(message) <= 4000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- One request per configuration (idempotent "send request").
  CONSTRAINT configuration_requests_configuration_key UNIQUE (configuration_id),
  CONSTRAINT configuration_requests_id_reseller_key UNIQUE (id, reseller_id),
  -- Request, configuration and customer share one tenant and the configuration is the customer's.
  CONSTRAINT configuration_requests_configuration_fk FOREIGN KEY (configuration_id, reseller_id, customer_id)
    REFERENCES configurations (id, reseller_id, customer_id),
  CONSTRAINT configuration_requests_customer_fk FOREIGN KEY (customer_id, reseller_id)
    REFERENCES customers (id, reseller_id)
);
CREATE INDEX configuration_requests_reseller_status_idx ON configuration_requests (reseller_id, status_code, created_at DESC);
CREATE INDEX configuration_requests_reseller_created_idx ON configuration_requests (reseller_id, created_at DESC);
CREATE INDEX configuration_requests_customer_idx ON configuration_requests (customer_id, reseller_id, created_at DESC);
CREATE INDEX configuration_requests_configuration_idx ON configuration_requests (configuration_id, reseller_id, customer_id);

-- Written only by trigger (rule 7). Append-only.
CREATE TABLE request_status_history (
  id                     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id             uuid        NOT NULL,
  reseller_id            uuid        NOT NULL,
  from_status            text        REFERENCES request_statuses (code),
  to_status              text        NOT NULL REFERENCES request_statuses (code),
  changed_by_staff_id    uuid        REFERENCES staff_users (id),
  changed_by_customer_id uuid,
  note                   text        CHECK (length(note) <= 2000),
  changed_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_status_history_request_fk FOREIGN KEY (request_id, reseller_id)
    REFERENCES configuration_requests (id, reseller_id) ON DELETE CASCADE,
  CONSTRAINT request_status_history_customer_fk FOREIGN KEY (changed_by_customer_id, reseller_id)
    REFERENCES customers (id, reseller_id)
);
CREATE INDEX request_status_history_request_idx ON request_status_history (request_id, reseller_id, id);
CREATE INDEX request_status_history_staff_idx ON request_status_history (changed_by_staff_id) WHERE changed_by_staff_id IS NOT NULL;
CREATE INDEX request_status_history_customer_idx ON request_status_history (changed_by_customer_id) WHERE changed_by_customer_id IS NOT NULL;

-- Internal reseller notes; never visible to customers (RLS).
CREATE TABLE request_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid        NOT NULL,
  reseller_id     uuid        NOT NULL,
  author_staff_id uuid        NOT NULL REFERENCES staff_users (id),
  body            text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_notes_request_fk FOREIGN KEY (request_id, reseller_id)
    REFERENCES configuration_requests (id, reseller_id) ON DELETE CASCADE
);
CREATE INDEX request_notes_request_idx ON request_notes (request_id, reseller_id, created_at);
CREATE INDEX request_notes_author_idx ON request_notes (author_staff_id);

-- Quotes are 1:N; a new quote supersedes the active one (review G8).
CREATE TABLE request_quotes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid        NOT NULL,
  reseller_id         uuid        NOT NULL,
  amount_minor        bigint      NOT NULL CHECK (amount_minor >= 0),
  currency_code       char(3)     NOT NULL,
  valid_until         timestamptz NOT NULL,
  note                text        CHECK (length(note) <= 2000),
  created_by_staff_id uuid        NOT NULL REFERENCES staff_users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at       timestamptz,
  CONSTRAINT request_quotes_validity CHECK (valid_until > created_at),
  CONSTRAINT request_quotes_superseded_after_created CHECK (superseded_at IS NULL OR superseded_at >= created_at),
  CONSTRAINT request_quotes_request_fk FOREIGN KEY (request_id, reseller_id)
    REFERENCES configuration_requests (id, reseller_id) ON DELETE CASCADE,
  -- A quote is always in the reseller's currency.
  CONSTRAINT request_quotes_currency_fk FOREIGN KEY (reseller_id, currency_code)
    REFERENCES resellers (id, currency_code)
);
CREATE UNIQUE INDEX request_quotes_active_key ON request_quotes (request_id) WHERE superseded_at IS NULL;
CREATE INDEX request_quotes_request_idx ON request_quotes (request_id, reseller_id, created_at DESC);
CREATE INDEX request_quotes_reseller_idx ON request_quotes (reseller_id, currency_code);
CREATE INDEX request_quotes_staff_idx ON request_quotes (created_by_staff_id);

-- Transactional outbox (design 14). Payloads carry ids only, never e-mail addresses or names.
CREATE TABLE notification_outbox (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reseller_id  uuid        REFERENCES resellers (id),
  event_type   text        NOT NULL CHECK (event_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  payload      jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts     integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until timestamptz,
  sent_at      timestamptz,
  failed_at    timestamptz,
  last_error   text        CHECK (length(last_error) <= 4000)
);
-- The worker's queue scan: pending rows by availability.
CREATE INDEX notification_outbox_pending_idx ON notification_outbox (available_at, id)
  WHERE sent_at IS NULL AND failed_at IS NULL;
CREATE INDEX notification_outbox_reseller_idx ON notification_outbox (reseller_id, created_at DESC) WHERE reseller_id IS NOT NULL;
CREATE INDEX notification_outbox_sent_idx ON notification_outbox (sent_at) WHERE sent_at IS NOT NULL;

CREATE TABLE email_suppressions (
  email_lower text        PRIMARY KEY CHECK (email_lower = lower(email_lower) AND length(email_lower) <= 254),
  reason      text        NOT NULL CHECK (reason IN ('BOUNCE', 'COMPLAINT', 'MANUAL')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit trail. Actor columns deliberately carry no FK: audit outlives its subjects.
CREATE TABLE audit_events (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  reseller_id       uuid        REFERENCES resellers (id),
  actor_staff_id    uuid,
  actor_customer_id uuid,
  action            text        NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  entity_type       text        NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 100),
  entity_id         text        NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 300),
  details           jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX audit_events_reseller_idx ON audit_events (reseller_id, occurred_at DESC) WHERE reseller_id IS NOT NULL;
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX audit_events_occurred_brin ON audit_events USING brin (occurred_at);
