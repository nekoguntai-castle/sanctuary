import { test, expect } from '@playwright/test';

/**
 * Wallet E2E Tests
 *
 * Tests wallet viewing and management flows.
 */

test.describe('Wallet Management', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if auth tests are disabled
    test.skip(process.env.SKIP_AUTH_TESTS === 'true', 'Auth tests disabled');

    // Login first
    await page.goto('/');
    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('testpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/dashboard|wallets|home/i);
  });

  test('should display wallet list', async ({ page }) => {
    // Navigate to wallets page
    await page.goto('/wallets');

    // Should show wallet list or empty state
    const walletList = page.getByRole('list').or(page.getByText(/no wallets|create.*wallet/i));
    await expect(walletList).toBeVisible();
  });

  test('should display wallet details when clicked', async ({ page }) => {
    await page.goto('/wallets');

    // Click on first wallet if exists
    const walletItem = page.getByRole('listitem').first();
    if (await walletItem.isVisible()) {
      await walletItem.click();

      // Should show wallet details
      await expect(page.getByText(/balance|transactions|addresses/i)).toBeVisible();
    }
  });

  test('should show receive address modal', async ({ page }) => {
    await page.goto('/wallets');

    // Click on first wallet
    const walletItem = page.getByRole('listitem').first();
    if (await walletItem.isVisible()) {
      await walletItem.click();

      // Click receive button
      await page.getByRole('button', { name: /receive/i }).click();

      // Should show address and QR code
      await expect(page.getByRole('dialog')).toBeVisible();
      // Address should be visible (Bitcoin address pattern)
      await expect(page.getByText(/bc1|[13][a-zA-Z0-9]/)).toBeVisible();
    }
  });

  test('should display transaction history', async ({ page }) => {
    await page.goto('/wallets');

    const walletItem = page.getByRole('listitem').first();
    if (await walletItem.isVisible()) {
      await walletItem.click();

      // Should show transactions section
      await expect(page.getByText(/transactions|history/i)).toBeVisible();
    }
  });

  test('should handle wallet sync', async ({ page }) => {
    await page.goto('/wallets');

    const walletItem = page.getByRole('listitem').first();
    if (await walletItem.isVisible()) {
      await walletItem.click();

      // Click sync/refresh button
      const syncButton = page.getByRole('button', { name: /sync|refresh/i });
      if (await syncButton.isVisible()) {
        await syncButton.click();

        // Should show syncing state or success
        await expect(
          page.getByText(/syncing|loading/i).or(page.getByText(/synced|updated/i))
        ).toBeVisible({ timeout: 30000 });
      }
    }
  });
});
