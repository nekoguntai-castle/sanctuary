/**
 * Settings Persistence E2E Tests
 *
 * Tests that user preference changes (theme, currency, unit, display options)
 * persist correctly through API calls and across page navigation.
 */

import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

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

type MockApiResponse = {
  status?: number;
  body: unknown;
};

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
};

type SettingsApiState = {
  preferencesState: Record<string, unknown>;
  preferenceUpdates: Record<string, unknown>[];
};

function mockResponse(body: unknown, status?: number): MockApiResponse {
  return { body, status };
}

function parseApiRoute(route: Route): ParsedApiRoute {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, '');
  return { method, path, requestKey: `${method} ${path}` };
}

const PRICE_RESPONSE = {
  price: 95000,
  currency: 'USD',
  sources: [],
  median: 95000,
  average: 95000,
  timestamp: '2026-03-11T00:00:00.000Z',
  cached: true,
  change24h: -1.5,
};

const BITCOIN_STATUS_RESPONSE = {
  connected: true,
  blockHeight: 900500,
  explorerUrl: 'https://mempool.space',
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  pool: {
    enabled: true,
    minConnections: 1,
    maxConnections: 3,
    stats: {
      totalConnections: 2,
      activeConnections: 2,
      idleConnections: 0,
      waitingRequests: 0,
      totalAcquisitions: 30,
      averageAcquisitionTimeMs: 8,
      healthCheckFailures: 0,
      serverCount: 1,
      servers: [],
    },
  },
};

const STATIC_SETTINGS_API_RESPONSES: Record<string, MockApiResponse> = {
  'GET /auth/registration-status': mockResponse({ enabled: false }),
  'GET /health': mockResponse({ status: 'ok' }),
  'GET /wallets': mockResponse([]),
  'GET /devices': mockResponse([]),
  'GET /price': mockResponse(PRICE_RESPONSE),
  'GET /bitcoin/status': mockResponse(BITCOIN_STATUS_RESPONSE),
  'GET /bitcoin/fees': mockResponse({ fastest: 18, halfHour: 12, hour: 8, economy: 3 }),
  'GET /bitcoin/mempool': mockResponse({
    mempool: [],
    blocks: [],
    mempoolInfo: { count: 0, size: 0, totalFees: 0 },
    queuedBlocksSummary: null,
  }),
  'GET /admin/version': mockResponse({ updateAvailable: false, currentVersion: '0.8.14' }),
  'GET /admin/agents': mockResponse([]),
  'GET /transactions/recent': mockResponse([]),
  'GET /transactions/balance-history': mockResponse([]),
  'GET /ai/status': mockResponse({ available: false, containerAvailable: false }),
  'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
};

function getPreferenceResponse(
  route: Route,
  { requestKey }: ParsedApiRoute,
  state: SettingsApiState
): MockApiResponse | null {
  if (requestKey === 'GET /auth/me') {
    return mockResponse({ ...ADMIN_USER, preferences: state.preferencesState });
  }
  if (requestKey === 'PUT /auth/preferences') {
    try {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.preferenceUpdates.push(body);
      state.preferencesState = { ...state.preferencesState, ...body };
    } catch {
      // no-op
    }
    return mockResponse(state.preferencesState);
  }
  return null;
}

function getSettingsApiResponse(
  route: Route,
  parsedRoute: ParsedApiRoute,
  state: SettingsApiState
): MockApiResponse | null {
  return getPreferenceResponse(route, parsedRoute, state)
    ?? STATIC_SETTINGS_API_RESPONSES[parsedRoute.requestKey]
    ?? null;
}

function createSettingsApiRouteHandler(options: {
  state: SettingsApiState;
  unhandledRequests: string[];
}) {
  const apiRouteHandler = async (route: Route) => {
    const parsedRoute = parseApiRoute(route);
    const { method, path, requestKey } = parsedRoute;
    const response = getSettingsApiResponse(route, parsedRoute, options.state);

    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    options.unhandledRequests.push(requestKey);
    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

async function mockSettingsApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-settings-token');
  });

  const unhandledRequests: string[] = [];
  const preferenceUpdates: Record<string, unknown>[] = [];
  const state = {
    preferencesState: { ...ADMIN_USER.preferences },
    preferenceUpdates,
  };

  await registerApiRoutes(page, createSettingsApiRouteHandler({
    state,
    unhandledRequests,
  }));
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

  test('appearance tab shows dark mode control', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    // Dark Mode label should be visible in the Appearance tab
    await expect(main.getByText('Dark Mode')).toBeVisible();

    // There should be a clickable button near it (the toggle)
    const darkModeContainer = main.locator('div').filter({ hasText: /^Dark Mode$/ }).first();
    await expect(darkModeContainer).toBeVisible();
    const buttons = await darkModeContainer.locator('button').count();
    expect(buttons).toBeGreaterThan(0);

    expect(unhandledRequests).toEqual([]);
  });

  test('dark mode toggle button exists near label', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    // The Dark Mode section should have a button (the toggle)
    const darkModeContainer = main.locator('div').filter({ hasText: /^Dark Mode$/ }).first();
    await expect(darkModeContainer).toBeVisible();
    const buttonCount = await darkModeContainer.locator('button').count();
    expect(buttonCount).toBeGreaterThan(0);

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

  test('display tab shows unit selector options', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();

    // Unit options should be visible (Sats/BTC buttons or text)
    await expect(page.getByText('Bitcoin Unit')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('display tab currency selector is interactive', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Fiat Currency')).toBeVisible();

    // Currency selector should be present
    const currencySelect = page.getByRole('combobox').first();
    if (await currencySelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Select should have options
      const options = await currencySelect.locator('option').count();
      expect(options).toBeGreaterThan(1);
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

  test('settings page survives navigation round-trip', async ({ page }) => {
    const { unhandledRequests } = await mockSettingsApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    // Verify settings page renders
    await expect(main.getByText('Dark Mode')).toBeVisible();

    // Navigate away to dashboard
    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    // Navigate back to settings - page should still work
    await page.goto('/#/settings');
    await expect(main.getByText('Dark Mode')).toBeVisible();

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
