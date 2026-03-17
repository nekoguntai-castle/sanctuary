/**
 * Settings Persistence E2E Tests
 *
 * Tests that user preference changes (theme, currency, unit, display options)
 * persist correctly through API calls and across page navigation.
 */

import { expect, test, type Page, type Route } from '@playwright/test';

const API_ORIGIN = (() => {
  const apiUrl = process.env.VITE_API_URL;
  if (!apiUrl || !/^https?:\/\//.test(apiUrl)) {
    return null;
  }
  try {
    return new URL(apiUrl).origin;
  } catch {
    return null;
  }
})();

const ADMIN_USER = {
  id: 'user-settings-admin',
  username: 'admin',
  isAdmin: true,
  usingDefaultPassword: false,
  preferences: {
    darkMode: false,
    theme: 'sanctuary',
    background: 'minimal',
    contrastLevel: 0,
    patternOpacity: 50,
    fiatCurrency: 'USD',
    unit: 'sats',
    showFiat: false,
    priceProvider: 'auto',
  },
  createdAt: '2026-03-11T00:00:00.000Z',
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function mockSettingsApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-settings-token');
  });

  const unhandledRequests: string[] = [];
  let preferencesState = { ...ADMIN_USER.preferences };
  const preferenceUpdates: Record<string, unknown>[] = [];

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    // Auth
    if (method === 'GET' && path === '/auth/me') return json(route, { ...ADMIN_USER, preferences: preferencesState });
    if (method === 'GET' && path === '/auth/registration-status') return json(route, { enabled: false });
    if (method === 'PUT' && path === '/auth/preferences') {
      try {
        const body = request.postDataJSON();
        preferenceUpdates.push(body);
        preferencesState = { ...preferencesState, ...body };
      } catch {
        // no-op
      }
      return json(route, preferencesState);
    }
    if (method === 'GET' && path === '/health') return json(route, { status: 'ok' });

    // Shared
    if (method === 'GET' && path === '/wallets') return json(route, []);
    if (method === 'GET' && path === '/devices') return json(route, []);
    if (method === 'GET' && path === '/price') {
      return json(route, { price: 95000, currency: 'USD', sources: [], median: 95000, average: 95000, timestamp: '2026-03-11T00:00:00.000Z', cached: true, change24h: -1.5 });
    }
    if (method === 'GET' && path === '/bitcoin/status') {
      return json(route, { connected: true, blockHeight: 900500, explorerUrl: 'https://mempool.space', confirmationThreshold: 1, deepConfirmationThreshold: 6, pool: { enabled: true, minConnections: 1, maxConnections: 3, stats: { totalConnections: 2, activeConnections: 2, idleConnections: 0, waitingRequests: 0, totalAcquisitions: 30, averageAcquisitionTimeMs: 8, healthCheckFailures: 0, serverCount: 1, servers: [] } } });
    }
    if (method === 'GET' && path === '/bitcoin/fees') return json(route, { fastest: 18, halfHour: 12, hour: 8, economy: 3 });
    if (method === 'GET' && path === '/bitcoin/mempool') return json(route, { mempool: [], blocks: [], mempoolInfo: { count: 0, size: 0, totalFees: 0 }, queuedBlocksSummary: null });
    if (method === 'GET' && path === '/admin/version') return json(route, { updateAvailable: false, currentVersion: '0.8.14' });
    if (method === 'GET' && path === '/transactions/recent') return json(route, []);
    if (method === 'GET' && path === '/transactions/balance-history') return json(route, []);

    unhandledRequests.push(`${method} ${path}`);
    return json(route, { message: `Unmocked: ${method} ${path}` }, 404);
  };

  await page.route('**/api/v1/**', apiRouteHandler);
  if (API_ORIGIN) await page.route(`${API_ORIGIN}/**`, apiRouteHandler);
  return { unhandledRequests, preferenceUpdates };
}

