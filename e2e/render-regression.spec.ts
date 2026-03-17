import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

const MAINNET_WALLET_ID = 'wallet-mainnet-1';
const TESTNET_WALLET_ID = 'wallet-testnet-1';
const DEVICE_ID = 'device-render-1';

const VISUAL_ASSERTION_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const,
  maxDiffPixelRatio: 0.01,
};

async function expectChromiumMainScreenshot(page: Page, filename: string) {
  if (test.info().project.name !== 'chromium') {
    return;
  }
  await expect(page.getByRole('main')).toHaveScreenshot(filename, VISUAL_ASSERTION_OPTIONS);
}

const ADMIN_USER = {
  id: 'user-admin-render',
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
  name: 'Render Main Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'wpkh([abcd1234/84h/0h/0h]xpubMainRender/0/*)',
  fingerprint: 'abcd1234',
  balance: 125000000,
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
  name: 'Render Testnet Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'testnet',
  descriptor: 'wpkh([efgh5678/84h/1h/0h]tpubTestRender/0/*)',
  fingerprint: 'efgh5678',
  balance: 210000,
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

const RENDER_DEVICE = {
  id: DEVICE_ID,
  type: 'ledger',
  label: 'Render Ledger',
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
      id: 'acct-1',
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub-render-account',
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

const WEBSOCKET_STATS = {
  connections: {
    current: 3,
    max: 100,
    uniqueUsers: 2,
    maxPerUser: 10,
  },
  subscriptions: {
    total: 5,
    channels: 3,
    channelList: ['global:price', `wallet:${MAINNET_WALLET_ID}:transactions`],
  },
  rateLimits: {
    maxMessagesPerSecond: 15,
    gracePeriodMs: 2000,
    gracePeriodMessageLimit: 30,
    maxSubscriptionsPerConnection: 40,
  },
  recentRateLimitEvents: [],
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

const ELECTRUM_SERVERS = [
  {
    id: 'server-mainnet-1',
    nodeConfigId: 'node-config-1',
    network: 'mainnet',
    label: 'Mainnet Primary',
    host: 'electrum.mainnet.example',
    port: 50002,
    useSsl: true,
    priority: 0,
    enabled: true,
  },
  {
    id: 'server-testnet-1',
    nodeConfigId: 'node-config-1',
    network: 'testnet',
    label: 'Testnet Primary',
    host: 'electrum.testnet.example',
    port: 60002,
    useSsl: true,
    priority: 0,
    enabled: true,
  },
];

const TOR_CONTAINER_STATUS = {
  available: true,
  exists: true,
  running: true,
  status: 'running',
};

const MONITORING_SERVICES = {
  enabled: true,
  services: [
    {
      id: 'grafana',
      name: 'Grafana',
      description: 'Dashboards and visualization',
      url: 'http://{host}:3000',
      defaultPort: 3000,
      icon: 'BarChart3',
      isCustomUrl: false,
      status: 'healthy',
    },
    {
      id: 'prometheus',
      name: 'Prometheus',
      description: 'Metrics collection',
      url: 'http://{host}:9090',
      defaultPort: 9090,
      icon: 'Activity',
      isCustomUrl: false,
      status: 'healthy',
    },
    {
      id: 'jaeger',
      name: 'Jaeger',
      description: 'Distributed tracing',
      url: 'http://{host}:16686',
      defaultPort: 16686,
      icon: 'Network',
      isCustomUrl: false,
      status: 'unknown',
    },
  ],
};

const GRAFANA_CONFIG = {
  username: 'admin',
  passwordSource: 'GRAFANA_PASSWORD',
  password: 'render-grafana-password',
  anonymousAccess: false,
  anonymousAccessNote: 'Disabled by default',
};

const ADMIN_USERS = [
  {
    id: ADMIN_USER.id,
    username: ADMIN_USER.username,
    email: 'admin@sanctuary.local',
    isAdmin: true,
    createdAt: '2026-03-11T00:00:00.000Z',
    updatedAt: '2026-03-11T00:00:00.000Z',
  },
  {
    id: 'user-render-2',
    username: 'alice',
    email: null,
    isAdmin: false,
    createdAt: '2026-03-11T00:00:00.000Z',
    updatedAt: '2026-03-11T00:00:00.000Z',
  },
];

const ADMIN_GROUPS = [
  {
    id: 'group-render-1',
    name: 'Operators',
    description: 'Operations team',
    purpose: null,
    createdAt: '2026-03-11T00:00:00.000Z',
    updatedAt: '2026-03-11T00:00:00.000Z',
    members: [
      {
        userId: ADMIN_USER.id,
        username: ADMIN_USER.username,
        role: 'admin',
      },
      {
        userId: 'user-render-2',
        username: 'alice',
        role: 'member',
      },
    ],
  },
];

const ENCRYPTION_KEYS = {
  encryptionKey: 'render-encryption-key-0123456789abcdef',
  encryptionSalt: 'render-encryption-salt-abcdef0123456789',
  hasEncryptionKey: true,
  hasEncryptionSalt: true,
};

const AUDIT_LOGS_RESPONSE = {
  logs: [],
  total: 0,
  limit: 50,
  offset: 0,
};

const AUDIT_LOG_STATS = {
  totalEvents: 12,
  byCategory: {
    auth: 7,
    wallets: 3,
    system: 2,
  },
  byAction: {
    login: 5,
    logout: 2,
    create_wallet: 3,
    update_settings: 2,
  },
  failedEvents: 1,
};

const AI_CONTAINER_STATUS = {
  available: true,
  exists: true,
  running: false,
  status: 'exited',
};

type MockApiFailure = {
  status?: number;
  body?: unknown;
  timeout?: boolean;
};

type MockApiFailureMap = Record<string, MockApiFailure>;

async function mockAuthenticatedApi(page: Page, options?: { failures?: MockApiFailureMap }) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-render-token');
  });

  const unhandledRequests: string[] = [];

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
      return json(route, ADMIN_USER);
    }
    if (method === 'GET' && path === '/auth/registration-status') {
      return json(route, { enabled: false });
    }

    // Shared app shell data
    if (method === 'GET' && path === '/wallets') {
      return json(route, [MAINNET_WALLET, TESTNET_WALLET]);
    }
    if (method === 'GET' && path === '/devices') {
      return json(route, [RENDER_DEVICE]);
    }
    if (method === 'GET' && path === '/health') {
      return json(route, { status: 'ok' });
    }

    // Dashboard data
    if (method === 'GET' && path === '/admin/version') {
      return json(route, {
        updateAvailable: true,
        latestVersion: '0.9.0',
        currentVersion: '0.8.12',
        releaseUrl: 'https://example.com/releases/v0.9.0',
        releaseName: 'North Star',
      });
    }
    if (method === 'GET' && path === '/price') {
      return json(route, {
        price: 101234,
        currency: 'USD',
        sources: [],
        median: 101234,
        average: 101234,
        timestamp: '2026-03-11T00:00:00.000Z',
        cached: true,
        change24h: 3.21,
      });
    }
    if (method === 'GET' && path === '/bitcoin/status') {
      return json(route, {
        connected: true,
        blockHeight: 900123,
        explorerUrl: 'https://mempool.space',
        confirmationThreshold: 1,
        deepConfirmationThreshold: 6,
        pool: {
          enabled: true,
          minConnections: 1,
          maxConnections: 3,
          stats: {
            totalConnections: 3,
            activeConnections: 2,
            idleConnections: 1,
            waitingRequests: 0,
            totalAcquisitions: 50,
            averageAcquisitionTimeMs: 12,
            healthCheckFailures: 0,
            serverCount: 1,
            servers: [
              {
                serverId: 'server-1',
                label: 'Primary',
                host: 'electrum.example',
                port: 50002,
                connectionCount: 2,
                healthyConnections: 2,
                totalRequests: 100,
                failedRequests: 0,
                isHealthy: true,
                lastHealthCheck: '2026-03-11T00:00:00.000Z',
                consecutiveFailures: 0,
                backoffLevel: 0,
                cooldownUntil: null,
                weight: 1,
                healthHistory: [],
              },
            ],
          },
        },
      });
    }
    if (method === 'GET' && path === '/bitcoin/fees') {
      return json(route, {
        fastest: 22,
        halfHour: 16,
        hour: 10,
        economy: 4,
      });
    }
    if (method === 'GET' && path === '/bitcoin/mempool') {
      return json(route, {
        mempool: [],
        blocks: [],
        mempoolInfo: {
          count: 0,
          size: 0,
          totalFees: 0,
        },
        queuedBlocksSummary: null,
      });
    }
    if (method === 'GET' && path === '/transactions/recent') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/transactions/balance-history') {
      return json(route, [
        { name: 'Start', value: 125000000 },
        { name: 'Now', value: 125000000 },
      ]);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/transactions/pending`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${TESTNET_WALLET_ID}/transactions/pending`) {
      return json(route, []);
    }

    // Wallet detail route data
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}`) {
      return json(route, MAINNET_WALLET);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/transactions`) {
      return json(route, []);
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/transactions/stats`) {
      return json(route, {
        totalCount: 0,
        receivedCount: 0,
        sentCount: 0,
        consolidationCount: 0,
        totalReceived: 0,
        totalSent: 0,
        totalFees: 0,
        walletBalance: MAINNET_WALLET.balance,
      });
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/utxos`) {
      return json(route, {
        utxos: [],
        count: 0,
        totalBalance: 0,
      });
    }
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/privacy`) {
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
    if (method === 'GET' && path === `/wallets/${MAINNET_WALLET_ID}/addresses/summary`) {
      return json(route, {
        totalAddresses: 0,
        usedCount: 0,
        unusedCount: 0,
        totalBalance: 0,
        usedBalance: 0,
        unusedBalance: 0,
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

    // Device detail route data
    if (method === 'GET' && path === `/devices/${DEVICE_ID}`) {
      return json(route, RENDER_DEVICE);
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

    // Shared supporting data
    if (method === 'GET' && path === '/admin/groups') {
      return json(route, ADMIN_GROUPS);
    }
    if (method === 'GET' && path === '/admin/users') {
      return json(route, ADMIN_USERS);
    }
    if (method === 'GET' && path === '/admin/settings') {
      return json(route, SYSTEM_SETTINGS);
    }
    if (method === 'PUT' && path === '/admin/settings') {
      return json(route, SYSTEM_SETTINGS);
    }
    if (method === 'GET' && path === '/admin/websocket/stats') {
      return json(route, WEBSOCKET_STATS);
    }
    if (method === 'GET' && path === '/admin/features') {
      return json(route, FEATURE_FLAGS);
    }
    if (method === 'GET' && path === '/admin/features/audit-log') {
      return json(route, {
        entries: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    }
    if (method === 'GET' && path === '/admin/node-config') {
      return json(route, NODE_CONFIG);
    }
    if (method === 'PUT' && path === '/admin/node-config') {
      return json(route, NODE_CONFIG);
    }
    if (method === 'GET' && path === '/admin/electrum-servers') {
      return json(route, ELECTRUM_SERVERS);
    }
    if (method === 'GET' && path === '/admin/tor-container/status') {
      return json(route, TOR_CONTAINER_STATUS);
    }
    if (method === 'GET' && path === '/admin/monitoring/services') {
      return json(route, MONITORING_SERVICES);
    }
    if (method === 'GET' && path === '/admin/monitoring/grafana') {
      return json(route, GRAFANA_CONFIG);
    }
    if (method === 'POST' && path === '/admin/encryption-keys') {
      return json(route, ENCRYPTION_KEYS);
    }
    if (method === 'GET' && path === '/admin/audit-logs') {
      return json(route, AUDIT_LOGS_RESPONSE);
    }
    if (method === 'GET' && path === '/admin/audit-logs/stats') {
      return json(route, AUDIT_LOG_STATS);
    }
    if (method === 'GET' && path === '/ai/status') {
      return json(route, {
        available: false,
        containerAvailable: false,
      });
    }
    if (method === 'GET' && path === '/ai/ollama-container/status') {
      return json(route, AI_CONTAINER_STATUS);
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
        price: 101234,
        currency: 'USD',
        sources: [],
        median: 101234,
        average: 101234,
        timestamp: '2026-03-11T00:00:00.000Z',
        cached: true,
        change24h: 3.21,
      });
    }

    unhandledRequests.push(`${method} ${path}`);
    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);

  return unhandledRequests;
}

test.describe('Route-level rendering regressions', () => {
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

  test('dashboard renders core cards and network-specific placeholders', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/');

    await expect(page.getByText('Update Available: v0.9.0')).toBeVisible();
    await expect(page.getByText('Bitcoin Price')).toBeVisible();
    await expect(page.getByText('Fee Estimation')).toBeVisible();
    await expect(page.getByText('Node Status')).toBeVisible();
    await expect(page.getByText('900,123')).toBeVisible();
    await expect(page.getByText('22 sat/vB')).toBeVisible();

    await page.getByRole('button', { name: /Testnet/i }).click();
    await expect(page.getByText('Testnet coins have no market value')).toBeVisible();
    await expect(page.getByText(/^Testnet node not configured$/)).toBeVisible();
    await expectChromiumMainScreenshot(page, 'dashboard-testnet-shell.png');

    expect(unhandledRequests).toEqual([]);
  });

  test('wallet detail renders tab shells and empty-state content', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);

    await expect(page.getByRole('heading', { name: 'Render Main Wallet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transactions', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'UTXOs', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'drafts', exact: true })).toBeVisible();
    await expect(page.getByText('No transactions found.')).toBeVisible();

    await page.getByRole('button', { name: 'UTXOs', exact: true }).click();
    await expect(page.getByText('Available Outputs')).toBeVisible();

    await page.getByRole('button', { name: 'drafts', exact: true }).click();
    await expect(page.getByText('No draft transactions')).toBeVisible();

    await page.getByRole('button', { name: 'addresses', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No Addresses Available' })).toBeVisible();
    await expectChromiumMainScreenshot(page, 'wallet-detail-addresses-empty-shell.png');

    expect(unhandledRequests).toEqual([]);
  });

  test('device detail renders add-account flow options without crashing', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto(`/#/devices/${DEVICE_ID}`);

    await expect(page.getByRole('heading', { name: 'Render Ledger' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Derivation Path' }).click();

    await expect(page.getByRole('heading', { name: 'Add Derivation Path' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect via USB' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import from SD Card' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan QR Code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter Manually' })).toBeVisible();

    await page.getByRole('button', { name: 'Connect via USB' }).click();
    await expect(page.getByRole('button', { name: 'Connect Device' })).toBeVisible();

    await page.getByRole('button', { name: '← Back to options' }).click();
    await page.getByRole('button', { name: 'Scan QR Code' }).click();
    await expect(page.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('wallet list renders network-scoped cards and controls', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/wallets');

    await expect(page.getByRole('heading', { name: 'Mainnet Wallets' })).toBeVisible();
    await expect(page.getByText('Render Main Wallet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
    await expect(page.getByText('Render Testnet Wallet')).not.toBeVisible();

    await page.getByRole('button', { name: /Testnet/i }).click();
    await expect(page.getByRole('heading', { name: 'Testnet Wallets' })).toBeVisible();
    await expect(page.getByText('Render Testnet Wallet')).toBeVisible();
    await expectChromiumMainScreenshot(page, 'wallet-list-testnet-shell.png');

    expect(unhandledRequests).toEqual([]);
  });

  test('wallet list route renders first-wallet empty state when no wallets exist', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'GET /wallets': {
          status: 200,
          body: [],
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto('/#/wallets');

    await expect(main.getByRole('heading', { name: 'Wallet Overview' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'No Wallets Yet' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Create Wallet' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Import Wallet' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('settings route renders tab panels and notification sub-tabs', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Display', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Services', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();

    await main.getByRole('button', { name: 'Services', exact: true }).click();
    await expect(page.getByText('Price Provider')).toBeVisible();
    await expect(page.getByText('Current Bitcoin Price')).toBeVisible();

    await main.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notification Sounds' })).toBeVisible();
    await page.getByRole('button', { name: 'Telegram', exact: true }).click();
    await expect(page.getByText('Telegram Notifications')).toBeVisible();
    await expectChromiumMainScreenshot(page, 'settings-notifications-telegram-shell.png');

    expect(unhandledRequests).toEqual([]);
  });

  test('admin system settings route renders access and websocket panels', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/settings');

    await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Access Control', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'WebSocket', exact: true })).toBeVisible();
    await expect(page.getByText('Public Registration', { exact: true })).toBeVisible();
    await expect(page.getByText('Public registration is disabled. Only admins can create accounts.')).toBeVisible();

    await main.getByRole('button', { name: 'WebSocket', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'WebSocket Status' })).toBeVisible();
    await expect(page.getByText('Rate Limit Configuration')).toBeVisible();
    await expect(page.getByText('Max subscriptions/connection')).toBeVisible();

    await page.getByText('Rate Limit Events', { exact: true }).click();
    await expect(page.getByText('No rate limit events recorded')).toBeVisible();
    await expectChromiumMainScreenshot(page, 'admin-settings-websocket-shell.png');

    expect(unhandledRequests).toEqual([]);
  });

  test('admin feature flags route renders grouped flags and audit panel', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/feature-flags');

    await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
    await expect(page.getByText('General')).toBeVisible();
    await expect(page.getByText('Experimental')).toBeVisible();
    await expect(page.getByText('enhancedDashboard')).toBeVisible();
    await expect(page.getByText('treasuryAutopilot')).toBeVisible();
    await expect(page.getByText('Toggle features without restarting the server.')).toBeVisible();

    await page.getByRole('button', { name: 'Change History' }).click();
    await expect(page.getByText('No changes recorded yet.')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin node config route renders collapsible sections and key controls', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/node-config');

    await expect(page.getByRole('heading', { name: 'Node Configuration' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save All Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: /External Services/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Network Connections/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Proxy \/ Tor/i })).toBeVisible();

    await page.getByRole('button', { name: /External Services/i }).click();
    await expect(page.getByText('Block Explorer')).toBeVisible();
    await expect(page.getByText('Fee Estimation')).toBeVisible();
    await expect(page.getByText('Mempool API URL')).toBeVisible();

    await page.getByRole('button', { name: /Network Connections/i }).click();
    await expect(page.getByText('Connection Mode')).toBeVisible();
    await expect(page.getByRole('button', { name: 'mainnet (1)' })).toBeVisible();

    await page.getByRole('button', { name: /Proxy \/ Tor/i }).click();
    await expect(page.locator('span', { hasText: 'Bundled Tor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify Connection' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin monitoring route renders service cards and credentials', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/monitoring');

    await expect(page.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh Status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grafana' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prometheus' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Jaeger' })).toBeVisible();
    await expect(page.getByText('Anonymous viewing')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About Monitoring' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin monitoring route renders error panel when services API fails', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'GET /admin/monitoring/services': {
          status: 500,
          body: { message: 'Monitoring services failed in test' },
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto('/#/admin/monitoring');

    await expect(main.getByText('Monitoring services failed in test')).toBeVisible({ timeout: 20000 });
    await expect(main.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'About Monitoring' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin variables route renders system variable controls', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/variables');

    await expect(page.getByRole('heading', { name: 'System Variables' })).toBeVisible();
    await expect(page.getByText('Advanced Settings')).toBeVisible();
    await expect(page.getByText('Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Deep Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Dust Threshold', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin base route redirects to admin system settings', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin');

    await expect(page).toHaveURL(/#\/admin\/settings$/);
    await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin users & groups route renders user and group panels', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/users-groups');

    await expect(main.getByRole('heading', { name: 'Users & Groups' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Add User' })).toBeVisible();
    await expect(main.getByPlaceholder('New group name')).toBeVisible();
    await expect(main.getByText('admin', { exact: true })).toBeVisible();
    await expect(main.getByRole('paragraph').filter({ hasText: 'alice' }).first()).toBeVisible();
    await expect(main.getByText('Operators', { exact: true })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin backup route renders tabs and encryption keys panel', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/backup');

    await expect(main.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Backup', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Create Backup' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Encryption Keys' })).toBeVisible();
    await expect(main.getByText('Enter your password to reveal encryption keys.')).toBeVisible();

    // Reveal encryption keys via password entry
    await main.getByPlaceholder('Enter your password').fill('test-password');
    await main.getByRole('button', { name: 'Reveal' }).click();
    await expect(main.getByText('ENCRYPTION_KEY', { exact: true })).toBeVisible();

    await main.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Restore from Backup' })).toBeVisible();
    await expect(main.getByText('Drop backup file here or click to browse')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin audit logs route renders stats and table shell', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/audit-logs');

    await expect(main.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Filters' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(main.getByText('Total Events (30d)')).toBeVisible();
    await expect(main.getByText('Failed Events')).toBeVisible();
    await expect(main.getByText('Events by Category')).toBeVisible();
    await expect(main.getByText('No audit logs found')).toBeVisible();
    await expect(main.getByRole('columnheader', { name: 'Time' })).toBeVisible();
    await expect(main.getByRole('columnheader', { name: 'User' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin audit logs route renders error panel when logs API fails', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'GET /admin/audit-logs': {
          status: 500,
          body: { message: 'Audit logs failed in test' },
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto('/#/admin/audit-logs');

    await expect(main.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
    await expect(main.getByText('Audit logs failed in test')).toBeVisible({ timeout: 20000 });
    await expect(main.getByRole('button', { name: 'Refresh' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin ai route renders status workflow shell', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/ai');

    await expect(main.getByRole('heading', { name: 'AI Assistant' })).toBeVisible();
    await expect(main.getByText('Isolated AI Architecture')).toBeVisible();
    await expect(main.getByText('Enable AI Features')).toBeVisible();
    await expect(main.getByText('Bundled Container: Stopped')).toBeVisible();
    await expect(main.getByText('AI Status')).toBeVisible();
    await expect(main.getByRole('heading', { name: 'What AI Can Do' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Transaction Labeling' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Natural Language Queries' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('device list route renders table shell and primary actions', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/devices');

    await expect(main.getByRole('heading', { name: 'Hardware Devices' })).toBeVisible();
    await expect(main.getByText('Manage your signers and keys')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Connect New Device' })).toBeVisible();
    await expect(main.getByRole('columnheader', { name: 'Label' })).toBeVisible();
    await expect(main.getByRole('columnheader', { name: 'Fingerprint' })).toBeVisible();
    await expect(main.getByText('Render Ledger', { exact: true })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('create wallet route renders topology step and actions', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');

    await expect(main.getByText('Select Wallet Topology')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Single Signature' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Multi Signature' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Next Step' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await main.getByRole('button', { name: 'Single Signature' }).click();
    await expect(main.getByRole('button', { name: 'Next Step' })).toBeEnabled();

    expect(unhandledRequests).toEqual([]);
  });

  test('create wallet route shows no-compatible-device message for multisig selection', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');

    await main.getByRole('button', { name: 'Multi Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: 'Select Signers' })).toBeVisible();
    await expect(main.getByText('No devices with multisig accounts found.')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Connect New Device' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('create wallet route configuration shows network warning for testnet', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');

    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await main.getByText('Render Ledger', { exact: true }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await expect(main.getByText('Script Type')).toBeVisible();
    await main.getByRole('button', { name: 'Testnet' }).click();
    await expect(main.getByText('Testnet coins have no real-world value.')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('send transaction route renders transaction type selection shell', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

    await expect(main.getByRole('heading', { name: `Send from ${MAINNET_WALLET.name}` })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Standard Send' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Consolidation' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Sweep' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Cancel' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('send transaction route redirects viewers back to wallet detail', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        [`GET /wallets/${MAINNET_WALLET_ID}`]: {
          status: 200,
          body: {
            ...MAINNET_WALLET,
            userRole: 'viewer',
          },
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

    await expect(page).toHaveURL(new RegExp(`#\\/wallets\\/${MAINNET_WALLET_ID}$`));
    await expect(main.getByRole('heading', { name: MAINNET_WALLET.name })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Transactions', exact: true })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('send transaction route renders failure state when wallet fetch returns 500', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        [`GET /wallets/${MAINNET_WALLET_ID}`]: {
          status: 500,
          body: { message: 'Wallet fetch failed in test' },
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

    await expect(main.getByRole('heading', { name: 'Failed to Load' })).toBeVisible({ timeout: 20000 });
    await expect(main.getByText('Wallet fetch failed in test')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Go Back' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('send transaction route renders failure state when wallet fetch times out', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        [`GET /wallets/${MAINNET_WALLET_ID}`]: {
          timeout: true,
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

    await expect(main.getByRole('heading', { name: 'Failed to Load' })).toBeVisible({ timeout: 20000 });
    await expect(main.getByRole('button', { name: 'Go Back' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('connect device route renders selector and method shells', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/devices/connect');

    await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
    await expect(main.getByRole('heading', { name: '1. Select Your Device' })).toBeVisible();
    await expect(main.getByPlaceholder('Search devices...')).toBeVisible();
    await expect(main.getByRole('button', { name: 'All' })).toBeVisible();

    const modelCard = main.getByRole('button', { name: /Nano X/i }).first();
    await expect(modelCard).toBeVisible();
    await modelCard.click();

    await expect(main.getByRole('heading', { name: '2. Connection Method' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'USB' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'SD Card' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Manual Entry' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('connect device route search handles empty results and clear-filters recovery', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/devices/connect');

    await main.getByPlaceholder('Search devices...').fill('zzzz-unmatched-model');
    await expect(main.getByText('No devices match your search')).toBeVisible();
    await main.getByRole('button', { name: 'Clear filters' }).click();
    await expect(main.getByRole('button', { name: /Nano X/i }).first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('connect device route hides usb and qr options when context is not secure', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: false,
      });
    });
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/devices/connect');

    await main.getByRole('button', { name: /Nano X/i }).first().click();

    await expect(main.getByRole('heading', { name: '2. Connection Method' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'SD Card' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Manual Entry' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'USB' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'QR Code' })).toHaveCount(0);

    expect(unhandledRequests).toEqual([]);
  });

  test('connect device route renders save failure feedback when API returns 500', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'POST /devices': {
          status: 500,
          body: { message: 'Device save failed in test' },
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto('/#/devices/connect');

    await main.getByRole('button', { name: /Nano X/i }).first().click();
    await main.getByRole('button', { name: 'Manual Entry' }).click();
    await main.getByPlaceholder('00000000').fill('deadbeef');
    await main.getByPlaceholder('xpub... / ypub... / zpub...').fill('xpub-render-test');
    await main.getByRole('button', { name: 'Save Device' }).click();

    await expect(main.getByText('Device save failed in test')).toBeVisible({ timeout: 20000 });

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet route renders format selection options', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await expect(main.getByText('Select Import Format')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Output Descriptor' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'JSON/Text File' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Hardware Device' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'QR Code' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Next Step' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await expect(main.getByRole('button', { name: 'Next Step' })).toBeEnabled();

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet route renders validation failure feedback when API returns 500', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'POST /wallets/import/validate': {
          status: 500,
          body: { message: 'Import validation failed in test' },
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.locator('textarea').first().fill("wpkh([deadbeef/84h/0h/0h]xpub-render-test/0/*)");
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByText('Import validation failed in test')).toBeVisible({ timeout: 20000 });

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet descriptor step rejects oversized upload file', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await page.locator('#file-upload').setInputFiles({
      name: 'wallet-descriptor.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('a'.repeat(1_200_000)),
    });

    await expect(main.getByText(/File too large/)).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet descriptor step rejects invalid upload extension', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await page.locator('#file-upload').setInputFiles({
      name: 'wallet.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"wallet":"test"}'),
    });

    await expect(main.getByText('Invalid file type. Expected: .txt')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet route renders hardware import step shell', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await main.getByRole('button', { name: 'Hardware Device' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
    await expect(main.getByText('Device Type', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Ledger' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Trezor' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Connect Device' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet route renders qr scan step shell', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await main.getByRole('button', { name: 'QR Code' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: 'Scan Wallet QR Code' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Start Camera' })).toBeVisible();
    await expect(main.getByText('Supported formats:')).toBeVisible();
    await expect(main.getByText('Foundation Passport (animated UR:BYTES QR)')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet hardware step shows HTTPS requirement in insecure context', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: false,
      });
    });
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await main.getByRole('button', { name: 'Hardware Device' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
    await expect(main.getByText('Requires HTTPS connection')).toBeVisible();
    await expect(main.getByRole('button', { name: /Ledger/ })).toBeDisabled();

    expect(unhandledRequests).toEqual([]);
  });

  test('import wallet qr step shows HTTPS camera warning in insecure context', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: false,
      });
    });
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await main.getByRole('button', { name: 'QR Code' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: 'Scan Wallet QR Code' })).toBeVisible();
    await expect(main.getByText('Camera access requires HTTPS. Please use https://localhost:8443')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('account route renders profile, password, and 2fa sections', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/account');

    await expect(main.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Profile Information' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Change Password' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();
    await expect(main.getByText('Username')).toBeVisible();
    await expect(main.getByText('admin', { exact: true })).toBeVisible();
    await expect(main.getByText('Account Type')).toBeVisible();
    await expect(main.getByText('Administrator')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Enable 2FA' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('admin settings route renders websocket error panel when stats API fails', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'GET /admin/websocket/stats': {
          status: 500,
          body: { message: 'WebSocket stats failed in test' },
        },
      },
    });
    const main = page.getByRole('main');

    await page.goto('/#/admin/settings');

    await main.getByRole('button', { name: 'WebSocket', exact: true }).click();
    await expect(main.getByText('WebSocket stats failed in test')).toBeVisible({ timeout: 20000 });

    expect(unhandledRequests).toEqual([]);
  });

  test('unknown authenticated route redirects to dashboard', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/route-that-does-not-exist');

    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByText('Bitcoin Price')).toBeVisible();
    await expect(page.getByText('Fee Estimation')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('expired authenticated session redirects to login when /auth/me returns 401', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page, {
      failures: {
        'GET /auth/me': {
          status: 401,
          body: { message: 'Unauthorized' },
        },
      },
    });

    await page.goto('/#/wallets');

    await expect(page.getByRole('heading', { name: 'Sanctuary' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByText('Backend API:')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('unauthenticated root route renders login screen', async ({ page }) => {
    const unhandledRequests = await mockPublicApi(page);

    await page.goto('/#/');

    await expect(page.getByRole('heading', { name: 'Sanctuary' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByText('Backend API:')).toBeVisible();
    await expect(page.getByText('Contact administrator for account access')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });
});
