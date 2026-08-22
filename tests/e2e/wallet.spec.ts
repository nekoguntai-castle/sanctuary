import { test, expect } from '@playwright/test';
import { BROWSER_E2E_FIXTURES } from './support/browserE2EFixtures';

/**
 * Wallet E2E Tests
 *
 * Tests wallet viewing and management flows.
 */

test.describe('Wallet Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.getByLabel(/username/i).fill(BROWSER_E2E_FIXTURES.user.username);
    await page.getByLabel(/password/i).fill(BROWSER_E2E_FIXTURES.user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
  });

  test('opens the seeded wallet from the wallet list', async ({ page }) => {
    await page.goto('/#/wallets');
    const walletCardHeading = page.getByRole('heading', {
      level: 3,
      name: BROWSER_E2E_FIXTURES.wallet.name,
    });
    await expect(walletCardHeading).toBeVisible();
    await walletCardHeading.click();

    await expect(page).toHaveURL(
      new RegExp(`#/wallets/${BROWSER_E2E_FIXTURES.wallet.id}$`),
    );
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: BROWSER_E2E_FIXTURES.wallet.name,
      }),
    ).toBeVisible();
  });
});
