import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from '../helpers';

export const MAINNET_WALLET_ID = 'wallet-mainnet-1';
export const TESTNET_WALLET_ID = 'wallet-testnet-1';
export const DEVICE_ID = 'device-render-1';

export const VISUAL_ASSERTION_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const,
  maxDiffPixelRatio: 0.01,
};

export async function expectChromiumMainScreenshot(page: Page, filename: string) {
  if (test.info().project.name !== 'chromium') {
    return;
  }
  await expect(page.getByRole('main')).toHaveScreenshot(filename, VISUAL_ASSERTION_OPTIONS);
}

export const ADMIN_USER = {
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

export const MAINNET_WALLET = {
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

export const TESTNET_WALLET = {
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

export const RENDER_DEVICE = {
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

export const SYSTEM_SETTINGS = {
  registrationEnabled: false,
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  dustThreshold: 546,
  aiEnabled: false,
};

export const WEBSOCKET_STATS = {
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

export const FEATURE_FLAGS = [
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

export const NODE_CONFIG = {
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

export const ELECTRUM_SERVERS = [
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

export const TOR_CONTAINER_STATUS = {
  available: true,
  exists: true,
  running: true,
  status: 'running',
};

export const MONITORING_SERVICES = {
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

export const GRAFANA_CONFIG = {
  username: 'admin',
  passwordSource: 'GRAFANA_PASSWORD',
  password: 'render-grafana-password',
  anonymousAccess: false,
  anonymousAccessNote: 'Disabled by default',
};

export const ADMIN_USERS = [
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

export const ADMIN_GROUPS = [
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

export const ENCRYPTION_KEYS = {
  encryptionKey: 'render-encryption-key-0123456789abcdef',
  encryptionSalt: 'render-encryption-salt-abcdef0123456789',
  hasEncryptionKey: true,
  hasEncryptionSalt: true,
};

export const AUDIT_LOGS_RESPONSE = {
  logs: [],
  total: 0,
  limit: 50,
  offset: 0,
};

export const AUDIT_LOG_STATS = {
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

export const AI_CONTAINER_STATUS = {
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

export async function mockAuthenticatedApi(page: Page, options?: { failures?: MockApiFailureMap }) {
  // ADR 0001 / 0002 Phase 6: browser auth is cookie-only. The legacy
  // localStorage seeding is dead code now — the frontend does not read
  // any token from local/session storage. The "authenticated" state is
  // established by `GET /auth/me` returning 200 below.

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
    // Phase 5/6: the 401 interceptor on `/auth/me` triggers a refresh
    // attempt. When a test injects `/auth/me` → 401 via `failures`, the
    // frontend will follow up with `POST /auth/refresh`. Return 401 so
    // the refresh is a terminal failure and the user is redirected to
    // login. Tests that want to exercise a successful mid-session
    // refresh can override this via `failures`.
    if (method === 'POST' && path === '/auth/refresh') {
      return json(route, { message: 'Unauthorized' }, 401);
    }
    // Logout after authenticated navigation (Layout exposes a logout
    // action and some tests trigger it as a side-effect of navigating).
    if (method === 'POST' && path === '/auth/logout') {
      return json(route, { success: true });
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
    if (method === 'GET' && path.match(/^\/wallets\/[^/]+\/labels$/)) return json(route, []);

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
    if (method === 'GET' && path === '/intelligence/status') {
      return json(route, { available: false, ollamaConfigured: false });
    }

    unhandledRequests.push(`${method} ${path}`);
    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);

  return unhandledRequests;
}

export async function mockPublicApi(page: Page) {
  // ADR 0001 / 0002 Phase 6: legacy localStorage token seeding is dead.
  // The unauthenticated state is established by `GET /auth/me` returning
  // 401 and `POST /auth/refresh` also returning 401 (terminal failure).

  const unhandledRequests: string[] = [];

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    if (method === 'GET' && path === '/health') {
      return json(route, { status: 'ok' });
    }
    // Phase 4+: UserContext boots by calling /auth/me. Unauthenticated
    // users get 401, which triggers the 401 interceptor's refresh path.
    // Both must be handled or the frontend stalls on unhandled requests.
    if (method === 'GET' && path === '/auth/me') {
      return json(route, { message: 'Unauthorized' }, 401);
    }
    if (method === 'POST' && path === '/auth/refresh') {
      return json(route, { message: 'Unauthorized' }, 401);
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


export function setupRenderRegressionErrorChecks(): void {
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
}
