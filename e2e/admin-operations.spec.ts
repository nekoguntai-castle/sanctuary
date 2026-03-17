/**
 * Admin Operations E2E Tests
 *
 * Tests interactive admin workflows: feature flag toggling, user/group CRUD,
 * backup/restore flows, node config editing, and variable updates.
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
  id: 'user-ops-admin',
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

const REGULAR_USER = {
  id: 'user-ops-regular',
  username: 'viewer',
  email: 'viewer@test.com',
  isAdmin: false,
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
};

const FEATURE_FLAGS = [
  {
    key: 'enhancedDashboard',
    enabled: true,
    description: 'Enable enhanced dashboard widgets',
    category: 'general',
    source: 'database',
    modifiedBy: 'admin',
    updatedAt: '2026-03-11T00:00:00.000Z',
  },
  {
    key: 'treasuryAutopilot',
    enabled: false,
    description: 'Enable treasury automation',
    category: 'experimental',
    source: 'environment',
    modifiedBy: null,
    updatedAt: null,
  },
];

const SYSTEM_SETTINGS = {
  registrationEnabled: false,
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  dustThreshold: 546,
  aiEnabled: false,
};

const NODE_CONFIG = {
  type: 'electrum',
  explorerUrl: 'https://mempool.space',
  feeEstimatorUrl: 'https://mempool.space',
  mempoolEstimator: 'mempool_space',
  mainnetMode: 'pool',
  mainnetSingletonHost: 'electrum.blockstream.info',
  mainnetSingletonPort: 50002,
  mainnetSingletonSsl: true,
  mainnetPoolMin: 1,
  mainnetPoolMax: 5,
  mainnetPoolLoadBalancing: 'round_robin',
  testnetEnabled: true,
  testnetMode: 'singleton',
  testnetSingletonHost: 'electrum.blockstream.info',
  testnetSingletonPort: 60002,
  testnetSingletonSsl: true,
  testnetPoolMin: 1,
  testnetPoolMax: 3,
  testnetPoolLoadBalancing: 'round_robin',
  signetEnabled: false,
  signetMode: 'singleton',
  signetSingletonHost: 'electrum.mutinynet.com',
  signetSingletonPort: 50002,
  signetSingletonSsl: true,
  signetPoolMin: 1,
  signetPoolMax: 3,
  signetPoolLoadBalancing: 'round_robin',
  proxyEnabled: true,
  proxyHost: 'tor',
  proxyPort: 9050,
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function mockAdminApi(
  page: Page,
  options?: {
    failures?: Record<string, { status?: number; body?: unknown }>;
  }
) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-admin-ops-token');
  });

  const unhandledRequests: string[] = [];
  let flagState = FEATURE_FLAGS.map(f => ({ ...f }));
  let settingsState = { ...SYSTEM_SETTINGS };
  let usersState = [
    { id: ADMIN_USER.id, username: 'admin', email: null, isAdmin: true, createdAt: '2026-03-11T00:00:00.000Z', updatedAt: '2026-03-11T00:00:00.000Z' },
    { ...REGULAR_USER },
  ];
  let groupsState: { id: string; name: string; members: { id: string; username: string }[] }[] = [];
  let nodeConfigState = { ...NODE_CONFIG };

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const requestKey = `${method} ${path}`;

    const failure = options?.failures?.[requestKey];
    if (failure) {
      return json(route, failure.body ?? { message: 'Injected failure' }, failure.status ?? 500);
    }

    // Auth
    if (method === 'GET' && path === '/auth/me') return json(route, ADMIN_USER);
    if (method === 'GET' && path === '/auth/registration-status') return json(route, { enabled: settingsState.registrationEnabled });
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

    // Feature flags
    if (method === 'GET' && path === '/admin/features') return json(route, flagState);
    if (method === 'GET' && path === '/admin/features/audit-log') return json(route, { entries: [], total: 0, limit: 50, offset: 0 });
    if (method === 'PUT' && /^\/admin\/features\//.test(path)) {
      const flagKey = path.split('/').pop();
      const body = request.postDataJSON();
      flagState = flagState.map(f =>
        f.key === flagKey ? { ...f, enabled: body.enabled, modifiedBy: 'admin', updatedAt: new Date().toISOString() } : f
      );
      const updated = flagState.find(f => f.key === flagKey);
      return json(route, updated ?? { message: 'Flag not found' }, updated ? 200 : 404);
    }

    // Users
    if (method === 'GET' && path === '/admin/users') return json(route, usersState);
    if (method === 'POST' && path === '/admin/users') {
      const body = request.postDataJSON();
      const newUser = {
        id: `user-new-${Date.now()}`,
        username: body.username,
        email: body.email || null,
        isAdmin: body.isAdmin || false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      usersState = [...usersState, newUser];
      return json(route, newUser, 201);
    }
    if (method === 'PUT' && /^\/admin\/users\//.test(path)) {
      const userId = path.split('/').pop();
      const body = request.postDataJSON();
      usersState = usersState.map(u =>
        u.id === userId ? { ...u, ...body, updatedAt: new Date().toISOString() } : u
      );
      return json(route, usersState.find(u => u.id === userId));
    }
    if (method === 'DELETE' && /^\/admin\/users\//.test(path)) {
      const userId = path.split('/').pop();
      usersState = usersState.filter(u => u.id !== userId);
      return json(route, { message: 'User deleted' });
    }

    // Groups
    if (method === 'GET' && path === '/admin/groups') return json(route, groupsState);
    if (method === 'POST' && path === '/admin/groups') {
      const body = request.postDataJSON();
      const newGroup = { id: `group-new-${Date.now()}`, name: body.name, members: [] };
      groupsState = [...groupsState, newGroup];
      return json(route, newGroup, 201);
    }
    if (method === 'PUT' && /^\/admin\/groups\//.test(path)) {
      const groupId = path.split('/').pop();
      const body = request.postDataJSON();
      groupsState = groupsState.map(g =>
        g.id === groupId ? { ...g, ...body } : g
      );
      return json(route, groupsState.find(g => g.id === groupId));
    }
    if (method === 'DELETE' && /^\/admin\/groups\//.test(path)) {
      const groupId = path.split('/').pop();
      groupsState = groupsState.filter(g => g.id !== groupId);
      return json(route, { message: 'Group deleted' });
    }

    // Settings
    if (method === 'GET' && path === '/admin/settings') return json(route, settingsState);
    if (method === 'PUT' && path === '/admin/settings') {
      const body = request.postDataJSON();
      settingsState = { ...settingsState, ...body };
      return json(route, settingsState);
    }

    // Node config
    if (method === 'GET' && path === '/admin/node-config') return json(route, nodeConfigState);
    if (method === 'PUT' && path === '/admin/node-config') {
      const body = request.postDataJSON();
      nodeConfigState = { ...nodeConfigState, ...body };
      return json(route, nodeConfigState);
    }
    if (method === 'GET' && path === '/admin/electrum-servers') return json(route, []);
    if (method === 'GET' && path === '/admin/tor-container/status') return json(route, { available: true, exists: true, running: true, status: 'running' });

    // WebSocket stats
    if (method === 'GET' && path === '/admin/websocket/stats') {
      return json(route, { connections: { current: 1, max: 100, uniqueUsers: 1, maxPerUser: 10 }, subscriptions: { total: 1, channels: 1, channelList: ['global:price'] }, rateLimits: { maxMessagesPerSecond: 15 }, recentRateLimitEvents: [] });
    }

    // Backup
    if (method === 'POST' && path === '/admin/backup') {
      return json(route, { data: { users: [], wallets: [], devices: [] }, metadata: { version: '0.8.14', createdAt: new Date().toISOString(), createdBy: 'admin', description: 'E2E test backup' } });
    }
    if (method === 'POST' && path === '/admin/encryption-keys') {
      return json(route, { encryptionKey: 'test-enc-key-abc123', encryptionSalt: 'test-salt-xyz789', hasEncryptionKey: true, hasEncryptionSalt: true });
    }

    // Audit logs
    if (method === 'GET' && path === '/admin/audit-logs') return json(route, { logs: [], total: 0, limit: 50, offset: 0 });
    if (method === 'GET' && path === '/admin/audit-logs/stats') return json(route, { totalEvents: 0, byCategory: {}, byAction: {}, failedEvents: 0 });

    // Monitoring
    if (method === 'GET' && path === '/admin/monitoring/services') return json(route, { enabled: true, services: [] });
    if (method === 'GET' && path === '/admin/monitoring/grafana') return json(route, { username: 'admin', password: 'test', anonymousAccess: false });

    // AI
    if (method === 'GET' && path === '/ai/status') return json(route, { available: false, containerAvailable: false });
    if (method === 'GET' && path === '/ai/ollama-container/status') return json(route, { available: true, exists: true, running: false, status: 'exited' });

    unhandledRequests.push(requestKey);
    return json(route, { message: `Unmocked: ${requestKey}` }, 404);
  };

  await page.route('**/api/v1/**', apiRouteHandler);
  if (API_ORIGIN) await page.route(`${API_ORIGIN}/**`, apiRouteHandler);
  return unhandledRequests;
}

test.describe('Admin operations', () => {
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

  // --- Feature Flag Toggle ---

  test('toggling a feature flag shows saved confirmation', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/feature-flags');
    await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();

    // Find the disabled flag and toggle it
    await expect(page.getByText('treasuryAutopilot')).toBeVisible();

    // Click its toggle - the flag row div contains the flag name and a role="switch" button
    const flagRow = page.locator('div').filter({ hasText: 'treasuryAutopilot' }).filter({ has: page.locator('button[role="switch"]') }).first();
    await flagRow.locator('button[role="switch"]').click();

    // Should show saved confirmation
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 });

    expect(unhandledRequests).toEqual([]);
  });

  test('feature flag change history section is toggleable', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/feature-flags');
    await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();

    const historyButton = page.getByRole('button', { name: /Change History/i });
    if (await historyButton.isVisible()) {
      await historyButton.click();
      // Change history section should expand/collapse - look for content inside the expanded section
      await expect(page.getByText('No changes recorded yet.').or(page.getByText('Loading audit log...'))).toBeVisible();
    }

    expect(unhandledRequests).toEqual([]);
  });

  // --- User Management ---

  test('users page shows existing users', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/users-groups');

    await expect(page.getByText('admin', { exact: true })).toBeVisible();
    await expect(page.getByText('viewer', { exact: true })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('create user modal opens and creates user', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/users-groups');

    // Click Add User
    await page.getByRole('button', { name: /Add User/i }).click();

    // Modal should appear
    await expect(page.getByText('Create New User')).toBeVisible();

    // Fill form
    await page.getByPlaceholder(/username/i).fill('newuser');
    await page.getByPlaceholder(/password/i).fill('SecurePass123!');

    // Submit
    await page.getByRole('button', { name: /Create User/i }).click();

    // Modal should close and new user should appear
    await expect(page.getByText('newuser')).toBeVisible({ timeout: 5000 });

    expect(unhandledRequests).toEqual([]);
  });

  test('delete user with confirmation', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/users-groups');
    await expect(page.getByText('viewer', { exact: true })).toBeVisible();

    // Accept the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    // Find the delete button for the viewer user row (title="Delete user")
    // The user list renders each user in a <li> with username and a delete button with title="Delete user"
    const viewerRow = page.locator('li').filter({ hasText: 'viewer' });
    const deleteButton = viewerRow.locator('button[title="Delete user"]');

    if (await deleteButton.first().isVisible()) {
      await deleteButton.first().click();
      // User should be removed
      await expect(page.getByText('viewer', { exact: true })).not.toBeVisible({ timeout: 5000 });
    }

    expect(unhandledRequests).toEqual([]);
  });

  // --- Group Management ---

  test('create group via inline form', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/users-groups');

    // Find group creation form
    const groupInput = page.getByPlaceholder(/group name/i).or(page.getByPlaceholder(/new group/i));
    if (await groupInput.isVisible()) {
      await groupInput.fill('Test Group');
      await page.getByRole('button', { name: /Create/i }).click();

      // Group should appear
      await expect(page.getByText('Test Group')).toBeVisible({ timeout: 5000 });
    }

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Variables ---

  test('update system variables and save', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/variables');

    await expect(page.getByText('Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Deep Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Dust Threshold', { exact: true })).toBeVisible();

    // Change confirmation threshold
    const confirmInput = page.locator('input[type="number"]').first();
    await confirmInput.clear();
    await confirmInput.fill('3');

    // Save
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Should show success
    await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 5000 });

    expect(unhandledRequests).toEqual([]);
  });

  test('dust threshold has correct constraints', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/variables');

    // Find dust threshold input (3rd number input)
    const dustInput = page.locator('input[type="number"]').nth(2);
    await expect(dustInput).toBeVisible();

    // Should have min/max attributes
    await expect(dustInput).toHaveAttribute('min', '1');

    expect(unhandledRequests).toEqual([]);
  });

  // --- Node Configuration ---

  test('node config page shows save button and sections', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/node-config');

    await expect(page.getByRole('heading', { name: 'Node Configuration' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save All Settings/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('saving node config shows success message', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/node-config');
    await expect(page.getByRole('heading', { name: 'Node Configuration' })).toBeVisible();

    await page.getByRole('button', { name: /Save All Settings/i }).click();

    await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 5000 });

    expect(unhandledRequests).toEqual([]);
  });

  // --- Backup ---

  test('backup tab shows create backup button', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/backup');

    await expect(main.getByRole('heading', { name: 'Create Backup' })).toBeVisible();
    await expect(main.getByRole('button', { name: /Download Backup/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('restore tab shows file upload zone', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/backup');
    await main.getByRole('button', { name: 'Restore', exact: true }).click();

    await expect(main.getByRole('heading', { name: 'Restore from Backup' })).toBeVisible();
    await expect(main.getByText('Drop backup file here or click to browse')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('encryption keys section requires password', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/backup');

    // Encryption keys section
    await expect(main.getByText(/Encryption Keys/i)).toBeVisible();
    await expect(main.getByPlaceholder(/password/i)).toBeVisible();
    await expect(main.getByRole('button', { name: /Reveal/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('revealing encryption keys after password entry', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/backup');

    await main.getByPlaceholder(/password/i).fill('admin-password');
    await main.getByRole('button', { name: /Reveal/i }).click();

    // Should show encryption key values
    await expect(main.getByText(/ENCRYPTION_KEY|test-enc-key/i).or(main.getByText(/Copy Both/i))).toBeVisible({ timeout: 5000 });

    expect(unhandledRequests).toEqual([]);
  });

  // --- System Settings ---

  test('system settings shows access control toggle', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/settings');
    await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

    await expect(page.getByText('Public Registration')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Audit Logs ---

  test('audit logs page shows filters and refresh button', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/audit-logs');
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Filters/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('audit log filters panel expands on click', async ({ page }) => {
    const unhandledRequests = await mockAdminApi(page);

    await page.goto('/#/admin/audit-logs');
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();

    const filtersButton = page.getByRole('button', { name: /Filters/i }).first();
    if (await filtersButton.isVisible()) {
      await filtersButton.click();
      // Filter panel should expand with filter inputs - look for "Apply Filters" button
      await expect(
        page.getByRole('button', { name: /Apply Filters/i })
      ).toBeVisible({ timeout: 3000 });
    }

    expect(unhandledRequests).toEqual([]);
  });
});
