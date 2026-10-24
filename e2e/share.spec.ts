import { SEED_SHARE_TOKEN, en, expect, test } from './fixtures.ts';

// FIXME: storefront/pages/Shared.tsx does not exist yet. Remove `.fixme` once it lands.
test.fixme('the seeded share link renders a read-only snapshot', async ({ page }) => {
  await page.goto(`/s/${SEED_SHARE_TOKEN}`);
  await expect(page.getByText(en.shared.eyebrow)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Espoo Compact|Showroom offer/ }).first()).toBeVisible();
  await expect(page.getByText('Bronze glass door')).toBeVisible();
  // Read-only: no editing or sending, only "save to my account".
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.configure.sendRequest })).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.configure.saveDraft, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.shared.claim }).or(page.getByRole('link', { name: en.shared.claim }))).toBeVisible();
});

test.fixme('an unknown share token shows the expired page', async ({ page }) => {
  await page.goto('/s/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await expect(page.getByRole('heading', { name: en.shared.expiredTitle })).toBeVisible();
});
