import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (e2e/). One run = one fresh, seeded database and one local server:
 * e2e/global-setup.ts creates the database with createTestDatabase({ seed: true }), builds the
 * SPA (skip with E2E_SKIP_BUILD=1) and starts `npm run start -w @saunaklar/api` with the
 * database URL in its environment. That happens in globalSetup rather than `webServer`
 * because Playwright starts webServer *before* globalSetup, so the server could not get the
 * database's URL. The teardown stops the server and drops the database.
 *
 * Hosts: http://alpha.localhost:<port> (storefront and reseller admin) and
 * http://admin.localhost:<port> (manufacturer admin). Chromium resolves *.localhost to
 * loopback; Node does not, which is why every check goes through the browser.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 8799);

// Locally a Chromium is pre-installed outside Playwright's cache (possibly another revision);
// in CI `npx playwright install --with-deps chromium` provides the matching one.
const PREINSTALLED = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM_PATH ?? (!process.env.CI && existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1, // one shared database and server; tests change data (requests, configurations)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://alpha.localhost:${E2E_PORT}`,
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
  ],
});
