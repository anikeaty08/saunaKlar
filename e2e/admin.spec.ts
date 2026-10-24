import { ADMIN, en, expect, loginWithForm, test } from './fixtures.ts';

// FIXME: the reseller admin (storefront/admin/AdminApp.tsx) does not exist yet. Remove `.fixme` once it lands.
test.fixme('reseller admin logs in at /admin and sees the requests list', async ({ page }) => {
  await loginWithForm(page, '/admin', 'owner@alpha.test');
  await expect(page.getByRole('heading', { name: en.admin.title }).or(page.getByRole('navigation').getByText(en.admin.nav.dashboard))).toBeVisible();
  await page.getByRole('link', { name: en.admin.nav.requests }).click();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Anna Virtanen' }).filter({ hasText: en.status.IN_REVIEW })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Anna Virtanen' }).filter({ hasText: en.status.QUOTED })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Ben Koskinen' }).filter({ hasText: en.status.SUBMITTED })).toHaveCount(1);
  // Tenant isolation in the UI: beta's request never shows up at alpha.
  await expect(rows.filter({ hasText: en.status.ACCEPTED })).toHaveCount(0);
});

// FIXME: the manufacturer admin is still a placeholder (manufacturer/ManufacturerApp.tsx). Remove `.fixme` once it lands.
test.fixme('manufacturer admin logs in at admin.localhost and sees the resellers', async ({ page }) => {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel(/^E-mail/).fill('admin@nordlicht.test');
  await page.getByLabel(/^Password/).fill('Sauna!2026');
  await page.getByRole('button', { name: new RegExp(`^(${en.manufacturer.login}|${en.auth.login})$`) }).click();
  await page.goto(`${ADMIN}/resellers`);
  await expect(page.getByRole('heading', { name: en.manufacturer.resellers })).toBeVisible();
  for (const name of ['Alpha Spa & Sauna GmbH', 'Beta Wellness AG', 'Gamma Bastu AB']) {
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
  }
  await expect(page.getByRole('row').filter({ hasText: 'Gamma Bastu AB' }).getByText(en.status.SUSPENDED)).toBeVisible();
});
