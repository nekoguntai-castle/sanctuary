import { test, expect } from '@playwright/test';
import { AUTH_COORDINATION_LOCK_NAME } from '../../src/api/authCoordination';
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

  test('recovers immediately when only the CSRF cookie is lost', async ({ page }) => {
    await page.getByLabel(/username/i).fill(BROWSER_E2E_FIXTURES.user.username);
    await page.getByLabel(/password/i).fill(BROWSER_E2E_FIXTURES.user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();

    await page.evaluate(() => {
      const peer = new BroadcastChannel('sanctuary-auth');
      peer.postMessage({ type: 'logout-broadcast' });
      setTimeout(() => peer.close(), 0);
    });
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await page.evaluate(() => {
      document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    const loginBodies: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/auth/login')) {
        loginBodies.push(request.postData() ?? '');
      }
    });
    await page.getByLabel(/username/i).fill(BROWSER_E2E_FIXTURES.user.username);
    await page.getByLabel(/password/i).fill(BROWSER_E2E_FIXTURES.user.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
    await expect.poll(() => loginBodies.length).toBe(2);
    expect(loginBodies[1]).toBe(loginBodies[0]);
  });

  test('gives a queued refresh writer priority across two tabs', async ({ page, context }) => {
    const peer = await context.newPage();
    await peer.goto('/');
    await page.evaluate(() => localStorage.clear());

    const shared = page.evaluate(async (lockName) => {
      await navigator.locks.request(lockName, { mode: 'shared' }, async () => {
        localStorage.setItem('auth-lock-order', 'shared');
        await new Promise<void>((resolve) => {
          const onStorage = (event: StorageEvent) => {
            if (event.key !== 'release-auth-shared') return;
            window.removeEventListener('storage', onStorage);
            resolve();
          };
          window.addEventListener('storage', onStorage);
        });
      });
    }, AUTH_COORDINATION_LOCK_NAME);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('auth-lock-order')))
      .toBe('shared');

    const exclusive = peer.evaluate(async (lockName) => {
      await navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
        localStorage.setItem('auth-lock-order', `${localStorage.getItem('auth-lock-order')},exclusive`);
        await new Promise<void>((resolve) => {
          const onStorage = (event: StorageEvent) => {
            if (event.key !== 'release-auth-exclusive') return;
            window.removeEventListener('storage', onStorage);
            resolve();
          };
          window.addEventListener('storage', onStorage);
        });
      });
    }, AUTH_COORDINATION_LOCK_NAME);
    await expect.poll(() => page.evaluate(async (lockName) => {
      const state = await navigator.locks.query();
      return state.pending?.some(lock => lock.name === lockName && lock.mode === 'exclusive') ?? false;
    }, AUTH_COORDINATION_LOCK_NAME)).toBe(true);
    const lateShared = page.evaluate(async (lockName) => {
      await navigator.locks.request(lockName, { mode: 'shared' }, async () => {
        localStorage.setItem('auth-lock-order', `${localStorage.getItem('auth-lock-order')},late-shared`);
      });
    }, AUTH_COORDINATION_LOCK_NAME);

    await page.waitForTimeout(100);
    expect(await page.evaluate(() => localStorage.getItem('auth-lock-order'))).toBe('shared');
    await peer.evaluate(() => localStorage.setItem('release-auth-shared', 'true'));
    await expect.poll(() => page.evaluate(() => localStorage.getItem('auth-lock-order')))
      .toBe('shared,exclusive');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => localStorage.getItem('auth-lock-order'))).toBe('shared,exclusive');
    await page.evaluate(() => localStorage.setItem('release-auth-exclusive', 'true'));

    await Promise.all([shared, exclusive, lateShared]);
    expect(await page.evaluate(() => localStorage.getItem('auth-lock-order')))
      .toBe('shared,exclusive,late-shared');
    await peer.close();
  });

  test('serializes a real cross-tab mutation before refresh and cookie rotation', async ({
    page,
    context,
  }) => {
    await page.getByLabel(/username/i).fill(BROWSER_E2E_FIXTURES.user.username);
    await page.getByLabel(/password/i).fill(BROWSER_E2E_FIXTURES.user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();

    const peer = await context.newPage();
    await Promise.all([
      page.goto('/#/settings'),
      peer.goto('/#/settings'),
    ]);
    await expect(page.getByRole('main').getByText('Dark Mode')).toBeVisible();
    await expect(peer.getByRole('main').getByText('Dark Mode')).toBeVisible();

    let releaseMutation!: () => void;
    const mutationRelease = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    let markMutationObserved!: () => void;
    const mutationObserved = new Promise<void>((resolve) => {
      markMutationObserved = resolve;
    });
    await page.route('**/auth/me/preferences', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      markMutationObserved();
      await mutationRelease;
      await route.continue();
    });

    const darkModeContainer = page.getByRole('main').locator('div')
      .filter({ hasText: /^Dark Mode$/ })
      .first();
    await darkModeContainer.locator('button').click();
    await mutationObserved;
    await expect.poll(() => page.evaluate(async (lockName) => {
      const state = await navigator.locks.query();
      return state.held?.some(lock => lock.name === lockName && lock.mode === 'shared') ?? false;
    }, AUTH_COORDINATION_LOCK_NAME)).toBe(true);

    const csrfBeforeRefresh = (await context.cookies())
      .find(cookie => cookie.name === 'sanctuary_csrf')?.value;
    let rejectNextMe = true;
    await peer.route('**/auth/me', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (rejectNextMe && route.request().method() === 'GET' && path.endsWith('/auth/me')) {
        rejectNextMe = false;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Access token expired' }),
        });
        return;
      }
      await route.continue();
    });
    let refreshRequests = 0;
    peer.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/auth/refresh')) {
        refreshRequests += 1;
      }
    });

    const reload = peer.reload();
    await expect.poll(() => page.evaluate(async (lockName) => {
      const state = await navigator.locks.query();
      return state.pending?.some(lock => lock.name === lockName && lock.mode === 'exclusive') ?? false;
    }, AUTH_COORDINATION_LOCK_NAME)).toBe(true);
    expect(refreshRequests).toBe(0);

    releaseMutation();
    await reload;
    await expect.poll(() => refreshRequests).toBe(1);
    await expect(peer.getByRole('button', { name: /logout/i })).toBeVisible();
    const csrfAfterRefresh = (await context.cookies())
      .find(cookie => cookie.name === 'sanctuary_csrf')?.value;
    expect(csrfBeforeRefresh).toBeDefined();
    expect(csrfAfterRefresh).toBeDefined();
    expect(csrfAfterRefresh).not.toBe(csrfBeforeRefresh);
    await peer.close();
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
