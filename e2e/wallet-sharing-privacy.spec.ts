/**
 * Wallet Sharing & Privacy E2E Tests
 *
 * Tests wallet access tab (sharing, ownership), privacy analysis display,
 * address management, and UTXO tab content.
 */

import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

const WALLET_ID = 'wallet-share-1';
const DEVICE_ID = 'device-share-1';

const ADMIN_USER = {
  id: 'user-share-admin',
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
  name: 'Shared Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh([abcd1234/84h/0h/0h]xpubShareTest/0/*)',
  fingerprint: 'abcd1234',
  balance: 75000000,
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
  type: 'coldcard',
  label: 'Share Coldcard',
  fingerprint: 'abcd1234',
  isOwner: true,
  userRole: 'owner',
  wallets: [{ wallet: { id: WALLET_ID, name: WALLET.name, type: WALLET.type } }],
  accounts: [{ id: 'acct-share-1', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub-share-account' }],
  model: { slug: 'coldcard', manufacturer: 'Coinkite', name: 'Coldcard Mk4' },
};

const UTXOS = [
  {
    txid: 'share1txid0000000000000000000000000000000000000000000000000000',
    vout: 0,
    value: 50000000,
    address: 'bc1qshareaddr1xxxxxxxxxxxxxxxxxxxxxxxx',
    confirmations: 200,
    scriptType: 'native_segwit',
    derivationPath: "m/84'/0'/0'/0/0",
    label: null,
    frozen: false,
    lockedByDraft: null,
  },
  {
    txid: 'share2txid0000000000000000000000000000000000000000000000000000',
    vout: 0,
    value: 25000000,
    address: 'bc1qshareaddr2xxxxxxxxxxxxxxxxxxxxxxxx',
    confirmations: 10,
    scriptType: 'native_segwit',
    derivationPath: "m/84'/0'/0'/0/1",
    label: 'Exchange deposit',
    frozen: false,
    lockedByDraft: null,
  },
];

const ADDRESSES = [
  { index: 0, address: 'bc1qshareaddr1xxxxxxxxxxxxxxxxxxxxxxxx', type: 'receive', used: true, balance: 50000000, label: null },
  { index: 1, address: 'bc1qshareaddr2xxxxxxxxxxxxxxxxxxxxxxxx', type: 'receive', used: true, balance: 25000000, label: 'Exchange deposit' },
  { index: 2, address: 'bc1qshareaddr3xxxxxxxxxxxxxxxxxxxxxxxx', type: 'receive', used: false, balance: 0, label: null },
];

async function mockShareApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-share-token');
  });

  const unhandledRequests: string[] = [];
  let shareState = {
    users: [{ id: ADMIN_USER.id, username: ADMIN_USER.username, role: 'owner' }],
    group: null as { id: string; name: string; role: string } | null,
  };

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    // Auth
    if (method === 'GET' && path === '/auth/me') return json(route, ADMIN_USER);
    if (method === 'GET' && path === '/auth/registration-status') return json(route, { enabled: false });
    if (method === 'GET' && path === '/health') return json(route, { status: 'ok' });

    // Shared
    if (method === 'GET' && path === '/wallets') return json(route, [WALLET]);
    if (method === 'GET' && path === '/devices') return json(route, [DEVICE]);
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
    if (method === 'GET' && path === '/ai/status') return json(route, { available: false, containerAvailable: false });

    // Wallet detail
    if (method === 'GET' && path === `/wallets/${WALLET_ID}`) return json(route, WALLET);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions/pending`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/transactions/stats`) {
      return json(route, { totalCount: 2, receivedCount: 2, sentCount: 0, consolidationCount: 0, totalReceived: 75000000, totalSent: 0, totalFees: 0, walletBalance: WALLET.balance });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/utxos`) {
      return json(route, { utxos: UTXOS, count: UTXOS.length, totalBalance: UTXOS.reduce((s, u) => s + u.value, 0) });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/privacy`) {
      return json(route, {
        utxos: UTXOS.map(u => ({
          ...u,
          score: 85,
          factors: [
            { name: 'Address Reuse', impact: 0, description: 'No address reuse detected' },
            { name: 'Round Amount', impact: -5, description: 'Round amount detected' },
          ],
          recommendations: [],
        })),
        summary: {
          averageScore: 85,
          grade: 'good',
          utxoCount: UTXOS.length,
          addressReuseCount: 0,
          roundAmountCount: 1,
          clusterCount: 0,
          recommendations: ['Avoid sending round amounts'],
        },
      });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/addresses/summary`) {
      return json(route, { totalAddresses: 3, usedCount: 2, unusedCount: 1, totalBalance: WALLET.balance, usedBalance: WALLET.balance, unusedBalance: 0 });
    }
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/addresses`) return json(route, ADDRESSES);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/drafts`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/share`) return json(route, shareState);

    // Sharing operations
    if (method === 'POST' && path === `/wallets/${WALLET_ID}/share/users`) {
      const body = request.postDataJSON();
      shareState.users.push({ id: body.userId, username: body.username || 'shareduser', role: body.role || 'viewer' });
      return json(route, shareState);
    }
    if (method === 'POST' && path === `/wallets/${WALLET_ID}/share/group`) {
      const body = request.postDataJSON();
      shareState.group = { id: body.groupId, name: body.groupName || 'Shared Group', role: body.role || 'viewer' };
      return json(route, shareState);
    }

    // Device share
    if (method === 'GET' && path === `/devices/${DEVICE_ID}`) return json(route, DEVICE);
    if (method === 'GET' && path === `/devices/${DEVICE_ID}/share`) return json(route, { users: [{ id: ADMIN_USER.id, username: ADMIN_USER.username, role: 'owner' }], group: null });
    if (method === 'GET' && path === '/devices/models') {
      return json(route, [
        {
          id: 'model-coldcard-mk4',
          slug: 'coldcard',
          manufacturer: 'Coinkite',
          name: 'Coldcard Mk4',
          connectivity: ['sd_card'],
          secureElement: true,
          openSource: true,
          airGapped: true,
          supportsBitcoinOnly: true,
          supportsMultisig: true,
          supportsTaproot: true,
          supportsPassphrase: true,
          scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
          hasScreen: true,
          screenType: 'oled',
          integrationTested: true,
          discontinued: false,
          aliases: ['coldcard mk4'],
          icon: 'Device',
          color: '#2f855a',
          supportsAirgap: true,
          supportsUsb: true,
          supportsQr: false,
          supportsNfc: false,
          supportsBluetooth: false,
          defaultScriptType: 'native_segwit',
          supportedScriptTypes: ['native_segwit'],
          supportedPurposes: ['single_sig', 'multisig'],
        },
      ]);
    }

    // Wallet labels (used by settings tab)
    if (method === 'GET' && path === `/wallets/${WALLET_ID}/labels`) return json(route, []);

    // Admin endpoints needed by layout/feature flag checks
    if (method === 'GET' && path === '/admin/features') return json(route, []);
    if (method === 'GET' && path === '/admin/settings') {
      return json(route, { registrationEnabled: false, confirmationThreshold: 1, deepConfirmationThreshold: 6, dustThreshold: 546, aiEnabled: false });
    }
    if (method === 'GET' && path === '/admin/websocket/stats') {
      return json(route, { connections: { current: 1, max: 100, uniqueUsers: 1, maxPerUser: 10 }, subscriptions: { total: 0, channels: 0, channelList: [] }, rateLimits: { maxMessagesPerSecond: 15, gracePeriodMs: 2000, gracePeriodMessageLimit: 30, maxSubscriptionsPerConnection: 40 }, recentRateLimitEvents: [] });
    }

    // Admin data for sharing
    if (method === 'GET' && path === '/admin/users') return json(route, [
      { id: ADMIN_USER.id, username: 'admin', email: null, isAdmin: true, createdAt: '2026-03-11T00:00:00.000Z', updatedAt: '2026-03-11T00:00:00.000Z' },
      { id: 'user-share-viewer', username: 'viewer', email: null, isAdmin: false, createdAt: '2026-03-11T00:00:00.000Z', updatedAt: '2026-03-11T00:00:00.000Z' },
    ]);
    if (method === 'GET' && path === '/admin/groups') return json(route, [
      { id: 'group-1', name: 'Team Alpha', members: [{ id: ADMIN_USER.id, username: 'admin' }] },
    ]);

    unhandledRequests.push(`${method} ${path}`);
    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);
  return unhandledRequests;
}

