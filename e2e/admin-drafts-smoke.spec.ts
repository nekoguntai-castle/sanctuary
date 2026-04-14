import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

const WALLET_ID = 'wallet-smoke-1';

const ADMIN_USER = {
  id: 'user-admin-1',
  username: 'admin',
  isAdmin: true,
  usingDefaultPassword: false,
  preferences: {
    darkMode: false,
    theme: 'sanctuary',
    background: 'minimal',
    contrastLevel: 0,
    patternOpacity: 50,
  },
  createdAt: '2026-03-02T00:00:00.000Z',
};

const WALLET = {
  id: WALLET_ID,
  name: 'Smoke Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'testnet',
  descriptor: 'wpkh([abcd1234/84h/1h/0h]tpubD6NzVbkrYhZ4Yexample/0/*)',
  fingerprint: 'abcd1234',
  balance: 0,
  quorum: 1,
  totalSigners: 1,
  userRole: 'owner',
  canEdit: true,
  isShared: false,
  sharedWith: [],
  syncInProgress: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
};

type MockApiResponse = {
  status?: number;
  body: unknown;
};

function mockResponse(body: unknown, status?: number): MockApiResponse {
  return { body, status };
}

function parseApiRoute(route: Route) {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, '');
  return { method, path };
}

const MOCK_API_RESPONSES: Record<string, MockApiResponse> = {
  'GET /auth/me': mockResponse(ADMIN_USER),
  'POST /auth/refresh': mockResponse({ message: 'Unauthorized' }, 401),
  'POST /auth/logout': mockResponse({ success: true }),
  'GET /wallets': mockResponse([WALLET]),
  'GET /devices': mockResponse([]),
  'GET /bitcoin/status': mockResponse({
    connected: true,
    explorerUrl: 'https://mempool.space',
    confirmationThreshold: 1,
    deepConfirmationThreshold: 6,
  }),
  [`GET /wallets/${WALLET_ID}`]: mockResponse(WALLET),
  [`GET /wallets/${WALLET_ID}/transactions`]: mockResponse([]),
  [`GET /wallets/${WALLET_ID}/transactions/stats`]: mockResponse({
    totalCount: 0,
    receivedCount: 0,
    sentCount: 0,
    consolidationCount: 0,
    totalReceived: 0,
    totalSent: 0,
    totalFees: 0,
    walletBalance: 0,
  }),
  [`GET /wallets/${WALLET_ID}/utxos`]: mockResponse({ utxos: [], count: 0, totalBalance: 0 }),
  [`GET /wallets/${WALLET_ID}/privacy`]: mockResponse({
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
  }),
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
  'GET /admin/groups': mockResponse([]),
  'GET /admin/audit-logs': mockResponse({
    logs: [
      {
        id: 'log-1',
        userId: ADMIN_USER.id,
        username: ADMIN_USER.username,
        action: 'auth.login',
        category: 'auth',
        details: null,
        ipAddress: '127.0.0.1',
        userAgent: 'Playwright',
        success: true,
        errorMsg: null,
        createdAt: '2026-03-02T00:00:00.000Z',
      },
    ],
    total: 1,
    limit: 25,
    offset: 0,
  }),
  'GET /admin/audit-logs/stats': mockResponse({
    totalEvents: 1,
    byCategory: { auth: 1 },
    byAction: { 'auth.login': 1 },
    failedEvents: 0,
  }),
  'GET /admin/monitoring/services': mockResponse({
    enabled: true,
    services: [
      {
        id: 'grafana',
        name: 'Grafana',
        description: 'Dashboards',
        url: 'http://localhost:3000',
        defaultPort: 3000,
        icon: 'BarChart3',
        isCustomUrl: false,
        status: 'healthy',
      },
    ],
  }),
  'GET /admin/monitoring/grafana': mockResponse({
    username: 'admin',
    passwordSource: 'GRAFANA_PASSWORD',
    password: 'grafana-secret',
    anonymousAccess: false,
    anonymousAccessNote: 'Anonymous access disabled',
  }),
  'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
};

function getMockApiResponse(method: string, path: string): MockApiResponse | null {
  const response = MOCK_API_RESPONSES[`${method} ${path}`];
  if (response) {
    return response;
  }
  if (method === 'GET' && /^\/wallets\/[^/]+\/labels$/.test(path)) {
    return mockResponse([]);
  }
  return null;
}

function createApiRouteHandler() {
  const apiRouteHandler = async (route: Route) => {
    const { method, path } = parseApiRoute(route);
    const response = getMockApiResponse(method, path);

    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

async function mockAuthenticatedApi(page: Page) {
  // ADR 0001 / 0002 Phase 6: browser auth is cookie-only. Legacy
  // localStorage token seed is dead; authenticated state comes from
  // /auth/me returning 200.

  await registerApiRoutes(page, createApiRouteHandler());
}

test.describe('Admin and drafts smoke routes', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedApi(page);
  });

  test('renders audit logs page', async ({ page }) => {
    await page.goto('/#/admin/audit-logs');
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
    await expect(page.getByText('Security and activity logs for the system')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  test('renders monitoring page', async ({ page }) => {
    await page.goto('/#/admin/monitoring');
    await expect(page.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh Status' })).toBeVisible();
    await expect(page.getByText('About Monitoring')).toBeVisible();
  });

  test('renders wallet drafts tab empty state', async ({ page }) => {
    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('button', { name: /drafts/i })).toBeVisible();
    await page.getByRole('button', { name: /drafts/i }).click();
    await expect(page.getByText('No draft transactions')).toBeVisible();
  });
});
