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

const THEME_UTILITY_PROBE_ATTRIBUTE = 'data-render-theme-utility-probe';
const THEME_UTILITY_PROBE_CLASS = 'bg-primary-800';
const THEME_UTILITY_TIMEOUT_MS = 15_000;
const REQUIRED_THEME_VARIABLES = ['--color-primary-800', '--color-primary-600', '--color-bg-50'];

// Tailwind's CDN runtime generates custom theme utilities asynchronously.
// Screenshots wait for the themed primary background to paint so controls do
// not capture the white-on-white fallback state seen in CI.
async function waitForThemeUtilityPaint(page: Page): Promise<void> {
  await page.evaluate(({ attributeName, probeClass }) => {
    if (!document.body || document.querySelector(`[${attributeName}="true"]`)) {
      return;
    }

    const probe = document.createElement('span');
    probe.setAttribute(attributeName, 'true');
    probe.setAttribute('aria-hidden', 'true');
    probe.className = probeClass;
    probe.style.cssText =
      'position: fixed; top: -100px; left: 0; width: 1px; height: 1px; pointer-events: none;';
    document.body.appendChild(probe);
  }, {
    attributeName: THEME_UTILITY_PROBE_ATTRIBUTE,
    probeClass: THEME_UTILITY_PROBE_CLASS,
  });

  try {
    await page.waitForFunction(
      ({ attributeName, requiredVariables }) => {
        if (!document.body) {
          return false;
        }

        const probe = document.querySelector(`[${attributeName}="true"]`);
        if (!(probe instanceof HTMLElement)) {
          return false;
        }

        const rootStyles = getComputedStyle(document.documentElement);
        const cssVariablesReady = requiredVariables.every(
          variableName => rootStyles.getPropertyValue(variableName).trim() !== ''
        );
        const themeClassReady = Array.from(document.body.classList).some(className =>
          className.startsWith('theme-')
        );

        if (!cssVariablesReady || !themeClassReady) {
          return false;
        }

        const styles = getComputedStyle(probe);
        return (
          styles.backgroundColor !== '' &&
          styles.backgroundColor !== 'transparent' &&
          styles.backgroundColor !== 'rgba(0, 0, 0, 0)'
        );
      },
      {
        attributeName: THEME_UTILITY_PROBE_ATTRIBUTE,
        requiredVariables: REQUIRED_THEME_VARIABLES,
      },
      { timeout: THEME_UTILITY_TIMEOUT_MS }
    );
  } finally {
    await page
      .evaluate(attributeName => {
        document.querySelector(`[${attributeName}="true"]`)?.remove();
      }, THEME_UTILITY_PROBE_ATTRIBUTE)
      .catch(() => undefined);
  }

  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

export async function expectChromiumMainScreenshot(page: Page, filename: string) {
  if (test.info().project.name !== 'chromium') {
    return;
  }
  await waitForThemeUtilityPaint(page);
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

type MockApiFailure = {
  status?: number;
  body?: unknown;
  timeout?: boolean;
};

type MockApiFailureMap = Record<string, MockApiFailure>;

type MockApiResponse = {
  status?: number;
  body: unknown;
};

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
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

async function maybeFulfillInjectedFailure(
  route: Route,
  requestKey: string,
  failure?: MockApiFailure
): Promise<boolean> {
  if (!failure) {
    return false;
  }

  if (failure.timeout) {
    await route.abort('timedout');
    return true;
  }

  await json(
    route,
    failure.body ?? { message: `Injected failure for ${requestKey}` },
    failure.status ?? 500
  );
  return true;
}

const BITCOIN_STATUS_RESPONSE = {
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
};

const DEVICE_MODELS_RESPONSE = [
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
];

const AUTHENTICATED_API_RESPONSES: Record<string, MockApiResponse> = {
  'GET /auth/me': mockResponse(ADMIN_USER),
  // Return 401 so refresh remains terminal unless a test overrides it via failures.
  'POST /auth/refresh': mockResponse({ message: 'Unauthorized' }, 401),
  'POST /auth/logout': mockResponse({ success: true }),
  'GET /auth/registration-status': mockResponse({ enabled: false }),
  'GET /wallets': mockResponse([MAINNET_WALLET, TESTNET_WALLET]),
  'GET /devices': mockResponse([RENDER_DEVICE]),
  'GET /health': mockResponse({ status: 'ok' }),
  'GET /admin/version': mockResponse({
    updateAvailable: true,
    latestVersion: '0.9.0',
    currentVersion: '0.8.12',
    releaseUrl: 'https://example.com/releases/v0.9.0',
    releaseName: 'North Star',
  }),
  'GET /price': mockResponse({
    price: 101234,
    currency: 'USD',
    sources: [],
    median: 101234,
    average: 101234,
    timestamp: '2026-03-11T00:00:00.000Z',
    cached: true,
    change24h: 3.21,
  }),
  'GET /bitcoin/status': mockResponse(BITCOIN_STATUS_RESPONSE),
  'GET /bitcoin/fees': mockResponse({ fastest: 22, halfHour: 16, hour: 10, economy: 4 }),
  'GET /bitcoin/mempool': mockResponse({
    mempool: [],
    blocks: [],
    mempoolInfo: { count: 0, size: 0, totalFees: 0 },
    queuedBlocksSummary: null,
  }),
  'GET /transactions/recent': mockResponse([]),
  'GET /transactions/balance-history': mockResponse([
    { name: 'Start', value: 125000000 },
    { name: 'Now', value: 125000000 },
  ]),
  [`GET /wallets/${MAINNET_WALLET_ID}/transactions/pending`]: mockResponse([]),
  [`GET /wallets/${TESTNET_WALLET_ID}/transactions/pending`]: mockResponse([]),
  [`GET /wallets/${MAINNET_WALLET_ID}`]: mockResponse(MAINNET_WALLET),
  [`GET /wallets/${MAINNET_WALLET_ID}/transactions`]: mockResponse([]),
  [`GET /wallets/${MAINNET_WALLET_ID}/transactions/stats`]: mockResponse({
    totalCount: 0,
    receivedCount: 0,
    sentCount: 0,
    consolidationCount: 0,
    totalReceived: 0,
    totalSent: 0,
    totalFees: 0,
    walletBalance: MAINNET_WALLET.balance,
  }),
  [`GET /wallets/${MAINNET_WALLET_ID}/utxos`]: mockResponse({
    utxos: [],
    count: 0,
    totalBalance: 0,
  }),
  [`GET /wallets/${MAINNET_WALLET_ID}/privacy`]: mockResponse({
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
  [`GET /wallets/${MAINNET_WALLET_ID}/addresses/summary`]: mockResponse({
    totalAddresses: 0,
    usedCount: 0,
    unusedCount: 0,
    totalBalance: 0,
    usedBalance: 0,
    unusedBalance: 0,
  }),
  [`GET /wallets/${MAINNET_WALLET_ID}/addresses`]: mockResponse([]),
  [`GET /wallets/${MAINNET_WALLET_ID}/drafts`]: mockResponse([]),
  [`GET /wallets/${TESTNET_WALLET_ID}/drafts`]: mockResponse([]),
  [`GET /wallets/${MAINNET_WALLET_ID}/share`]: mockResponse({ group: null, users: [] }),
  [`GET /devices/${DEVICE_ID}`]: mockResponse(RENDER_DEVICE),
  'GET /devices/models': mockResponse(DEVICE_MODELS_RESPONSE),
  [`GET /devices/${DEVICE_ID}/share`]: mockResponse({
    users: [{ id: ADMIN_USER.id, username: ADMIN_USER.username, role: 'owner' }],
    group: null,
  }),
  'GET /admin/groups': mockResponse(ADMIN_GROUPS),
  'GET /admin/agents': mockResponse([]),
  'GET /admin/users': mockResponse(ADMIN_USERS),
  'GET /admin/settings': mockResponse(SYSTEM_SETTINGS),
  'PUT /admin/settings': mockResponse(SYSTEM_SETTINGS),
  'GET /admin/websocket/stats': mockResponse(WEBSOCKET_STATS),
  'GET /admin/features': mockResponse(FEATURE_FLAGS),
  'GET /admin/features/audit-log': mockResponse({ entries: [], total: 0, limit: 50, offset: 0 }),
  'GET /admin/node-config': mockResponse(NODE_CONFIG),
  'PUT /admin/node-config': mockResponse(NODE_CONFIG),
  'GET /admin/electrum-servers': mockResponse(ELECTRUM_SERVERS),
  'GET /admin/tor-container/status': mockResponse(TOR_CONTAINER_STATUS),
  'GET /admin/monitoring/services': mockResponse(MONITORING_SERVICES),
  'GET /admin/monitoring/grafana': mockResponse(GRAFANA_CONFIG),
  'POST /admin/encryption-keys': mockResponse(ENCRYPTION_KEYS),
  'GET /admin/audit-logs': mockResponse(AUDIT_LOGS_RESPONSE),
  'GET /admin/audit-logs/stats': mockResponse(AUDIT_LOG_STATS),
  'GET /ai/status': mockResponse({ available: false, containerAvailable: false }),
  'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
};

function getAuthenticatedApiResponse(method: string, path: string): MockApiResponse | null {
  const response = AUTHENTICATED_API_RESPONSES[`${method} ${path}`];
  if (response) {
    return response;
  }
  if (method === 'GET' && /^\/wallets\/[^/]+\/labels$/.test(path)) {
    return mockResponse([]);
  }
  return null;
}

function createAuthenticatedApiRouteHandler(
  unhandledRequests: string[],
  failures?: MockApiFailureMap
) {
  const apiRouteHandler = async (route: Route) => {
    const { method, path, requestKey } = parseApiRoute(route);
    if (await maybeFulfillInjectedFailure(route, requestKey, failures?.[requestKey])) {
      return;
    }

    const response = getAuthenticatedApiResponse(method, path);
    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    unhandledRequests.push(`${method} ${path}`);
    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

export async function mockAuthenticatedApi(page: Page, options?: { failures?: MockApiFailureMap }) {
  // ADR 0001 / 0002 Phase 6: browser auth is cookie-only. The legacy
  // localStorage seeding is dead code now — the frontend does not read
  // any token from local/session storage. The "authenticated" state is
  // established by `GET /auth/me` returning 200 below.

  const unhandledRequests: string[] = [];
  const apiRouteHandler = createAuthenticatedApiRouteHandler(unhandledRequests, options?.failures);

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
