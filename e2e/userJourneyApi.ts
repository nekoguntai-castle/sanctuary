import type { Page, Route } from '@playwright/test';
import { json, registerApiRoutes, unmocked } from './helpers';

export const MAINNET_WALLET_ID = 'wallet-journey-main';
const TESTNET_WALLET_ID = 'wallet-journey-test';
export const DEVICE_ID = 'device-journey-1';

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

export const MAINNET_WALLET = {
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

type MockApiResponse = {
  status?: number;
  body: unknown;
};

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
};

type AuthenticatedApiState = {
  user: typeof ADMIN_USER;
  wallets: typeof MAINNET_WALLET[];
  settings: typeof SYSTEM_SETTINGS;
  preferences: typeof ADMIN_USER.preferences;
  unhandledRequests: string[];
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

function mergePostBody<T extends object>(route: Route, current: T): T {
  try {
    return { ...current, ...route.request().postDataJSON() } as T;
  } catch {
    return current;
  }
}

async function maybeFulfillFailure(
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
};

const WALLET_TRANSACTION_STATS_RESPONSE = {
  totalCount: 0,
  receivedCount: 0,
  sentCount: 0,
  consolidationCount: 0,
  totalReceived: 0,
  totalSent: 0,
  totalFees: 0,
  walletBalance: MAINNET_WALLET.balance,
};

const WALLET_PRIVACY_RESPONSE = {
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

const NODE_CONFIG_RESPONSE = {
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

const AUTHENTICATED_STATIC_API_RESPONSES: Record<string, MockApiResponse> = {
  'POST /auth/refresh': mockResponse({ message: 'Unauthorized' }, 401),
  'POST /auth/logout': mockResponse({ success: true }),
  'GET /auth/registration-status': mockResponse({ enabled: false }),
  'GET /devices': mockResponse([JOURNEY_DEVICE]),
  'GET /health': mockResponse({ status: 'ok' }),
  'GET /admin/version': mockResponse({ updateAvailable: false, currentVersion: '0.8.14' }),
  'GET /price': mockResponse(PRICE_RESPONSE),
  'GET /bitcoin/status': mockResponse(BITCOIN_STATUS_RESPONSE),
  'GET /bitcoin/fees': mockResponse({ fastest: 18, halfHour: 12, hour: 8, economy: 3 }),
  'GET /bitcoin/mempool': mockResponse({
    mempool: [],
    blocks: [],
    mempoolInfo: { count: 0, size: 0, totalFees: 0 },
    queuedBlocksSummary: null,
  }),
  'GET /transactions/recent': mockResponse([]),
  'GET /transactions/balance-history': mockResponse([
    { name: 'Start', value: 250000000 },
    { name: 'Now', value: 250000000 },
  ]),
  [`GET /wallets/${MAINNET_WALLET_ID}/transactions/pending`]: mockResponse([]),
  [`GET /wallets/${TESTNET_WALLET_ID}/transactions/pending`]: mockResponse([]),
  [`GET /wallets/${MAINNET_WALLET_ID}`]: mockResponse(MAINNET_WALLET),
  [`GET /wallets/${MAINNET_WALLET_ID}/transactions`]: mockResponse([]),
  [`GET /wallets/${MAINNET_WALLET_ID}/transactions/stats`]: mockResponse(WALLET_TRANSACTION_STATS_RESPONSE),
  [`GET /wallets/${MAINNET_WALLET_ID}/utxos`]: mockResponse({ utxos: [], count: 0, totalBalance: 0 }),
  [`GET /wallets/${MAINNET_WALLET_ID}/privacy`]: mockResponse(WALLET_PRIVACY_RESPONSE),
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
  [`GET /devices/${DEVICE_ID}`]: mockResponse(JOURNEY_DEVICE),
  'GET /devices/models': mockResponse(DEVICE_MODELS_RESPONSE),
  [`GET /devices/${DEVICE_ID}/share`]: mockResponse({
    users: [{ id: ADMIN_USER.id, username: ADMIN_USER.username, role: 'owner' }],
    group: null,
  }),
  'GET /admin/groups': mockResponse([]),
  'GET /admin/users': mockResponse([
    {
      id: ADMIN_USER.id,
      username: 'admin',
      email: null,
      isAdmin: true,
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T00:00:00.000Z',
    },
  ]),
  'GET /admin/websocket/stats': mockResponse({
    connections: { current: 1, max: 100, uniqueUsers: 1, maxPerUser: 10 },
    subscriptions: { total: 1, channels: 1, channelList: ['global:price'] },
    rateLimits: {
      maxMessagesPerSecond: 15,
      gracePeriodMs: 2000,
      gracePeriodMessageLimit: 30,
      maxSubscriptionsPerConnection: 40,
    },
    recentRateLimitEvents: [],
  }),
  'GET /admin/features': mockResponse(FEATURE_FLAGS),
  'GET /admin/features/audit-log': mockResponse({ entries: [], total: 0, limit: 50, offset: 0 }),
  'GET /admin/node-config': mockResponse(NODE_CONFIG_RESPONSE),
  'PUT /admin/node-config': mockResponse({}),
  'GET /admin/electrum-servers': mockResponse([]),
  'GET /admin/tor-container/status': mockResponse({
    available: true,
    exists: true,
    running: true,
    status: 'running',
  }),
  'GET /admin/monitoring/services': mockResponse({ enabled: true, services: [] }),
  'GET /admin/monitoring/grafana': mockResponse({
    username: 'admin',
    password: 'test',
    anonymousAccess: false,
    anonymousAccessNote: 'Disabled',
  }),
  'POST /admin/encryption-keys': mockResponse({
    encryptionKey: 'test-key',
    encryptionSalt: 'test-salt',
    hasEncryptionKey: true,
    hasEncryptionSalt: true,
  }),
  'GET /admin/audit-logs': mockResponse({ logs: [], total: 0, limit: 50, offset: 0 }),
  'GET /admin/audit-logs/stats': mockResponse({
    totalEvents: 0,
    byCategory: {},
    byAction: {},
    failedEvents: 0,
  }),
  'GET /ai/status': mockResponse({ available: false, containerAvailable: false }),
  'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
  'GET /ai/ollama-container/status': mockResponse({
    available: true,
    exists: true,
    running: false,
    status: 'exited',
  }),
};

function getStatefulApiResponse(
  route: Route,
  parsedRoute: ParsedApiRoute,
  state: AuthenticatedApiState
): MockApiResponse | null {
  if (parsedRoute.requestKey === 'GET /auth/me') {
    return mockResponse({ ...state.user, preferences: state.preferences });
  }
  if (parsedRoute.requestKey === 'PUT /auth/preferences') {
    state.preferences = mergePostBody(route, state.preferences);
    return mockResponse(state.preferences);
  }
  if (parsedRoute.requestKey === 'GET /wallets') {
    return mockResponse(state.wallets);
  }
  if (parsedRoute.requestKey === 'GET /admin/settings') {
    return mockResponse(state.settings);
  }
  if (parsedRoute.requestKey === 'PUT /admin/settings') {
    state.settings = mergePostBody(route, state.settings);
    return mockResponse(state.settings);
  }
  return null;
}

function getAuthenticatedApiResponse(
  route: Route,
  parsedRoute: ParsedApiRoute,
  state: AuthenticatedApiState
): MockApiResponse | null {
  const statefulResponse = getStatefulApiResponse(route, parsedRoute, state);
  if (statefulResponse) {
    return statefulResponse;
  }

  const response = AUTHENTICATED_STATIC_API_RESPONSES[parsedRoute.requestKey];
  if (response) {
    return response;
  }
  if (parsedRoute.method === 'GET' && /^\/wallets\/[^/]+\/labels$/.test(parsedRoute.path)) {
    return mockResponse([]);
  }
  return null;
}

function createAuthenticatedApiRouteHandler(
  state: AuthenticatedApiState,
  failures?: MockApiFailureMap
) {
  const apiRouteHandler = async (route: Route) => {
    const parsedRoute = parseApiRoute(route);
    const { method, path, requestKey } = parsedRoute;

    if (await maybeFulfillFailure(route, requestKey, failures?.[requestKey])) {
      return;
    }

    const response = getAuthenticatedApiResponse(route, parsedRoute, state);
    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    state.unhandledRequests.push(`${method} ${path}`);
    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

export async function mockAuthenticatedApi(
  page: Page,
  options?: {
    failures?: MockApiFailureMap;
    user?: typeof ADMIN_USER;
    wallets?: typeof MAINNET_WALLET[];
  }
) {
  const user = options?.user ?? ADMIN_USER;
  const wallets = options?.wallets ?? [MAINNET_WALLET, TESTNET_WALLET];
  const unhandledRequests: string[] = [];
  const state: AuthenticatedApiState = {
    user,
    wallets,
    settings: { ...SYSTEM_SETTINGS },
    preferences: { ...user.preferences },
    unhandledRequests,
  };

  await registerApiRoutes(
    page,
    createAuthenticatedApiRouteHandler(state, options?.failures)
  );

  return unhandledRequests;
}

export async function mockPublicApi(page: Page) {
  const unhandledRequests: string[] = [];

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    if (method === 'GET' && path === '/health') {
      return json(route, { status: 'ok' });
    }
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

    unhandledRequests.push(`${method} ${path}`);
    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);

  return unhandledRequests;
}
