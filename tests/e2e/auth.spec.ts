import { test, expect } from '@playwright/test';
import { BROWSER_E2E_FIXTURES } from './support/browserE2EFixtures';

/**
 * Authentication E2E Tests
 *
 * Tests the login, logout, and session management flows.
 */

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login page for unauthenticated users', async ({ page }) => {
    // Check that login form is visible
    // The app title is "Sanctuary" - verify the login page elements
    await expect(page.getByRole('heading', { name: /sanctuary/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.getByLabel(/username/i).fill('invaliduser');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show error message from backend
    // Error messages include: "Invalid credentials", "Authentication failed", etc.
    await expect(page.getByText(/invalid|incorrect|failed|error/i)).toBeVisible({ timeout: 10000 });
  });

  test('should show validation errors for empty fields', async ({ page }) => {
    // The form uses HTML5 required attribute, which prevents submission
    // We verify by checking that the form doesn't navigate away when clicking submit
    const usernameField = page.getByLabel(/username/i);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Form should still be visible (didn't submit due to HTML5 validation)
    await expect(usernameField).toBeVisible();
    // Still on the same page
    await expect(page).toHaveURL('/');
  });

  test('should successfully login with valid credentials', async ({ page }) => {
    await page.getByLabel(/username/i).fill(BROWSER_E2E_FIXTURES.user.username);
    await page.getByLabel(/password/i).fill(BROWSER_E2E_FIXTURES.user.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
    await expect(
      page.getByText(BROWSER_E2E_FIXTURES.user.username, { exact: true }),
    ).toBeVisible();
  });

  test('should prompt for 2FA after a valid password', async ({ page }) => {
    await page.getByLabel(/username/i).fill(BROWSER_E2E_FIXTURES.twoFactorUser.username);
    await page.getByLabel(/password/i).fill(BROWSER_E2E_FIXTURES.twoFactorUser.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show 2FA input
    await expect(page.getByLabel(/code|otp|2fa/i)).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // First login
    await page.getByLabel(/username/i).fill(BROWSER_E2E_FIXTURES.user.username);
    await page.getByLabel(/password/i).fill(BROWSER_E2E_FIXTURES.user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();

    // Then logout
    await page.getByRole('button', { name: /logout|sign out/i }).click();

    // Should return to login page
    await expect(page.getByRole('heading', { name: /sanctuary/i })).toBeVisible();
  });
});
