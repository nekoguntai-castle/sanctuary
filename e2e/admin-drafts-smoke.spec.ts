import { expect, test, type Page, type Route } from '@playwright/test';

const WALLET_ID = 'wallet-smoke-1';

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

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function mockAuthenticatedApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-smoke-token');
  });

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    // Auth/session bootstrap
    if (method === 'GET' && path === '/auth/me') {
      return json(route, ADMIN_USER);
    }

    // Shared layout queries
    if (method === 'GET' && path === '/wallets') {
      return json(route, [WALLET]);
    }
    if (method === 'GET' && path === '/devices') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/bitcoin/status') {
      return json(route, {
        connected: true,
        explorerUrl: 'https://mempool.space',
        confirmationThreshold: 1,
        deepConfirmationThreshold: 6,
      });
    }

    // Wallet detail + drafts tab
    if (method === 'GET' && path === `/wallets/${WALLET_ID}`) {
      return json(route, WALLET);
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions/stats`) {
      return json(route, {
        totalCount: 0,
        receivedCount: 0,
        sentCount: 0,
        consolidationCount: 0,
        totalReceived: 0,
        totalSent: 0,
        totalFees: 0,
        walletBalance: 0,
      });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/utxos`) {
      return json(route, { utxos: [], count: 0, totalBalance: 0 });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/privacy`) {
      return json(route, {
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
      });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/addresses/summary`) {
      return json(route, {
        totalAddresses: 0,
        usedCount: 0,
        unusedCount: 0,
        totalBalance: 0,
        usedBalance: 0,
        unusedBalance: 0,
      });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/addresses`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/drafts`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/share`) {
      return json(route, { group: null, users: [] });
    }
    if (method === 'GET' && path === '/admin/groups') {
      return json(route, []);
    }

    // Audit logs
    if (method === 'GET' && path === '/admin/audit-logs') {
      return json(route, {
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
      });
    }
    if (method === 'GET' && path === '/admin/audit-logs/stats') {
      return json(route, {
        totalEvents: 1,
        byCategory: { auth: 1 },
        byAction: { 'auth.login': 1 },
        failedEvents: 0,
      });
    }

    // Monitoring
    if (method === 'GET' && path === '/admin/monitoring/services') {
      return json(route, {
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
      });
    }
    if (method === 'GET' && path === '/admin/monitoring/grafana') {
      return json(route, {
        username: 'admin',
        passwordSource: 'GRAFANA_PASSWORD',
        password: 'grafana-secret',
        anonymousAccess: false,
        anonymousAccessNote: 'Anonymous access disabled',
      });
    }

    return json(route, { message: `Unmocked endpoint: ${method} ${path}` }, 404);
  };

  await page.route('**/api/v1/**', apiRouteHandler);
  if (API_ORIGIN) {
    await page.route(`${API_ORIGIN}/**`, apiRouteHandler);
  }
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
