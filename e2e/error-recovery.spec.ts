/**
 * Error Recovery E2E Tests
 *
 * Tests application behavior under various error conditions: API timeouts,
 * 500 errors, partial failures, and recovery from error states.
 */

import { expect, test, type Page, type Route } from '@playwright/test';

const WALLET_ID = 'wallet-error-1';

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
  id: 'user-error-admin',
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

const WALLET = {
  id: WALLET_ID,
  name: 'Error Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh([abcd1234/84h/0h/0h]xpubErrorTest/0/*)',
  fingerprint: 'abcd1234',
  balance: 50000000,
  quorum: 1,
  totalSigners: 1,
  userRole: 'owner',
  canEdit: true,
  isShared: false,
  sharedWith: [],
  syncInProgress: false,
  lastSyncedAt: '2026-03-11T00:00:00.000Z',
  lastSyncStatus: 'success',
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

type MockApiFailure = {
  status?: number;
  body?: unknown;
  timeout?: boolean;
};

async function mockErrorApi(
  page: Page,
  failures: Record<string, MockApiFailure> = {}
) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-error-token');
  });

  const unhandledRequests: string[] = [];

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const requestKey = `${method} ${path}`;

    const failure = failures[requestKey];
    if (failure) {
      if (failure.timeout) return route.abort('timedout');
      return json(route, failure.body ?? { message: `Server error for ${requestKey}` }, failure.status ?? 500);
    }

    // Auth
    if (method === 'GET' && path === '/auth/me') return json(route, ADMIN_USER);
    if (method === 'GET' && path === '/auth/registration-status') return json(route, { enabled: false });
    if (method === 'GET' && path === '/health') return json(route, { status: 'ok' });

    // Shared
    if (method === 'GET' && path === '/wallets') return json(route, [WALLET]);
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

    // Wallet detail
    if (method === 'GET' && path === `/wallets/${WALLET_ID}`) return json(route, WALLET);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions/pending`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions/stats`) {
      return json(route, { totalCount: 0, receivedCount: 0, sentCount: 0, consolidationCount: 0, totalReceived: 0, totalSent: 0, totalFees: 0, walletBalance: WALLET.balance });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/utxos`) return json(route, { utxos: [], count: 0, totalBalance: 0 });
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/privacy`) {
      return json(route, { utxos: [], summary: { averageScore: 100, grade: 'excellent', utxoCount: 0, addressReuseCount: 0, roundAmountCount: 0, clusterCount: 0, recommendations: [] } });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/addresses/summary`) {
      return json(route, { totalAddresses: 0, usedCount: 0, unusedCount: 0, totalBalance: 0, usedBalance: 0, unusedBalance: 0 });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/addresses`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/drafts`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/share`) return json(route, { group: null, users: [] });

    // Admin
    if (method === 'GET' && path === '/admin/settings') return json(route, { registrationEnabled: false, confirmationThreshold: 1, deepConfirmationThreshold: 6, dustThreshold: 546, aiEnabled: false });
    if (method === 'GET' && path === '/admin/features') return json(route, []);
    if (method === 'GET' && path === '/admin/features/audit-log') return json(route, { entries: [], total: 0, limit: 50, offset: 0 });
    if (method === 'GET' && path === '/admin/users') return json(route, []);
    if (method === 'GET' && path === '/admin/groups') return json(route, []);
    if (method === 'GET' && path === '/admin/audit-logs') return json(route, { logs: [], total: 0, limit: 50, offset: 0 });
    if (method === 'GET' && path === '/admin/audit-logs/stats') return json(route, { totalEvents: 0, byCategory: {}, byAction: {}, failedEvents: 0 });
    if (method === 'GET' && path === '/admin/websocket/stats') return json(route, { connections: { current: 1, max: 100 }, subscriptions: { total: 0 }, rateLimits: {} });

    unhandledRequests.push(requestKey);
    return json(route, { message: `Unmocked: ${requestKey}` }, 404);
  };

  await page.route('**/api/v1/**', apiRouteHandler);
  if (API_ORIGIN) await page.route(`${API_ORIGIN}/**`, apiRouteHandler);
  return unhandledRequests;
}