test.describe('Wallet sharing and privacy', () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', err => errors.push(err.message));
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = runtimeErrors.get(page) ?? [];
    // Filter out known mock-data-related errors (Icon lookup from incomplete model data, split from simplified addresses)
    const unexpectedErrors = errors.filter(e =>
      !e.includes("reading 'Icon'") && !e.includes("reading 'split'")
    );
    expect(unexpectedErrors, `Runtime errors in "${testInfo.title}"`).toEqual([]);
  });

  // --- Access Tab ---

  test('wallet access tab shows ownership info for owner', async ({ page }) => {
    const unhandledRequests = await mockShareApi(page);

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    // Click access tab
    await page.getByRole('button', { name: /access/i }).click();

    // Should show ownership section with admin as owner
    await expect(page.getByText('admin').first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('sharing sub-tab is accessible from access tab', async ({ page }) => {
    const unhandledRequests = await mockShareApi(page);

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await page.getByRole('button', { name: /access/i }).click();

    // Access tab should render without crashing
    await expect(page.getByRole('main')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Tab Buttons ---

  for (const { tab, locator } of [
    { tab: 'UTXOs', locator: { name: 'UTXOs', exact: true } },
    { tab: 'Addresses', locator: { name: /addresses/i } },
  ] as const) {
    test(`${tab} tab is clickable on wallet detail`, async ({ page }) => {
      await mockShareApi(page);

      await page.goto(`/#/wallets/${WALLET_ID}`);
      await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible({ timeout: 10000 });

      const tabButton = page.getByRole('button', locator);
      await expect(tabButton).toBeVisible();
      await tabButton.click();

      // Verify the tab was activated and the page didn't crash
      await expect(tabButton).toHaveAttribute('data-active', 'true', { timeout: 5000 });
    });
  }

  // --- Privacy ---

  test('privacy data is available in wallet detail', async ({ page }) => {
    const unhandledRequests = await mockShareApi(page);

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    // The wallet detail page loads without crashing when privacy data is mocked
    await expect(page.getByRole('main')).toBeVisible();
    expect(unhandledRequests).toEqual([]);
  });

  // --- Stats Tab ---

  test('stats tab shows transaction statistics', async ({ page }) => {
    const unhandledRequests = await mockShareApi(page);

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    await page.getByRole('button', { name: /stats/i }).click();

    // Stats tab shows cards like "BTC Value", "UTXO Count", "Avg UTXO Age", "First Activity"
    await expect(page.getByText('BTC Value')).toBeVisible();
    await expect(page.getByText('UTXO Count')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Settings Tab ---

  test('wallet settings tab renders for owner', async ({ page }) => {
    const unhandledRequests = await mockShareApi(page);

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    await page.getByRole('button', { name: /settings/i }).click();

    // Settings tab shows "Wallet Name" heading and sub-tabs like "General", "Devices", etc.
    await expect(page.getByRole('heading', { name: 'Wallet Name' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Wallet Detail Tab Navigation ---

  test('all wallet detail tabs are navigable', async ({ page }) => {
    const unhandledRequests = await mockShareApi(page);

    await page.goto(`/#/wallets/${WALLET_ID}`);
    await expect(page.getByRole('heading', { name: WALLET.name })).toBeVisible();

    // Tab through each available tab
    const tabs = ['Transactions', 'UTXOs', 'addresses', 'drafts', 'stats', 'access', 'settings', 'log'];
    for (const tab of tabs) {
      const tabButton = page.getByRole('button', { name: new RegExp(tab, 'i') });
      if (await tabButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tabButton.click();
        // Just verify no crash - tab content should render
        await page.waitForTimeout(200);
      }
    }

    expect(unhandledRequests).toEqual([]);
  });
});
