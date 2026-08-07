/**
 * Dashboard Price Display & Block Visualizer E2E Tests
 *
 * Tests:
 * 1. 24h price change renders correctly with positive/negative values
 * 2. Block visualizer tooltip appears above blocks (not clipped by overflow)
 */

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
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

type MockApiResponse = {
  status?: number;
  body: unknown;
};

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
};

type DashboardApiOptions = {
  change24h?: number | null;
  price?: number;
  includeBlocks?: boolean;
};

type DashboardApiScenario = {
  change24h: number | null;
  price: number;
  includeBlocks: boolean;
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

function createDashboardApiScenario(options?: DashboardApiOptions): DashboardApiScenario {
  return {
    change24h: options?.change24h !== undefined ? options.change24h : 2.45,
    price: options?.price ?? 75000,
    includeBlocks: options?.includeBlocks ?? true,
  };
}

function createPriceResponse(scenario: DashboardApiScenario) {
  const { price, change24h } = scenario;
  return {
    price,
    currency: 'USD',
    sources: [{ provider: 'kraken', price, currency: 'USD', timestamp: '2026-03-11T00:00:00.000Z', change24h }],
    median: price,
    average: price,
    timestamp: '2026-03-11T00:00:00.000Z',
    cached: true,
    change24h,
  };
}

function createMempoolResponse(includeBlocks: boolean) {
  return {
    mempool: includeBlocks ? PENDING_BLOCKS : [],
    blocks: includeBlocks ? CONFIRMED_BLOCKS : [],
    mempoolInfo: { count: 5000, size: 12000000, totalFees: 1.5 },
    queuedBlocksSummary: null,
  };
}

const BITCOIN_STATUS_RESPONSE = {
  connected: true,
  blockHeight: 900100,
  explorerUrl: 'https://mempool.space',
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  pool: { enabled: false },
  host: 'electrum.blockstream.info',
};

const ADMIN_SETTINGS_RESPONSE = {
  registrationEnabled: false,
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  dustThreshold: 546,
  aiEnabled: false,
};

const WEBSOCKET_STATS_RESPONSE = {
  connections: { current: 1, max: 100, uniqueUsers: 1, maxPerUser: 10 },
  subscriptions: { total: 0, channels: 0, channelList: [] },
  rateLimits: {
    maxMessagesPerSecond: 15,
    gracePeriodMs: 2000,
    gracePeriodMessageLimit: 30,
    maxSubscriptionsPerConnection: 40,
  },
  recentRateLimitEvents: [],
};

const STATIC_DASHBOARD_API_RESPONSES: Record<string, MockApiResponse> = {
  'GET /auth/me': mockResponse(ADMIN_USER),
  'GET /auth/registration-status': mockResponse({ enabled: false }),
  'GET /wallets': mockResponse([MAINNET_WALLET]),
  'GET /devices': mockResponse([]),
  'GET /health': mockResponse({ status: 'ok' }),
  'GET /admin/version': mockResponse({ updateAvailable: false, currentVersion: '0.8.15' }),
  'GET /admin/agents': mockResponse([]),
  'GET /bitcoin/status': mockResponse(BITCOIN_STATUS_RESPONSE),
  'GET /bitcoin/fees': mockResponse({ fastest: 18, halfHour: 12, hour: 8, economy: 3 }),
  'GET /transactions/recent': mockResponse([]),
  'GET /transactions/activity-summary': mockResponse({ count: 0, receivedSats: 0, sentSats: 0, latestAt: null }),
  'GET /transactions/balance-history': mockResponse([
    { name: 'Start', value: 100000000 },
    { name: 'Now', value: 100000000 },
  ]),
  [`GET /wallets/${MAINNET_WALLET_ID}/transactions/pending`]: mockResponse([]),
  'GET /admin/features': mockResponse([]),
  'GET /admin/settings': mockResponse(ADMIN_SETTINGS_RESPONSE),
  'GET /admin/websocket/stats': mockResponse(WEBSOCKET_STATS_RESPONSE),
  'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
};

function getDashboardApiResponse(
  requestKey: string,
  scenario: DashboardApiScenario
): MockApiResponse | null {
  if (requestKey === 'GET /price') {
    return mockResponse(createPriceResponse(scenario));
  }
  if (requestKey === 'GET /bitcoin/mempool') {
    return mockResponse(createMempoolResponse(scenario.includeBlocks));
  }
  return STATIC_DASHBOARD_API_RESPONSES[requestKey] ?? null;
}

function createDashboardApiRouteHandler(scenario: DashboardApiScenario) {
  const apiRouteHandler = async (route: Route) => {
    const { method, path, requestKey } = parseApiRoute(route);
    const response = getDashboardApiResponse(requestKey, scenario);

    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

async function mockDashboardApi(
  page: Page,
  options?: DashboardApiOptions
) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-dash-price-token');
  });

  await registerApiRoutes(
    page,
    createDashboardApiRouteHandler(createDashboardApiScenario(options))
  );
}

