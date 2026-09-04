/**
 * Node Status card — responsive layout and dark-mode parity.
 *
 * Covers plan section B4's responsive/dark evidence requirement: long server
 * labels must never overflow the card or the page at 375/768/1280px, the
 * truncated label's full text must still be accessible, and light/dark mode
 * must expose identical semantic text content.
 */

import { expect, test, type Page, type Route } from '@playwright/test';
import { json, registerApiRoutes, unmocked } from './helpers';

const WALLET_ID = 'wallet-node-status-responsive-1';

const LONG_LABEL_PRIMARY = 'Primary Electrum Server With An Extremely Long Configured Label Name';
const LONG_LABEL_BACKUP = 'Backup Electrum Server With An Equally Long Configured Label Name Too';

function makeUser(darkMode: boolean) {
  return {
    id: 'user-node-status-responsive',
    username: 'admin',
    isAdmin: true,
    usingDefaultPassword: false,
    preferences: {
      darkMode,
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
}

const WALLET = {
  id: WALLET_ID,
  name: 'Responsive Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh([abcd1234/84h/0h/0h]xpubResponsiveTest/0/*)',
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
      activeConnections: 1,
      idleConnections: 1,
      waitingRequests: 0,
      totalAcquisitions: 30,
      averageAcquisitionTimeMs: 8,
      healthCheckFailures: 0,
      serverCount: 2,
      servers: [],
    },
  },
  operational: {
    configuredMode: 'pool',
    attemptedAt: '2026-03-11T00:00:00.000Z',
    route: { transport: 'pool', observedAt: '2026-03-11T00:00:00.000Z', serverId: 'responsive-primary' },
    pool: {
      strategy: 'failover_only',
      online: 1,
      offline: 1,
      cooldown: 0,
      unchecked: 0,
      stale: 0,
      primaryServerId: 'responsive-primary',
      preferredServerId: 'responsive-primary',
      nextFailoverServerId: 'responsive-backup',
      servers: [
        {
          serverId: 'responsive-primary',
          label: LONG_LABEL_PRIMARY,
          host: 'primary.electrum.example',
          port: 50002,
          priority: 1,
          availability: 'online',
          checkedAt: '2026-03-11T00:00:00.000Z',
        },
        {
          serverId: 'responsive-backup',
          label: LONG_LABEL_BACKUP,
          host: 'backup.electrum.example',
          port: 50002,
          priority: 2,
          availability: 'offline',
          checkedAt: '2026-03-11T00:00:00.000Z',
        },
      ],
    },
  },
};

type MockApiResponse = { status?: number; body: unknown };

function mockResponse(body: unknown, status?: number): MockApiResponse {
  return { body, status };
}

function parseApiRoute(route: Route) {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, '');
  return { method, path, requestKey: `${method} ${path}` };
}

function apiResponses(): Record<string, MockApiResponse> {
  return {
    'GET /auth/registration-status': mockResponse({ enabled: false }),
    'GET /health': mockResponse({ status: 'ok' }),
    'GET /wallets': mockResponse([WALLET]),
    'GET /devices': mockResponse([]),
    'POST /hardware/jade/pin': mockResponse({}),
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
    'GET /transactions/recent': mockResponse([]),
    'GET /transactions/activity-summary': mockResponse({ count: 0, receivedSats: 0, sentSats: 0, latestAt: null }),
    'GET /transactions/balance-history': mockResponse([
      { name: 'Start', value: WALLET.balance },
      { name: 'Now', value: WALLET.balance },
    ]),
    'GET /ai/status': mockResponse({ enabled: false, available: false, proxyAvailable: false }),
    'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
    [`GET /wallets/${WALLET_ID}/transactions/pending`]: mockResponse([]),
    [`GET /wallets/${WALLET_ID}/drafts`]: mockResponse([]),
  };
}

