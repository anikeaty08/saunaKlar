/**
 * Shared e2e helpers. UI strings come from the SPA's own locale files, so tests follow copy
 * changes; seed ids, the share token and the password come from @saunaklar/db.
 */
import { expect, test as base, type Page } from '@playwright/test';
import { SEED, SEED_PASSWORD, SEED_SHARE_TOKEN } from '@saunaklar/db';
import { en } from '../apps/web/src/i18n/locales/en.ts';
import { fr } from '../apps/web/src/i18n/locales/fr.ts';

export { expect, en, fr, SEED, SEED_PASSWORD, SEED_SHARE_TOKEN };

export const PORT = Number(process.env.E2E_PORT ?? 8799);
export const ALPHA = `http://alpha.localhost:${PORT}`;
export const ADMIN = `http://admin.localhost:${PORT}`;
export const hostUrl = (slug: string, path = '/') => `http://${slug}.localhost:${PORT}${path}`;

/** Fills "{name}"-style placeholders the way the SPA's t() does. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

/** GET a JSON API path in the browser (Chromium resolves *.localhost, Node does not). */
export async function getJson<T = unknown>(page: Page, url: string): Promise<{ status: number; body: T }> {
  const res = await page.goto(url);
  if (!res) throw new Error(`no response for ${url}`);
  const text = await res.text();
  return { status: res.status(), body: (text ? JSON.parse(text) : null) as T };
}

/** Logs in through the storefront or admin login form (customer: /account/login, staff: /admin or admin host). */
export async function loginWithForm(page: Page, url: string, email: string, password = SEED_PASSWORD): Promise<void> {
  await page.goto(url);
  // Anchored: field labels may carry a "Required" marker, and "Show password" must not match.
  await page.getByLabel(new RegExp(`^${escape(en.auth.email)}`)).fill(email);
  await page.getByLabel(new RegExp(`^${escape(en.auth.password)}`)).fill(password);
  await page.getByRole('button', { name: en.auth.login, exact: true }).click();
}

export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const test = base;