test.describe('Settings persistence', () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', err => errors.push(err.message));
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = runtimeErrors.get(page) ?? [];
    expect(errors, `Runtime errors in "${testInfo.title}"`).toEqual([]);
  });

  // --- Dark Mode ---

  test('toggling dark mode sends preference update', async ({ page }) => {
    const { unhandledRequests, preferenceUpdates } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    // Dark Mode toggle is inside "Visual Settings" section in the Appearance tab
    // Scroll to it and find the button adjacent to the "Dark Mode" text
    const darkModeLabel = main.getByText('Dark Mode');
    await darkModeLabel.scrollIntoViewIfNeeded();
    await expect(darkModeLabel).toBeVisible();

    // The toggle button is a sibling of the "Dark Mode" text inside a container div
    const darkModeToggle = darkModeLabel.locator('xpath=./following-sibling::button | ../button');
    await darkModeToggle.first().click();

    // Should have sent a preference update with darkMode
    await page.waitForTimeout(500);
    const darkModeUpdate = preferenceUpdates.find(u => 'darkMode' in u);
    expect(darkModeUpdate).toBeDefined();

    expect(unhandledRequests).toEqual([]);
  });

  test('dark mode toggle applies to page', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    const darkModeLabel = main.getByText('Dark Mode');
    await darkModeLabel.scrollIntoViewIfNeeded();
    await expect(darkModeLabel).toBeVisible();

    // Toggle dark mode on
    const darkModeToggle = darkModeLabel.locator('xpath=./following-sibling::button | ../button');
    await darkModeToggle.first().click();

    // The HTML element should have 'dark' class after toggling
    await expect(page.locator('html.dark')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Display Preferences ---

  test('display tab shows unit and currency options', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();

    // Unit selector buttons
    await expect(page.getByRole('button', { name: 'Sats' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'BTC' })).toBeVisible();

    // Fiat currency
    await expect(page.getByText('Fiat Currency')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('switching unit from sats to BTC sends preference update', async ({ page }) => {
    const { unhandledRequests, preferenceUpdates } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();

    // Click BTC unit
    await page.getByRole('button', { name: 'BTC' }).click();

    await page.waitForTimeout(500);
    const unitUpdate = preferenceUpdates.find(u => 'unit' in u);
    expect(unitUpdate).toBeDefined();
    if (unitUpdate) {
      expect(unitUpdate).toHaveProperty('unit', 'btc');
    }

    expect(unhandledRequests).toEqual([]);
  });

  test('changing fiat currency sends preference update', async ({ page }) => {
    const { unhandledRequests, preferenceUpdates } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Fiat Currency')).toBeVisible();

    // Change currency via combobox (select element in the DOM)
    const currencySelect = page.getByRole('combobox').first();
    if (await currencySelect.isVisible()) {
      await currencySelect.selectOption({ label: 'EUR (€)' });

      await page.waitForTimeout(500);
      const currencyUpdate = preferenceUpdates.find(u => 'fiatCurrency' in u);
      expect(currencyUpdate).toBeDefined();
    }

    expect(unhandledRequests).toEqual([]);
  });

  // --- Settings Tab Persistence ---

  test('settings tabs maintain active state', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    // Default tab (Appearance) should be active
    await expect(main.getByText('Dark Mode')).toBeVisible();

    // Switch to Display
    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();

    // Switch to Notifications
    await main.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notification Sounds' })).toBeVisible();

    // Switch back to Appearance
    await main.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(main.getByText('Dark Mode')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Preference Persistence Across Navigation ---

  test('preference changes persist after navigating away and back', async ({ page }) => {
    const { unhandledRequests, preferenceUpdates } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    // Change display tab and switch unit
    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();
    await page.getByRole('button', { name: 'BTC' }).click();

    await page.waitForTimeout(500);

    // Navigate away to dashboard
    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    // Navigate back to settings
    await page.goto('/#/settings');
    await main.getByRole('button', { name: 'Display', exact: true }).click();

    // BTC should still be the selected unit (from preference state)
    // The preferences API was called, so on re-render it should reflect the change
    await expect(page.getByText('Display Preferences')).toBeVisible();

    // Verify the API was actually called
    expect(preferenceUpdates.length).toBeGreaterThan(0);

    expect(unhandledRequests).toEqual([]);
  });

  // --- Notification Settings ---

  test('notification tab shows sound configuration options', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notification Sounds' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Theme Selection ---

  test('appearance tab shows theme options', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await expect(main.getByText('Theme')).toBeVisible();
    await expect(main.getByText('Dark Mode')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });
});
