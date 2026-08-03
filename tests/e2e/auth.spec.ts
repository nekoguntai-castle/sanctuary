import { test, expect } from '@playwright/test';

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
    // Note: This test requires a test user to be set up
    // Skip if running without test backend
    test.skip(process.env.SKIP_AUTH_TESTS === 'true', 'Auth tests disabled');

    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('testpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/dashboard|wallets|home/i);
  });

  test('should handle 2FA flow when enabled', async ({ page }) => {
    test.skip(process.env.SKIP_AUTH_TESTS === 'true', 'Auth tests disabled');

    // This test is for users with 2FA enabled
    // After initial login, should show 2FA prompt
    await page.getByLabel(/username/i).fill('user_with_2fa');
    await page.getByLabel(/password/i).fill('password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show 2FA input
    await expect(page.getByLabel(/code|otp|2fa/i)).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    test.skip(process.env.SKIP_AUTH_TESTS === 'true', 'Auth tests disabled');

    // First login
    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('testpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/dashboard|wallets|home/i);

    // Then logout
    await page.getByRole('button', { name: /logout|sign out/i }).click();

    // Should return to login page
    await expect(page.getByRole('heading', { name: /sanctuary/i })).toBeVisible();
  });
});
