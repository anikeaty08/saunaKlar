import { SEED, en, escape, expect, fill, loginWithForm, test } from './fixtures.ts';

// FIXME: the configurator (storefront/pages/Configure.tsx), the login page (storefront/account/Auth.tsx)
// and the account pages (storefront/account/Account.tsx) do not exist yet. Remove `.fixme` once they land.
test.fixme('customer configures a sauna, sees the price change, saves and sends a request', async ({ page }) => {
  await loginWithForm(page, '/account/login', 'anna@example.test');
  await expect(page.getByText(fill(en.auth.welcome, { name: 'Anna' }))).toBeVisible();

  await page.goto('/saunas/lappi-barrel');
  await page.getByRole('link', { name: en.detail.configure }).click();
  await expect(page.getByRole('heading', { name: fill(en.configure.title, { name: 'Lappi Barrel' }) })).toBeVisible();

  const total = page.getByTestId('configure-total').or(page.getByRole('region', { name: en.configure.summary }).getByText(/€/).last());
  const before = await total.innerText();
  await page.getByRole('radio', { name: /Thermo-aspen/ }).check();
  await expect(total).not.toHaveText(before);

  await page.getByRole('button', { name: en.configure.saveDraft, exact: true }).click();
  await expect(page.getByText(en.configure.draftSaved)).toBeVisible();

  await page.getByRole('button', { name: en.configure.sendRequest }).first().click();
  const dialog = page.getByRole('dialog', { name: en.configure.requestTitle });
  await dialog.getByLabel(new RegExp(`^${escape(en.configure.message)}`)).fill('E2E: please call before delivery.');
  await dialog.getByRole('button', { name: en.configure.sendRequest }).click();
  await expect(page.getByText(en.configure.requestSent)).toBeVisible();

  await page.goto('/account/requests');
  const row = page.getByRole('row').filter({ hasText: 'Lappi Barrel' }).filter({ hasText: en.status.SUBMITTED });
  await expect(row.first()).toBeVisible();
  expect(SEED.customers.annaAlpha).toBeTruthy();
});