async function mockDashboardApi(page: Page, darkMode: boolean): Promise<string[]> {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-node-status-responsive-token');
  });

  const responses: Record<string, MockApiResponse> = {
    'GET /auth/me': mockResponse(makeUser(darkMode)),
    'POST /auth/refresh': mockResponse({ message: 'Unauthorized' }, 401),
    ...apiResponses(),
  };

  const unhandledRequests: string[] = [];
  await registerApiRoutes(page, async (route: Route) => {
    const { method, path, requestKey } = parseApiRoute(route);
    const response = responses[requestKey];
    if (response) {
      await json(route, response.body, response.status);
      return;
    }
    unhandledRequests.push(requestKey);
    await unmocked(route, method, path);
  });

  return unhandledRequests;
}

const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x720', width: 1280, height: 720 },
];

test.describe('Node Status card responsive layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`long server labels never overflow the card or the page at ${viewport.name}`, async ({ page }) => {
      const unhandledRequests = await mockDashboardApi(page, false);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/#/');

      const card = page.getByTestId('telemetry-node');
      await expect(card).toBeVisible();

      // No horizontal page overflow at any viewport.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      // Every element inside the card stays within the card's own box.
      const cardBox = await card.boundingBox();
      expect(cardBox).not.toBeNull();
      const overflowingCount = await card.evaluate((el, box) => {
        if (!box) return -1;
        const margin = 1; // sub-pixel rounding tolerance
        let count = 0;
        el.querySelectorAll('*').forEach((child) => {
          const rect = child.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return; // not rendered
          if (
            rect.left < box.x - margin ||
            rect.right > box.x + box.width + margin
          ) {
            count += 1;
          }
        });
        return count;
      }, cardBox);
      expect(overflowingCount).toBe(0);

      // Truncated label text is still fully accessible via title, and
      // role/status text is visible independent of truncation.
      const toggle = card.getByRole('button', { name: /server/i });
      await toggle.click();
      const primaryLabel = card.getByTitle(LONG_LABEL_PRIMARY);
      await expect(primaryLabel).toHaveCount(1);
      expect(await primaryLabel.textContent()).toBe(LONG_LABEL_PRIMARY);
      await expect(card.getByText('Online', { exact: true })).toBeVisible();
      await expect(card.getByText('Offline', { exact: true })).toBeVisible();

      expect(unhandledRequests).toEqual([]);
    });
  }

  test('light and dark mode expose identical semantic text content at 1280x720', async ({ page, browserName }) => {
    const lightUnhandled = await mockDashboardApi(page, false);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#/');
    const card = page.getByTestId('telemetry-node');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /server/i }).click();
    const lightText = (await card.textContent())?.replace(/\s+/g, ' ').trim();
    expect(lightUnhandled).toEqual([]);

    await page.close();

    const context = await page.context().browser()?.newContext();
    if (!context) {
      throw new Error('failed to open a fresh context for the dark-mode capture');
    }
    const darkPage = await context.newPage();
    const darkUnhandled = await mockDashboardApi(darkPage, true);
    await darkPage.setViewportSize({ width: 1280, height: 720 });
    await darkPage.goto('/#/');
    const darkCard = darkPage.getByTestId('telemetry-node');
    await expect(darkCard).toBeVisible();
    await darkCard.getByRole('button', { name: /server/i }).click();
    const darkText = (await darkCard.textContent())?.replace(/\s+/g, ' ').trim();
    expect(darkUnhandled).toEqual([]);

    expect(darkText).toBe(lightText);

    // Plain test artifact (not a committed visual baseline) proving the dark
    // capture actually rendered the dark theme. Written to the scratch
    // directory via SCRATCH_DIR so nothing lands in the repo tree.
    const scratchDir = process.env.SCRATCH_DIR;
    if (scratchDir) {
      await darkPage.screenshot({
        path: `${scratchDir}/node-status-card-dark-${browserName}.png`,
      });
    }

    await context.close();
  });
});
