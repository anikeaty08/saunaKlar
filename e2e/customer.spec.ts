import { SEED, en, escape, expect, fill, loginWithForm, test } from './fixtures.ts';

test('customer configures a sauna, sees the price change, saves and sends a request', async ({ page }) => {
  await loginWithForm(page, '/account/login', 'anna@example.test');
  await expect(page.getByText(fill(en.auth.welcome, { name: 'Anna' }))).toBeVisible();

  await page.goto('/saunas/lappi-barrel');
  await page.getByRole('link', { name: en.detail.configure }).click();
  await expect(page).toHaveTitle(new RegExp(escape(fill(en.configure.title, { name: 'Lappi Barrel' }))));
  await expect(page.getByRole('heading', { level: 1, name: 'Lappi Barrel' })).toBeVisible();

  // The running total (Price with the "Total" label); the wood option is shown as a swatch and as a list item.
  const total = page.locator('.cfg__total');
  await expect(total).toContainText('€');
  const before = await total.innerText();
  const aspen = page.getByRole('radio', { name: /Thermo-aspen/ }).last();
  await aspen.click();
  await expect(aspen).toHaveAttribute('aria-checked', 'true');
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