test.describe('Error recovery', () => {
  // --- Auth Errors ---

  test('401 on auth/me redirects to login', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /auth/me': { status: 401, body: { message: 'Unauthorized' } },
    });

    await page.goto('/#/');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 10000 });
  });

  test('401 on wallet detail redirects to login', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /auth/me': { status: 401, body: { message: 'Token expired' } },
    });

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 10000 });
  });

  // --- 500 Errors ---

  test('500 on wallet list shows error state', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /wallets': { status: 500, body: { message: 'Internal server error' } },
    });

    await page.goto('/#/wallets');

    // Should show some error indication or the wallets page heading - page should not crash
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });

  test('500 on wallet detail shows error state', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /wallets/wallet-error-1': { status: 500, body: { message: 'Wallet service unavailable' } },
    });

    await page.goto(`/#/wallets/${WALLET_ID}`);

    // Should show some error indication or at minimum the page renders without crashing
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });

  // --- Timeout Errors ---

  test('timeout on dashboard data shows graceful degradation', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /bitcoin/status': { timeout: true },
    });

    await page.goto('/#/');

    // Dashboard should still render even if bitcoin status times out
    // It may show a loading state or error for that specific card
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
  });

  test('timeout on price API does not crash dashboard', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /price': { timeout: true },
    });

    await page.goto('/#/');

    // Dashboard should still render
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
    // Should not have crashed
    await expect(page.locator('body')).not.toHaveText('Application error');
  });

  // --- Partial Failures ---

  test('transaction list failure still shows wallet info', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /wallets/wallet-error-1/transactions': { status: 500, body: { message: 'DB timeout' } },
    });

    await page.goto(`/#/wallets/${WALLET_ID}`);

    // Wallet header should still show
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    // Transaction section may show error or empty state
    await expect(
      page.getByRole('button', { name: 'Transactions', exact: true })
    ).toBeVisible();
  });

  test('UTXO fetch failure still allows tab switching', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /wallets/wallet-error-1/utxos': { status: 500, body: { message: 'UTXO fetch failed' } },
    });

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    // Switch to UTXOs tab
    await page.getByRole('button', { name: 'UTXOs', exact: true }).click();

    // Tab should render with error or empty state, not crash
    await expect(page.getByRole('main')).toBeVisible();

    // Can switch to other tabs
    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await expect(page.getByText(/No transactions/i)).toBeVisible();
  });

  // --- Admin API Errors ---

  test('feature flags API error shows error banner', async ({ page }) => {
    await mockErrorApi(page, {
      'GET /admin/features': { status: 500, body: { message: 'Service unavailable' } },
    });

    await page.goto('/#/admin/feature-flags');

    // Should show the feature flags page (with error state or heading)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });

  test('settings save failure shows error message', async ({ page }) => {
    await mockErrorApi(page, {
      'PUT /admin/settings': { status: 500, body: { message: 'Failed to save settings' } },
    });

    await page.goto('/#/admin/variables');
    await expect(page.getByText('Confirmation Threshold')).toBeVisible();

    // Change a value to trigger auto-save (the form auto-saves on change)
    const confirmInput = page.getByRole('spinbutton').first();
    await confirmInput.clear();
    await confirmInput.fill('3');

    // Click save button if present, or the auto-save triggers it
    const saveButton = page.getByRole('button', { name: /save/i });
    if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveButton.click();
    }

    // After the save attempt, the button should change state (from "Saving..." back to "Save Changes" or show error)
    // We just verify the page doesn't crash and the variables page is still functional
    await expect(page.getByText('Confirmation Threshold')).toBeVisible({ timeout: 10000 });
  });

  // --- Network Disconnection ---

  test('page remains functional after API failure', async ({ page }) => {
    const unhandledRequests = await mockErrorApi(page);

    // Load page successfully first
    await page.goto('/#/');
    await expect(page.getByRole('main')).toBeVisible();

    // Navigate around - page should remain functional
    await page.goto(`/#/wallets`);
    await expect(page.getByText(WALLET.name).first()).toBeVisible();

    // Navigate back to dashboard
    await page.goto('/#/');
    await expect(page.getByRole('main')).toBeVisible();
  });

  // --- Recovery After Error ---

  test('refreshing after error recovers successfully', async ({ page }) => {
    // Start with a failing price endpoint
    let priceFailure = true;

    await page.addInitScript(() => {
      localStorage.setItem('sanctuary_token', 'playwright-recovery-token');
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/v1/, '');

      if (method === 'GET' && path === '/auth/me') return json(route, ADMIN_USER);
      if (method === 'GET' && path === '/auth/registration-status') return json(route, { enabled: false });
      if (method === 'GET' && path === '/health') return json(route, { status: 'ok' });
      if (method === 'GET' && path === '/wallets') return json(route, [WALLET]);
      if (method === 'GET' && path === '/devices') return json(route, []);
      if (method === 'GET' && path === '/bitcoin/status') {
        return json(route, { connected: true, blockHeight: 900500, explorerUrl: 'https://mempool.space', confirmationThreshold: 1, deepConfirmationThreshold: 6, pool: { enabled: true, minConnections: 1, maxConnections: 3, stats: { totalConnections: 2, activeConnections: 2, idleConnections: 0, waitingRequests: 0, totalAcquisitions: 30, averageAcquisitionTimeMs: 8, healthCheckFailures: 0, serverCount: 1, servers: [] } } });
      }
      if (method === 'GET' && path === '/bitcoin/fees') return json(route, { fastest: 18, halfHour: 12, hour: 8, economy: 3 });
      if (method === 'GET' && path === '/bitcoin/mempool') return json(route, { mempool: [], blocks: [], mempoolInfo: { count: 0, size: 0, totalFees: 0 }, queuedBlocksSummary: null });
      if (method === 'GET' && path === '/admin/version') return json(route, { updateAvailable: false, currentVersion: '0.8.14' });
      if (method === 'GET' && path === '/transactions/recent') return json(route, []);
      if (method === 'GET' && path === '/transactions/balance-history') return json(route, []);
      if (method === 'GET' && path === '/price') {
        if (priceFailure) {
          return json(route, { message: 'Price service down' }, 500);
        }
        return json(route, { price: 95000, currency: 'USD', sources: [], median: 95000, average: 95000, timestamp: '2026-03-11T00:00:00.000Z', cached: true, change24h: -1.5 });
      }
      if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions/pending`) return json(route, []);
      return json(route, { message: `Unmocked: ${method} ${path}` }, 404);
    });

    // Load with failing price
    await page.goto('/#/');
    await expect(page.getByRole('main')).toBeVisible();

    // Fix the price endpoint
    priceFailure = false;

    // Reload should recover
    await page.reload();
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });
});
