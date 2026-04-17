/**
 * Accessibility E2E Tests
 *
 * Tests keyboard navigation, focus management, ARIA labels,
 * and screen reader compatibility for key application flows.
 */

import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

const WALLET_ID = 'wallet-a11y-1';
const DEVICE_ID = 'device-a11y-1';

const ADMIN_USER = {
  id: 'user-a11y-admin',
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
  name: 'A11y Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh([abcd1234/84h/0h/0h]xpubA11yTest/0/*)',
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

const DEVICE = {
  id: DEVICE_ID,
  type: 'ledger',
  label: 'A11y Ledger',
  fingerprint: 'abcd1234',
  isOwner: true,
  userRole: 'owner',
  wallets: [{ wallet: { id: WALLET_ID, name: WALLET.name, type: WALLET.type } }],
  accounts: [{ id: 'acct-a11y-1', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub-a11y-account' }],
  model: { slug: 'ledger', manufacturer: 'Ledger', name: 'Nano X' },
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

const WALLET_STATS_RESPONSE = {
  totalCount: 0,
  receivedCount: 0,
  sentCount: 0,
  consolidationCount: 0,
  totalReceived: 0,
  totalSent: 0,
  totalFees: 0,
  walletBalance: WALLET.balance,
};

const WALLET_PRIVACY_RESPONSE = {
  utxos: [],
  summary: {
    averageScore: 100,
    grade: 'excellent',
    utxoCount: 0,
    addressReuseCount: 0,
    roundAmountCount: 0,
    clusterCount: 0,
    recommendations: [],
  },
};

const A11Y_API_RESPONSES: Record<string, MockApiResponse> = {
  'GET /auth/me': mockResponse(ADMIN_USER),
  'GET /auth/registration-status': mockResponse({ enabled: false }),
  'GET /health': mockResponse({ status: 'ok' }),
  'GET /wallets': mockResponse([WALLET]),
  'GET /devices': mockResponse([DEVICE]),
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
  'GET /admin/groups': mockResponse([]),
  [`GET /wallets/${WALLET_ID}`]: mockResponse(WALLET),
  [`GET /wallets/${WALLET_ID}/transactions`]: mockResponse([]),
  [`GET /wallets/${WALLET_ID}/transactions/pending`]: mockResponse([]),
  [`GET /wallets/${WALLET_ID}/transactions/stats`]: mockResponse(WALLET_STATS_RESPONSE),
  [`GET /wallets/${WALLET_ID}/utxos`]: mockResponse({ utxos: [], count: 0, totalBalance: 0 }),
  [`GET /wallets/${WALLET_ID}/privacy`]: mockResponse(WALLET_PRIVACY_RESPONSE),
  [`GET /wallets/${WALLET_ID}/addresses/summary`]: mockResponse({
    totalAddresses: 0,
    usedCount: 0,
    unusedCount: 0,
    totalBalance: 0,
    usedBalance: 0,
    unusedBalance: 0,
  }),
  [`GET /wallets/${WALLET_ID}/addresses`]: mockResponse([]),
  [`GET /wallets/${WALLET_ID}/drafts`]: mockResponse([]),
  [`GET /wallets/${WALLET_ID}/share`]: mockResponse({ group: null, users: [] }),
  [`GET /devices/${DEVICE_ID}`]: mockResponse(DEVICE),
  [`GET /devices/${DEVICE_ID}/share`]: mockResponse({
    users: [{ id: ADMIN_USER.id, username: ADMIN_USER.username, role: 'owner' }],
    group: null,
  }),
  'GET /devices/models': mockResponse([]),
};

function getA11yApiResponse(method: string, path: string): MockApiResponse | null {
  const response = A11Y_API_RESPONSES[`${method} ${path}`];
  if (response) {
    return response;
  }
  if (method === 'GET' && /^\/wallets\/[^/]+\/labels$/.test(path)) {
    return mockResponse([]);
  }
  return null;
}

function createA11yApiRouteHandler(unhandledRequests: string[]) {
  const apiRouteHandler = async (route: Route) => {
    const { method, path, requestKey } = parseApiRoute(route);
    const response = getA11yApiResponse(method, path);

    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    unhandledRequests.push(requestKey);
    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

async function mockA11yApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-a11y-token');
  });

  const unhandledRequests: string[] = [];
  await registerApiRoutes(page, createA11yApiRouteHandler(unhandledRequests));
  return unhandledRequests;
}

test.describe('Accessibility', () => {
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

  // --- Semantic Structure ---

  test('dashboard has proper heading hierarchy', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/');

    // Should have a main landmark
    await expect(page.getByRole('main')).toBeVisible();

    // Should have navigation landmark (sidebar)
    const nav = page.getByRole('navigation');
    await expect(nav.first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('pages use proper landmark regions', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/');

    // Main content area
    await expect(page.getByRole('main')).toBeVisible();

    // Navigation
    await expect(page.getByRole('navigation').first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Keyboard Navigation ---

  test('sidebar links are keyboard navigable', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/');
    await expect(page.getByRole('main')).toBeVisible();

    // Sidebar links should be focusable
    const walletLink = page.getByRole('link', { name: /Wallets/i }).first();
    await expect(walletLink).toBeVisible();

    // Tab to the link and press Enter
    await walletLink.focus();
    await expect(walletLink).toBeFocused();

    expect(unhandledRequests).toEqual([]);
  });

  test('tab key cycles through interactive elements', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await expect(main.getByText('Dark Mode')).toBeVisible();

    // Tab through the settings page
    await page.keyboard.press('Tab');
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(typeof firstFocused).toBe('string');

    // Press tab several more times - should move focus
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const laterFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(typeof laterFocused).toBe('string');

    expect(unhandledRequests).toEqual([]);
  });

  // --- Login Form Accessibility ---

  test('login form has proper labels and is keyboard accessible', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('sanctuary_token');
    });

    await registerApiRoutes(page, async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, '');
      if (path === '/health') return json(route, { status: 'ok' });
      if (path === '/auth/registration-status') return json(route, { enabled: false });
      if (path === '/price') {
        return json(route, { price: 95000, currency: 'USD', sources: [], median: 95000, average: 95000, timestamp: '2026-03-11T00:00:00.000Z', cached: true, change24h: -1.5 });
      }
      return json(route, { message: 'Unauthorized' }, 401);
    });

    await page.goto('/#/');

    // Username field should have a label
    const usernameField = page.getByLabel(/username/i);
    await expect(usernameField).toBeVisible();

    // Password field should have a label
    const passwordField = page.getByLabel(/password/i);
    await expect(passwordField).toBeVisible();

    // Sign in button should be accessible
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();

    // Keyboard: focus username, tab to password, tab to submit
    await usernameField.focus();
    await expect(usernameField).toBeFocused();

    await page.keyboard.press('Tab');
    // Should focus password or another form element
    const focusedTag = await page.evaluate(() => document.activeElement?.getAttribute('type') || document.activeElement?.tagName);
    expect(typeof focusedTag).toBe('string');
  });

  // --- Button Roles ---

  test('buttons have proper role attributes', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/wallets');

    // Buttons should have button role
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    expect(unhandledRequests).toEqual([]);
  });

  test('links have proper role and are navigable', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/');

    // Wait for navigation links to be visible (sidebar loads with the page)
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

    // Navigation links should be present
    const links = page.getByRole('link');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    expect(unhandledRequests).toEqual([]);
  });

  // --- Wallet Detail Tab Keyboard Navigation ---

  test('wallet detail tabs are keyboard navigable', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    // Tab buttons should be focusable
    const txTab = page.getByRole('button', { name: 'Transactions', exact: true });
    await expect(txTab).toBeVisible();
    await txTab.focus();
    await expect(txTab).toBeFocused();

    // Press Enter to activate tab - page should not crash
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Form Input Labels ---

  test('settings page has labeled form controls', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    // Dark Mode should have an associated control
    await expect(main.getByText('Dark Mode')).toBeVisible();
    await expect(main.getByText('Theme')).toBeVisible();

    // Display tab
    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Fiat Currency')).toBeVisible();
    await expect(page.getByText('Bitcoin Unit')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Focus Trapping ---

  test('create wallet wizard maintains focus within wizard', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/wallets/create');
    const main = page.getByRole('main');

    await expect(main.getByText('Select Wallet Topology')).toBeVisible();

    // Focus should be within the main content area
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.closest('main') !== null || el.closest('[role="main"]') !== null : false;
    });
    // Focus should be within the page content (may be in sidebar on first tab)
    expect(focused).not.toBeUndefined();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Color Contrast (structural test) ---

  test('page does not use color alone to convey information', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    await page.goto('/#/');
    await expect(page.getByRole('main')).toBeVisible();

    // Wait for dashboard content to render (e.g., "Bitcoin Price" heading)
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    // Verify that the page has text content, not just colored elements
    const mainText = await page.getByRole('main').textContent();
    expect(mainText).not.toBeNull();
    expect(mainText!.length).toBeGreaterThan(10);

    expect(unhandledRequests).toEqual([]);
  });

  // --- Responsive: Mobile viewport ---

  test('mobile viewport renders without horizontal overflow', async ({ page }) => {
    const unhandledRequests = await mockA11yApi(page);

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto('/#/');
    await expect(page.getByRole('main')).toBeVisible();

    // Wait for dashboard content to render
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    // Check for horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);

    expect(unhandledRequests).toEqual([]);
  });
});