function getFirstConfirmedBlockButton(page: Page) {
  return page.getByRole('button', { name: /confirmed block 900,100/i });
}

function getNextPendingBlockButton(page: Page) {
  return page.getByRole('button', { name: /pending block next/i });
}

function getBlockTooltip(page: Page, txCountText: string) {
  return page.locator('.block-visualizer-tooltip', { hasText: txCountText }).first();
}

async function waitForBlockTooltipStyles(blockButton: Locator, tooltip: Locator) {
  await expect.poll(async () => {
    const [buttonPosition, tooltipPosition] = await Promise.all([
      blockButton.evaluate((element) => getComputedStyle(element).position),
      tooltip.evaluate((element) => getComputedStyle(element).position),
    ]);

    return `${buttonPosition}:${tooltipPosition}`;
  }, { timeout: 10000 }).toBe('relative:absolute');
}

async function hoverBlockAndWaitForTooltip(blockButton: Locator, tooltip: Locator) {
  await waitForBlockTooltipStyles(blockButton, tooltip);
  await blockButton.hover();

  await expect.poll(async () => {
    return tooltip.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
  }, { timeout: 5000 }).toBeGreaterThan(0.9);
}

async function expectTooltipAboveBlock(tooltip: Locator, blockButton: Locator) {
  await expect.poll(async () => {
    const tooltipBox = await tooltip.boundingBox();
    const blockBox = await blockButton.boundingBox();

    if (!tooltipBox || !blockBox) {
      return Number.POSITIVE_INFINITY;
    }

    return tooltipBox.y + tooltipBox.height - blockBox.y;
  }, { timeout: 5000 }).toBeLessThanOrEqual(4);
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

    const blockButton = getFirstConfirmedBlockButton(page);
    await expect(blockButton).toBeVisible({ timeout: 10000 });

    const tooltip = getBlockTooltip(page, '2,800 txs');
    await hoverBlockAndWaitForTooltip(blockButton, tooltip);

    // Verify tooltip contains fee info
    await expect(tooltip).toContainText('Range: 8-25');
    await expectTooltipAboveBlock(tooltip, blockButton);
  });

  test('tooltip shows block fullness percentage', async ({ page }) => {
    await mockDashboardApi(page, { includeBlocks: true });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    const blockButton = getFirstConfirmedBlockButton(page);
    await expect(blockButton).toBeVisible({ timeout: 10000 });

    const tooltip = getBlockTooltip(page, '2,800 txs');
    await hoverBlockAndWaitForTooltip(blockButton, tooltip);

    // Tooltip should show fullness percentage
    // Block size is 1.4, fillPercentage = min((1.4 / 1.6) * 100, 100)
    // Note: 1.4/1.6 = 0.8749999999999999 (floating point), so Math.round(87.49...) = 87
    await expect(tooltip).toContainText('87%');
  });

  test('pending block tooltip also appears above', async ({ page }) => {
    await mockDashboardApi(page, { includeBlocks: true });
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    const blockButton = getNextPendingBlockButton(page);
    await expect(blockButton).toBeVisible({ timeout: 10000 });
    const tooltip = getBlockTooltip(page, '1,500 txs');
    await hoverBlockAndWaitForTooltip(blockButton, tooltip);
    await expectTooltipAboveBlock(tooltip, blockButton);
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

// ─── 3. Fee Estimation Tier Alignment ────────────────────────────────

type FeeCardAlignment = {
  /** Per tier, how far the tier name's centre sits from its rate's centre. */
  nameOffsets: number[];
  /** Per separator, how far its line box sits from the first rate's. */
  separatorOffsets: number[];
};

const ALIGNMENT_TIMEOUT_MS = 15000;

/**
 * Measures the fee card's horizontal and vertical alignment. Returns null
 * until the card has settled into its three-tier shape, so callers can poll.
 *
 * Every measurement comes from a single `evaluate` on purpose: these offsets
 * are only meaningful if they were all read from the same layout, and a rate
 * flashes when it changes, so per-element `boundingBox()` round-trips could
 * each land on a different frame.
 */
async function readFeeCardAlignment(page: Page): Promise<FeeCardAlignment | null> {
  return page.getByTestId('telemetry-fees').evaluate((card) => {
    // Measure the text, not the element. A grid item that is allowed to
    // stretch fills its whole track, so two stretched boxes share a centre
    // even when the glyphs inside them do not — the element box would report
    // a misalignment as aligned.
    const textRect = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    };
    const centreX = (node: Element) => {
      const rect = textRect(node);
      return rect.x + rect.width / 2;
    };
    const topY = (node: Element) => textRect(node).y;

    const separators = [...card.querySelectorAll('[data-testid="fee-tier-separator"]')];
    // `.number-transition` is AnimatedFeeRate's own class; scoped to one tier
    // it identifies that tier's rate unambiguously.
    const tiers = [...card.querySelectorAll('[data-testid="fee-tier"]')].flatMap((tier) => {
      const rate = tier.querySelector('.number-transition');
      const name = tier.querySelector('[data-testid="fee-tier-name"]');
      return rate && name ? [{ rate, name }] : [];
    });

    const firstRate = tiers[0]?.rate;
    if (tiers.length !== 3 || separators.length !== 2 || !firstRate) {
      return null;
    }

    // Tailwind comes from the Play CDN and applies asynchronously, so there is
    // a window where a tier is a plain inline span. Every offset measured then
    // is meaningless — and the separator ones are a false zero, because
    // unstyled spans share one line box. Wait for the grid to exist.
    const tierDisplay = firstRate.parentElement
      ? getComputedStyle(firstRate.parentElement).display
      : '';
    if (!tierDisplay.includes('grid')) {
      return null;
    }

    // Absolute distances: a signed offset can round to -0, which `toEqual`
    // treats as different from 0.
    return {
      nameOffsets: tiers.map(({ rate, name }) => Math.abs(centreX(name) - centreX(rate))),
      separatorOffsets: separators.map((separator) => Math.abs(topY(separator) - topY(firstRate))),
    };
  });
}

test.describe('Fee Estimation card alignment', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('telemetry-fees')).toBeVisible({ timeout: ALIGNMENT_TIMEOUT_MS });

    // Alignment holds just as well between three '---' placeholders, so pin the
    // rates first: a broken fees mock must not green these tests.
    await expect(page.getByTestId('fee-tier').first()).toContainText('18');
  });

  test('each tier name sits centred under the rate it names', async ({ page }) => {
    // The rates and the tier names used to be two sibling rows, each sizing
    // its own tracks, so every name drifted left of the rate it names — 12px,
    // 17px and 15px at these mocked rates, and worse for wider figures. A tier
    // is one grid now, so a name and its rate share a track.
    await expect
      .poll(
        async () => (await readFeeCardAlignment(page))?.nameOffsets.map((offset) => Math.round(offset)) ?? null,
        { timeout: ALIGNMENT_TIMEOUT_MS }
      )
      .toEqual([0, 0, 0]);
  });

  test('the tier separators sit on the same line as the rates', async ({ page }) => {
    // Baseline-aligning a row whose tiers lead with a dot took each tier's
    // baseline from that dot rather than from the digits, which floated the
    // separators 5px above the rates they separate.
    await expect
      .poll(
        async () => (await readFeeCardAlignment(page))?.separatorOffsets.map((offset) => Math.round(offset)) ?? null,
        { timeout: ALIGNMENT_TIMEOUT_MS }
      )
      .toEqual([0, 0]);
  });
});
