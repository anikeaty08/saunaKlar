/**
 * Mapping of PostgreSQL errors to stable machine codes.
 *
 * Business-rule triggers raise SQLSTATE P0001 with message `<CODE>: text`, HINT `<CODE>` and an
 * optional DETAIL sub-reason (see 0001 raise_rule). Constraint and privilege errors map to
 * generic codes; the constraint name tells the API which one (e.g. customers_reseller_email_key).
 */

/** Codes raised by the database's rule triggers. */
export const DB_RULE_CODES = [
  'APPEND_ONLY',
  'ACTOR_AMBIGUOUS',
  'ASSET_NOT_CATALOG',
  'ASSET_TIER_MISMATCH',
  'ATTRIBUTE_TYPE_MISMATCH',
  'CONFIGURATION_IMMUTABLE_FIELD',
  'CONFIGURATION_LOCKED',
  'CONFIGURATION_NOT_LOCKED',
  'CUSTOMER_ANONYMISED',
  'CUSTOMER_IMMUTABLE_FIELD',
  'DISCOUNT_EXCEEDS_CAP',
  'INVALID_TRANSITION',
  'OPTION_RULES_VIOLATED',
  'QUOTE_EXPIRED',
  'QUOTE_IMMUTABLE',
  'QUOTE_MISSING',
  'REQUEST_IMMUTABLE',
  'REQUEST_NOT_OWNER',
  'REQUEST_NOT_QUOTABLE',
  'RESELLER_IMMUTABLE_FIELD',
  'RETENTION_TABLE_NOT_ALLOWED',
  'ROOM_NOT_ASSIGNABLE',
  'SAUNA_NOT_ASSIGNABLE',
  'SHARE_LINK_IMMUTABLE',
  'SLUG_INVALID',
  'SLUG_RESERVED',
  'SNAPSHOT_INVALID',
  'SNAPSHOT_MISSING',
  'STAFF_NOT_RESELLER_ADMIN',
] as const;
export type DbRuleCode = (typeof DB_RULE_CODES)[number];

/** Generic codes for SQLSTATEs the API handles. */
export const DB_SQLSTATE_CODES = {
  '23505': 'UNIQUE_VIOLATION',
  '23503': 'FOREIGN_KEY_VIOLATION',
  '23514': 'CHECK_VIOLATION',
  '23502': 'NOT_NULL_VIOLATION',
  '23P01': 'EXCLUSION_VIOLATION',
  '42501': 'INSUFFICIENT_PRIVILEGE',
  '40001': 'SERIALIZATION_FAILURE',
  '40P01': 'DEADLOCK_DETECTED',
  '22P02': 'INVALID_TEXT_REPRESENTATION',
} as const;
export type DbSqlstateCode = (typeof DB_SQLSTATE_CODES)[keyof typeof DB_SQLSTATE_CODES];

export type DbErrorCode = DbRuleCode | DbSqlstateCode;

export interface DbErrorInfo {
  code: DbErrorCode;
  sqlstate: string;
  /** Sub-reason from DETAIL for rule errors (e.g. REQUIRED_GROUP_EMPTY), else the pg detail. */
  detail?: string;
  /** Violated constraint or index name for 23xxx errors. */
  constraint?: string;
  message: string;
}

interface PgLikeError {
  code?: unknown;
  message?: unknown;
  hint?: unknown;
  detail?: unknown;
  constraint?: unknown;
}

const RULE_PREFIX = /^([A-Z][A-Z0-9_]{2,63}):\s/;

/** Structured view of a database error, or undefined for anything that is not one we map. */
export function dbErrorInfo(err: unknown): DbErrorInfo | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as PgLikeError;
  if (typeof e.code !== 'string') return undefined;
  const message = typeof e.message === 'string' ? e.message : '';
  const detail = typeof e.detail === 'string' && e.detail !== '' ? e.detail : undefined;
  const constraint = typeof e.constraint === 'string' ? e.constraint : undefined;
  if (e.code === 'P0001') {
    const fromHint = typeof e.hint === 'string' && (DB_RULE_CODES as readonly string[]).includes(e.hint) ? e.hint : undefined;
    const fromMessage = RULE_PREFIX.exec(message)?.[1];
    const code = fromHint ?? fromMessage;
    if (code === undefined || !(DB_RULE_CODES as readonly string[]).includes(code)) return undefined;
    return { code: code as DbRuleCode, sqlstate: e.code, message, ...(detail ? { detail } : {}) };
  }
  const generic = (DB_SQLSTATE_CODES as Record<string, DbSqlstateCode>)[e.code];
  if (generic === undefined) return undefined;
  return { code: generic, sqlstate: e.code, message, ...(detail ? { detail } : {}), ...(constraint ? { constraint } : {}) };
}

/** The stable code of a database error (rule code or generic SQLSTATE code), else undefined. */
export function dbErrorCode(err: unknown): DbErrorCode | undefined {
  return dbErrorInfo(err)?.code;
}
