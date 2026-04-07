/**
 * User Journey E2E Tests
 *
 * Tests interactive user flows beyond rendering: navigation, form interactions,
 * settings persistence, sidebar behavior, and error recovery.
 */

import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

const MAINNET_WALLET_ID = 'wallet-journey-main';
const TESTNET_WALLET_ID = 'wallet-journey-test';
const DEVICE_ID = 'device-journey-1';

const ADMIN_USER = {
  id: 'user-journey-admin',
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

const NON_ADMIN_USER = {
  ...ADMIN_USER,
  id: 'user-journey-viewer',
  username: 'viewer',
  isAdmin: false,
};

const MAINNET_WALLET = {
  id: MAINNET_WALLET_ID,
  name: 'Journey Main Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh([abcd1234/84h/0h/0h]xpubJourneyMain/0/*)',
  fingerprint: 'abcd1234',
  balance: 250000000,
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

const TESTNET_WALLET = {
  id: TESTNET_WALLET_ID,
  name: 'Journey Testnet Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'testnet',
  descriptor: 'wpkh([efgh5678/84h/1h/0h]tpubJourneyTest/0/*)',
  fingerprint: 'efgh5678',
  balance: 500000,
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

const JOURNEY_DEVICE = {
  id: DEVICE_ID,
  type: 'ledger',
  label: 'Journey Ledger',
  fingerprint: 'abcd1234',
  isOwner: true,
  userRole: 'owner',
  wallets: [
    {
      wallet: {
        id: MAINNET_WALLET_ID,
        name: MAINNET_WALLET.name,
        type: MAINNET_WALLET.type,
      },
    },
  ],
  accounts: [
    {
      id: 'acct-j1',
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub-journey-account',
    },
  ],
  model: {
    slug: 'ledger',
    manufacturer: 'Ledger',
    name: 'Nano X',
  },
};

const SYSTEM_SETTINGS = {
  registrationEnabled: false,
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  dustThreshold: 546,
  aiEnabled: false,
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

type MockApiFailure = {
  status?: number;
  body?: unknown;
  timeout?: boolean;
};

type MockApiFailureMap = Record<string, MockApiFailure>;

async function mockAuthenticatedApi(
  page: Page,
  options?: {
    failures?: MockApiFailureMap;
    user?: typeof ADMIN_USER;
    wallets?: typeof MAINNET_WALLET[];
  }
) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-journey-token');
  });

  const user = options?.user ?? ADMIN_USER;
  const wallets = options?.wallets ?? [MAINNET_WALLET, TESTNET_WALLET];
  const unhandledRequests: string[] = [];
  let settingsState = { ...SYSTEM_SETTINGS };
  let preferencesState = { ...user.preferences };

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const requestKey = `${method} ${path}`;

    const failure = options?.failures?.[requestKey];
    if (failure) {
      if (failure.timeout) {
        return route.abort('timedout');
      }
      return json(route, failure.body ?? { message: `Injected failure for ${requestKey}` }, failure.status ?? 500);
    }

    // Auth/bootstrap
    if (method === 'GET' && path === '/auth/me') {
      return json(route, { ...user, preferences: preferencesState });
    }
    if (method === 'GET' && path === '/auth/registration-status') {
      return json(route, { enabled: false });
    }
    if (method === 'PUT' && path === '/auth/preferences') {
      try {
        const body = request.postDataJSON();
        preferencesState = { ...preferencesState, ...body };
      } catch {
        // no-op
      }
      return json(route, preferencesState);
    }

    // Shared app shell
    if (method === 'GET' && path === '/wallets') {
      return json(route, wallets);
    }
    if (method === 'GET' && path === '/devices') {
      return json(route, [JOURNEY_DEVICE]);
    }
    if (method === 'GET' && path === '/health') {
      return json(route, { status: 'ok' });
    }

    // Dashboard
    if (method === 'GET' && path === '/admin/version') {
      return json(route, {
        updateAvailable: false,
        currentVersion: '0.8.14',
      });
    }
    if (method === 'GET' && path === '/price') {
      return json(route, {
        price: 95000,
        currency: 'USD',
        sources: [],
        median: 95000,
        average: 95000,
        timestamp: '2026-03-11T00:00:00.000Z',
        cached: true,
        change24h: -1.5,
      });
    }
    if (method === 'GET' && path === '/bitcoin/status') {
      return json(route, {
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
      });
    }
    if (method === 'GET' && path === '/bitcoin/fees') {
      return json(route, { fastest: 18, halfHour: 12, hour: 8, economy: 3 });
    }
    if (method === 'GET' && path === '/bitcoin/mempool') {
      return json(route, {
        mempool: [],
        blocks: [],
        mempoolInfo: { count: 0, size: 0, totalFees: 0 },
        queuedBlocksSummary: null,
      });
    }
    if (method === 'GET' && path === '/transactions/recent') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/transactions/balance-history') {
      return json(route, [
        { name: 'Start', value: 250000000 },
        { name: 'Now', value: 250000000 },
      ]);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/transactions/pending`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${TESTNET_WALLET_ID}/transactions/pending`) {
      return json(route, []);
    }

    // Wallet detail
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}`) {
      return json(route, MAINNET_WALLET);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/transactions`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/transactions/stats`) {
      return json(route, {
        totalCount: 0, receivedCount: 0, sentCount: 0, consolidationCount: 0,
        totalReceived: 0, totalSent: 0, totalFees: 0, walletBalance: MAINNET_WALLET.balance,
      });
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/utxos`) {
      return json(route, { utxos: [], count: 0, totalBalance: 0 });
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/privacy`) {
      return json(route, {
        utxos: [],
        summary: {
          averageScore: 100, grade: 'excellent', utxoCount: 0,
          addressReuseCount: 0, roundAmountCount: 0, clusterCount: 0, recommendations: [],
        },
      });
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/addresses/summary`) {
      return json(route, {
        totalAddresses: 0, usedCount: 0, unusedCount: 0,
        totalBalance: 0, usedBalance: 0, unusedBalance: 0,
      });
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/addresses`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/drafts`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${TESTNET_WALLET_ID}/drafts`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/share`) {
      return json(route, { group: null, users: [] });
    }
    if (method === 'GET' && path.match(/^\/wallets\/[^/]+\/labels$/)) return json(route, []);

    // Device detail
    if (method === 'GET' && path === `/devices/${DEVICE_ID}`) {
      return json(route, JOURNEY_DEVICE);
    }
    if (method === 'GET' && path === '/devices/models') {
      return json(route, [
        {
          id: 'model-ledger-nano-x',
          slug: 'ledger',
          manufacturer: 'Ledger',
          name: 'Nano X',
          connectivity: ['usb', 'sd_card', 'qr_code'],
          secureElement: true,
          openSource: false,
          airGapped: false,
          supportsBitcoinOnly: true,
          supportsMultisig: true,
          supportsTaproot: true,
          supportsPassphrase: true,
          scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
          hasScreen: true,
          screenType: 'oled',
          integrationTested: true,
          discontinued: false,
          aliases: ['ledger nano x'],
          icon: 'Device',
          color: '#2f855a',
          supportsAirgap: false,
          supportsUsb: true,
          supportsQr: false,
          supportsNfc: false,
          supportsBluetooth: true,
          defaultScriptType: 'native_segwit',
          supportedScriptTypes: ['native_segwit'],
          supportedPurposes: ['single_sig', 'multisig'],
        },
      ]);
    }
    if (method === 'GET' && path === `/devices/${DEVICE_ID}/share`) {
      return json(route, {
        users: [{ id: ADMIN_USER.id, username: ADMIN_USER.username, role: 'owner' }],
        group: null,
      });
    }

    // Admin endpoints
    if (method === 'GET' && path === '/admin/groups') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/admin/users') {
      return json(route, [
        { id: ADMIN_USER.id, username: 'admin', email: null, isAdmin: true, createdAt: '2026-03-11T00:00:00.000Z', updatedAt: '2026-03-11T00:00:00.000Z' },
      ]);
    }
    if (method === 'GET' && path === '/admin/settings') {
      return json(route, settingsState);
    }
    if (method === 'PUT' && path === '/admin/settings') {
      try {
        const body = request.postDataJSON();
        settingsState = { ...settingsState, ...body };
      } catch {
        // no-op
      }
      return json(route, settingsState);
    }
    if (method === 'GET' && path === '/admin/websocket/stats') {
      return json(route, {
        connections: { current: 1, max: 100, uniqueUsers: 1, maxPerUser: 10 },
        subscriptions: { total: 1, channels: 1, channelList: ['global:price'] },
        rateLimits: { maxMessagesPerSecond: 15, gracePeriodMs: 2000, gracePeriodMessageLimit: 30, maxSubscriptionsPerConnection: 40 },
        recentRateLimitEvents: [],
      });
    }
    if (method === 'GET' && path === '/admin/features') {
      return json(route, FEATURE_FLAGS);
    }
    if (method === 'GET' && path === '/admin/features/audit-log') {
      return json(route, { entries: [], total: 0, limit: 50, offset: 0 });
    }
    if (method === 'GET' && path === '/admin/node-config') {
      return json(route, {
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
      });
    }
    if (method === 'PUT' && path === '/admin/node-config') {
      return json(route, {});
    }
    if (method === 'GET' && path === '/admin/electrum-servers') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/admin/tor-container/status') {
      return json(route, { available: true, exists: true, running: true, status: 'running' });
    }
    if (method === 'GET' && path === '/admin/monitoring/services') {
      return json(route, { enabled: true, services: [] });
    }
    if (method === 'GET' && path === '/admin/monitoring/grafana') {
      return json(route, { username: 'admin', password: 'test', anonymousAccess: false, anonymousAccessNote: 'Disabled' });
    }
    if (method === 'POST' && path === '/admin/encryption-keys') {
      return json(route, {
        encryptionKey: 'test-key', encryptionSalt: 'test-salt',
        hasEncryptionKey: true, hasEncryptionSalt: true,
      });
    }
    if (method === 'GET' && path === '/admin/audit-logs') {
      return json(route, { logs: [], total: 0, limit: 50, offset: 0 });
    }
    if (method === 'GET' && path === '/admin/audit-logs/stats') {
      return json(route, { totalEvents: 0, byCategory: {}, byAction: {}, failedEvents: 0 });
    }
    if (method === 'GET' && path === '/ai/status') {
      return json(route, { available: false, containerAvailable: false });
    }
    if (method === 'GET' && path === '/intelligence/status') {
      return json(route, { available: false, ollamaConfigured: false });
    }
    if (method === 'GET' && path === '/ai/ollama-container/status') {
      return json(route, { available: true, exists: true, running: false, status: 'exited' });
    }

    unhandledRequests.push(`${method} ${path}`);
    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);

  return unhandledRequests;
}

