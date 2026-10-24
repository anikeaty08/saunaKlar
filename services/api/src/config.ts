import { z } from 'zod';

/**
 * Runtime configuration from the environment. Every variable is documented
 * in services/api/.env.example. Parsed once at cold start; a bad value fails
 * fast instead of surfacing as a confusing runtime error.
 */
const bool = z.enum(['0', '1', 'true', 'false']).transform(v => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  /** Login URL for the API's own DB user (`sauna_api` locally; per-function IAM users in AWS). */
  API_DATABASE_URL: z.string().default('postgres://sauna_api:sauna_api@127.0.0.1:5432/sauna'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  PLATFORM_DOMAIN: z.string().default('localhost'),
  ADMIN_HOST: z.string().default('admin.localhost'),
  /** Scheme used when building absolute links (share links, e-mails). */
  PUBLIC_SCHEME: z.enum(['http', 'https']).default('http'),
  /** Port appended to absolute links in development (e.g. 5173 for Vite). Empty in production. */
  PUBLIC_PORT: z.string().optional(),
  /** Secret for CSRF tokens and cursor signing. 32+ random bytes in production. */
  APP_SECRET: z.string().min(16).default('dev-only-secret-change-me-0123456789'),
  /** Shared secret CloudFront adds as `x-origin-secret`; empty disables the check (local). */
  ORIGIN_SECRET: z.string().default(''),
  /** `__Host-` cookies need Secure; browsers allow Secure on http://*.localhost. */
  COOKIE_SECURE: bool.default(true),
  TRUST_X_TENANT_HOST: bool.default(true),
  ADAPTERS: z.enum(['local', 'aws']).default('local'),
  STAFF_MFA: z.enum(['REQUIRED', 'OPTIONAL']).default('REQUIRED'),
  SHARE_PRICE_VALID_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ASSET_COOKIE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  AR_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  /** In-process rate limits for auth and share routes; the WAF does this in AWS. */
  RATE_LIMIT: bool.default(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  // Default port only outside production; production links are https://<host> with no port.
  const cfg = { ...parsed.data, PUBLIC_PORT: parsed.data.PUBLIC_PORT ?? (parsed.data.NODE_ENV === 'production' ? '' : '5173') };
  if (cfg.NODE_ENV === 'production') {
    if (cfg.APP_SECRET.startsWith('dev-only')) throw new Error('APP_SECRET must be set in production');
    if (!cfg.ORIGIN_SECRET) throw new Error('ORIGIN_SECRET must be set in production');
    if (!cfg.COOKIE_SECURE) throw new Error('COOKIE_SECURE cannot be disabled in production');
  }
  return cfg;
}

/** Absolute origin for a host, e.g. `https://alpha.saunas.example.com`. */
export function originFor(cfg: Config, host: string): string {
  const port = cfg.PUBLIC_PORT ? `:${cfg.PUBLIC_PORT}` : '';
  return `${cfg.PUBLIC_SCHEME}://${host}${port}`;
}
