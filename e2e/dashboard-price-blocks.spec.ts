/**
 * Dashboard Price Display & Block Visualizer E2E Tests
 *
 * Tests:
 * 1. 24h price change renders correctly with positive/negative values
 * 2. Block visualizer tooltip appears above blocks (not clipped by overflow)
 */

import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

const MAINNET_WALLET_ID = 'wallet-dash-price-1';

const ADMIN_USER = {
  id: 'user-dash-price',
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

const MAINNET_WALLET = {
  id: MAINNET_WALLET_ID,
  name: 'Price Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh([abcd1234/84h/0h/0h]xpubPriceTest/0/*)',
  fingerprint: 'abcd1234',
  balance: 100000000,
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

const CONFIRMED_BLOCKS = [
  {
    height: 900100,
    medianFee: 12,
    feeRange: '8-25',
    size: 1.4,
    time: '10:30',
    status: 'confirmed',
    txCount: 2800,
    totalFees: 0.15,
    hash: 'abc123confirmed1',
  },
  {
    height: 900099,
    medianFee: 15,
    feeRange: '10-30',
    size: 1.2,
    time: '10:20',
    status: 'confirmed',
    txCount: 2500,
    totalFees: 0.12,
    hash: 'abc123confirmed2',
  },
];

const PENDING_BLOCKS = [
  {
    height: 'Next',
    medianFee: 18,
    feeRange: '12-35',
    size: 0.8,
    time: '~10 min',
    status: 'pending',
    txCount: 1500,
  },
  {
    height: '+1',
    medianFee: 10,
    feeRange: '6-20',
    size: 0.5,
    time: '~20 min',
    status: 'pending',
    txCount: 900,
  },
];

async function mockDashboardApi(
  page: Page,
  options?: {
    change24h?: number | null;
    price?: number;
    includeBlocks?: boolean;
  }
) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-dash-price-token');
  });

  const change24h = options?.change24h !== undefined ? options.change24h : 2.45;
  const price = options?.price ?? 75000;
  const includeBlocks = options?.includeBlocks ?? true;

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    if (method === 'GET' && path === '/auth/me') {
      return json(route, ADMIN_USER);
    }
    if (method === 'GET' && path === '/auth/registration-status') {
      return json(route, { enabled: false });
    }
    if (method === 'GET' && path === '/wallets') {
      return json(route, [MAINNET_WALLET]);
    }
    if (method === 'GET' && path === '/devices') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/health') {
      return json(route, { status: 'ok' });
    }
    if (method === 'GET' && path === '/admin/version') {
      return json(route, { updateAvailable: false, currentVersion: '0.8.15' });
    }
    if (method === 'GET' && path === '/price') {
      return json(route, {
        price,
        currency: 'USD',
        sources: [{ provider: 'kraken', price, currency: 'USD', timestamp: '2026-03-11T00:00:00.000Z', change24h }],
        median: price,
        average: price,
        timestamp: '2026-03-11T00:00:00.000Z',
        cached: true,
        change24h,
      });
    }
    if (method === 'GET' && path === '/bitcoin/status') {
      return json(route, {
        connected: true,
        blockHeight: 900100,
        explorerUrl: 'https://mempool.space',
        confirmationThreshold: 1,
        deepConfirmationThreshold: 6,
        pool: { enabled: false },
        host: 'electrum.blockstream.info',
      });
    }
    if (method === 'GET' && path === '/bitcoin/fees') {
      return json(route, { fastest: 18, halfHour: 12, hour: 8, economy: 3 });
    }
    if (method === 'GET' && path === '/bitcoin/mempool') {
      return json(route, {
        mempool: includeBlocks ? PENDING_BLOCKS : [],
        blocks: includeBlocks ? CONFIRMED_BLOCKS : [],
        mempoolInfo: { count: 5000, size: 12000000, totalFees: 1.5 },
        queuedBlocksSummary: null,
      });
    }
    if (method === 'GET' && path === '/transactions/recent') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/transactions/balance-history') {
      return json(route, [
        { name: 'Start', value: 100000000 },
        { name: 'Now', value: 100000000 },
      ]);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/transactions/pending`) {
      return json(route, []);
    }
    if (method === 'GET' && path === '/admin/features') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/admin/settings') {
      return json(route, {
        registrationEnabled: false,
        confirmationThreshold: 1,
        deepConfirmationThreshold: 6,
        dustThreshold: 546,
        aiEnabled: false,
      });
    }
    if (method === 'GET' && path === '/admin/websocket/stats') {
      return json(route, {
        connections: { current: 1, max: 100, uniqueUsers: 1, maxPerUser: 10 },
        subscriptions: { total: 0, channels: 0, channelList: [] },
        rateLimits: { maxMessagesPerSecond: 15, gracePeriodMs: 2000, gracePeriodMessageLimit: 30, maxSubscriptionsPerConnection: 40 },
        recentRateLimitEvents: [],
      });
    }

    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);
}

// ─── 1. 24h Price Change Display ─────────────────────────────────────

test.describe('Dashboard 24h Price Change', () => {
  test('displays positive 24h price change with percentage and trending icon', async ({ page }) => {
    await mockDashboardApi(page, { change24h: 2.45, price: 75000 });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // Verify the price renders
    await expect(page.getByText('$75,000')).toBeVisible();

    // Verify the 24h change percentage displays
    const changeText = page.getByText('+2.45%');
    await expect(changeText).toBeVisible();

    // Verify the "24h" label is present
    await expect(page.getByText('24h')).toBeVisible();
  });

  test('displays negative 24h price change', async ({ page }) => {
    await mockDashboardApi(page, { change24h: -3.21, price: 72000 });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // Verify the negative change percentage displays
    const changeText = page.getByText('-3.21%');
    await expect(changeText).toBeVisible();
  });

  test('displays --- when change24h is null', async ({ page }) => {
    await mockDashboardApi(page, { change24h: null, price: 75000 });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // When change24h is null, the price change area should not show a percentage
    const priceChange = page.getByTestId('price-change-24h');
    await expect(priceChange).toBeVisible({ timeout: 10000 });
    // Should not contain any percentage value
    await expect(priceChange).not.toHaveText(/%/);
  });

  test('displays zero change correctly', async ({ page }) => {
    await mockDashboardApi(page, { change24h: 0, price: 75000 });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // Zero change should display as +0.00%
    const changeText = page.getByText('+0.00%');
    await expect(changeText).toBeVisible();
  });
});

// ─── 2. Block Visualizer Tooltip ─────────────────────────────────────

test.describe('Block Visualizer Tooltip', () => {
  test('block tooltip appears above the block and is not clipped', async ({ page }) => {
    await mockDashboardApi(page, { includeBlocks: true });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // Wait for blocks to render — target the block button specifically (block height also shows in status area)
    const blockButton = page.locator('button', { hasText: '900,100' }).first();
    await expect(blockButton).toBeVisible({ timeout: 10000 });

    // Hover the block button
    await blockButton.hover();

    // The tooltip should appear with transaction count and details
    const tooltip = page.getByText('2,800 txs');
    await expect(tooltip).toBeVisible({ timeout: 5000 });

    // Verify tooltip contains fee info
    await expect(page.getByText('Range: 8-25')).toBeVisible();

    // Verify the tooltip is positioned above the block (bottom-full)
    // by checking it's visible and not hidden behind other elements
    const tooltipBox = await tooltip.boundingBox();
    const blockBox = await blockButton.boundingBox();

    expect(tooltipBox).toBeTruthy();
    expect(blockBox).toBeTruthy();

    if (tooltipBox && blockBox) {
      // Tooltip bottom edge should be above or at the block top edge
      // (tooltip is positioned with bottom-full mb-2, so it should be above)
      expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(blockBox.y + 4); // small tolerance
    }
  });

  test('tooltip shows block fullness percentage', async ({ page }) => {
    await mockDashboardApi(page, { includeBlocks: true });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // Wait for blocks to render — target the block button specifically (block height also shows in status area)
    const blockButton = page.locator('button', { hasText: '900,100' }).first();
    await expect(blockButton).toBeVisible({ timeout: 10000 });

    // Hover the block
    await blockButton.hover();

    // Wait for tooltip to appear (same pattern as the passing tooltip test above)
    const tooltip = page.getByText('2,800 txs');
    await expect(tooltip).toBeVisible({ timeout: 5000 });

    // Tooltip should show fullness percentage
    // Block size is 1.4, fillPercentage = min((1.4 / 1.6) * 100, 100) = 87.5 → 88%
    await expect(page.getByText('88%')).toBeVisible();
  });

  test('pending block tooltip also appears above', async ({ page }) => {
    await mockDashboardApi(page, { includeBlocks: true });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // Wait for a pending block to render — look for "Next" label
    const pendingBlock = page.getByText('Next');
    await expect(pendingBlock).toBeVisible({ timeout: 10000 });

    // Hover the pending block
    const blockButton = page.locator('button', { has: pendingBlock });
    await blockButton.hover();

    // Should show tx count for pending block
    const tooltip = page.getByText('1,500 txs');
    await expect(tooltip).toBeVisible({ timeout: 5000 });

    // Verify tooltip is above the block
    const tooltipBox = await tooltip.boundingBox();
    const blockBox = await blockButton.boundingBox();

    expect(tooltipBox).toBeTruthy();
    expect(blockBox).toBeTruthy();

    if (tooltipBox && blockBox) {
      expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(blockBox.y + 4);
    }
  });

  test('block fullness legend is visible below the visualizer', async ({ page }) => {
    await mockDashboardApi(page, { includeBlocks: true });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // The "Block Fullness:" legend should always be visible
    await expect(page.getByText('Block Fullness:')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('25%')).toBeVisible();
    await expect(page.getByText('100%')).toBeVisible();
  });
});
