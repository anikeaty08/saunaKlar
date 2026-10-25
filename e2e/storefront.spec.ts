import { ALPHA, en, expect, fill, fr, test } from './fixtures.ts';

const VISIBLE = ['Espoo Compact', 'Lappi Barrel', 'Turku Panorama', 'Kuopio Cube'];

test.describe('storefront', () => {
  test('home loads with the reseller branding and the catalogue lists its saunas', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Alpha Spa/);
    const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
    expect(brand.toLowerCase()).toBe('#1f2a24');
    await expect(page.getByRole('heading', { name: en.home.featuredTitle })).toBeVisible();

    await page.goto('/saunas');
    await expect(page.getByRole('heading', { level: 1, name: en.saunas.title })).toBeVisible();
    for (const name of VISIBLE) {
      await expect(page.getByRole('link', { name: fill(en.saunas.view, { name }) })).toBeVisible();
    }
    // oulu-corner is assigned to alpha but hidden
    await expect(page.getByRole('link', { name: fill(en.saunas.view, { name: 'Oulu Corner' }) })).toHaveCount(0);
  });

  test('the language switcher changes the UI and the catalogue texts to French', async ({ page }) => {
    await page.goto('/saunas/espoo-compact');
    await expect(page.getByText('A compact two-to-three seat indoor sauna', { exact: false })).toBeVisible();
    await expect(page.getByText(/^Nordic spruce/).first()).toBeVisible();

    await page.getByRole('button', { name: new RegExp(`^${en.nav.language}`) }).first().click();
    await page.getByRole('menuitemradio', { name: /Français/ }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    // UI strings come from fr.ts: the anonymous call to action is now French, the English one is gone.
    expect(fr.detail.loginToConfigure).not.toBe(en.detail.loginToConfigure);
    await expect(page.getByText(fr.detail.loginToConfigure, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(en.detail.loginToConfigure, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Sauna d’intérieur compact', { exact: false })).toBeVisible();
    await expect(page.getByText(/^Épicéa nordique/).first()).toBeVisible();
    await expect(page.getByText(/^Nordic spruce/)).toHaveCount(0);

    // The choice survives a reload.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByText(/^Épicéa nordique/).first()).toBeVisible();
    expect(page.url()).toContain(ALPHA);
  });
});