async function mockPublicApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('sanctuary_token');
  });

  const unhandledRequests: string[] = [];

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    if (method === 'GET' && path === '/health') {
      return json(route, { status: 'ok' });
    }
    if (method === 'GET' && path === '/auth/registration-status') {
      return json(route, { enabled: false });
    }
    if (method === 'GET' && path === '/price') {
      return json(route, {
        price: 95000, currency: 'USD', sources: [], median: 95000,
        average: 95000, timestamp: '2026-03-11T00:00:00.000Z', cached: true, change24h: -1.5,
      });
    }

    unhandledRequests.push(`${method} ${path}`);
    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);

  return unhandledRequests;
}

test.describe('User journey flows', () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', err => {
      errors.push(err.message);
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = runtimeErrors.get(page) ?? [];
    expect(errors, `Unexpected page runtime errors in "${testInfo.title}"`).toEqual([]);
  });

  // --- Navigation & Routing ---

  test('navigating from dashboard to wallets via sidebar', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    // Click wallet link in sidebar
    await page.getByRole('link', { name: /Wallets/i }).first().click();
    await expect(page).toHaveURL(/#\/wallets/);
    await expect(page.getByRole('heading', { name: 'Mainnet Wallets' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('navigating from wallets to wallet detail by clicking wallet card', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/wallets');
    await expect(page.getByText('Journey Main Wallet')).toBeVisible();

    await page.getByText('Journey Main Wallet').click();
    await expect(page).toHaveURL(new RegExp(`#/wallets/${MAINNET_WALLET_ID}`));
    await expect(page.getByRole('heading', { name: 'Journey Main Wallet' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('navigating from device list to device detail', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/devices');
    await expect(page.getByText('Journey Ledger', { exact: true })).toBeVisible();

    await page.getByText('Journey Ledger', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/devices/${DEVICE_ID}`));
    await expect(page.getByRole('heading', { name: 'Journey Ledger' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('unknown authenticated route redirects to dashboard', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/this-route-does-not-exist');

    await expect(page).toHaveURL(/#\/(dashboard)?$/);
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('unauthenticated root renders login screen', async ({ page }) => {
    const unhandledRequests = await mockPublicApi(page);

    await page.goto('/#/');

    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Wallet Tab Navigation ---

  test('wallet detail tab switching persists through navigation', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
    await expect(page.getByRole('heading', { name: 'Journey Main Wallet' })).toBeVisible();

    // Switch to UTXOs tab
    await page.getByRole('button', { name: 'UTXOs', exact: true }).click();
    await expect(page.getByText('Available Outputs')).toBeVisible();

    // Switch to Drafts tab
    await page.getByRole('button', { name: 'drafts', exact: true }).click();
    await expect(page.getByText('No draft transactions')).toBeVisible();

    // Switch back to Transactions tab
    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await expect(page.getByText('No transactions found.')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Dashboard Interaction ---

  test('dashboard network switcher toggles between mainnet and testnet', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    // Switch to testnet
    await page.getByRole('button', { name: /Testnet/i }).click();
    await expect(page.getByText('Testnet coins have no market value')).toBeVisible();

    // Switch back to mainnet
    await page.getByRole('button', { name: /Mainnet/i }).click();
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Settings Interactions ---

  test('settings appearance tab renders theme controls', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await expect(main.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(page.getByText('Dark Mode')).toBeVisible();
    await expect(page.getByText('Theme')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('settings display tab shows unit and currency options', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('settings notification tab shows sound configuration', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notification Sounds' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Account Page ---

  test('account page renders profile, password, and 2FA sections', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/account');
    const main = page.getByRole('main');

    await expect(main.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Profile Information' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Change Password' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Create Wallet Flow ---

  test('create wallet single-sig flow reaches signer selection', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');

    await expect(main.getByText('Select Wallet Topology')).toBeVisible();
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should reach signer selection with device visible
    await expect(main.getByText('Journey Ledger')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('create wallet cancel returns to wallet list', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await expect(main.getByText('Select Wallet Topology')).toBeVisible();

    await main.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/#\/wallets/);

    expect(unhandledRequests).toEqual([]);
  });

  // --- Import Wallet Flow ---

  test('import wallet renders format selection step', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await expect(main.getByText('Select Import Format')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Output Descriptor' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Hardware Device' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Connect Device Flow ---

  test('connect device renders device selector', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/devices/connect');

    await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
    await expect(main.getByRole('heading', { name: '1. Select Your Device' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Send Transaction Flow ---

  test('send transaction starts with type selection', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

    await expect(main.getByRole('heading', { name: `Send from ${MAINNET_WALLET.name}` })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Standard Send' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Error Recovery ---

  test('expired session 401 redirects to login', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'GET /auth/me': { status: 401, body: { message: 'Token expired' } },
      },
    });

    await page.goto('/#/');

    // Should redirect to login
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 10000 });
  });

  // --- Admin Navigation ---

  test('admin sidebar navigation cycles through admin pages', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/settings');
    await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

    // Navigate to feature flags
    await page.getByRole('link', { name: /Feature Flags/i }).click();
    await expect(page).toHaveURL(/#\/admin\/feature-flags/);
    await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();

    // Navigate to audit logs
    await page.getByRole('link', { name: /Audit Logs/i }).click();
    await expect(page).toHaveURL(/#\/admin\/audit-logs/);
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Feature Flag Interaction ---

  test('admin feature flags shows flag details and toggle states', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/feature-flags');

    await expect(page.getByText('enhancedDashboard')).toBeVisible();
    await expect(page.getByText('treasuryAutopilot')).toBeVisible();
    await expect(page.getByText('General')).toBeVisible();
    await expect(page.getByText('Experimental')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Variables Edit Flow ---

  test('admin variables page shows editable threshold fields', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/variables');

    await expect(page.getByText('Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Deep Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Dust Threshold', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Wallet List Network Switching ---

  test('wallet list network tabs filter wallets correctly', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/wallets');

    // Mainnet tab shows mainnet wallet
    await expect(page.getByText('Journey Main Wallet')).toBeVisible();
    await expect(page.getByText('Journey Testnet Wallet')).not.toBeVisible();

    // Switch to testnet
    await page.getByRole('button', { name: /Testnet/i }).click();
    await expect(page.getByText('Journey Testnet Wallet')).toBeVisible();
    await expect(page.getByText('Journey Main Wallet')).not.toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Device Detail Account Management ---

  test('device detail shows accounts and add derivation path options', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto(`/#/devices/${DEVICE_ID}`);

    await expect(page.getByRole('heading', { name: 'Journey Ledger' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Derivation Path' })).toBeVisible();

    // Open add derivation dialog
    await page.getByRole('button', { name: 'Add Derivation Path' }).click();
    await expect(page.getByRole('heading', { name: 'Add Derivation Path' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect via USB' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter Manually' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Backup Tabs ---

  test('admin backup switches between backup and restore tabs', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/backup');

    await expect(main.getByRole('heading', { name: 'Create Backup' })).toBeVisible();

    // Switch to restore tab
    await main.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Restore from Backup' })).toBeVisible();
    await expect(main.getByText('Drop backup file here or click to browse')).toBeVisible();

    // Switch back to backup tab
    await main.getByRole('button', { name: 'Backup', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Create Backup' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Cross-page State ---

  test('navigating from dashboard to wallet and back maintains state', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    // Start at dashboard
    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    // Go to wallet detail
    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
    await expect(page.getByRole('heading', { name: 'Journey Main Wallet' })).toBeVisible();

    // Go back to dashboard
    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });
});
