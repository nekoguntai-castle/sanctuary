import {
  ADMIN_USER,
  AGENT_MANAGEMENT_OPTIONS,
  FEATURE_FLAGS,
  NODE_CONFIG,
  REGULAR_USER,
  SYSTEM_SETTINGS,
} from './adminOperationsFixtures';

export type MockApiFailure = {
  status?: number;
  body?: unknown;
};

export type MockApiResponse = {
  status?: number;
  body: unknown;
};

export type FeatureFlag = {
  key: string;
  enabled: boolean;
  description: string;
  category: string;
  source: string;
  modifiedBy: string | null;
  updatedAt: string | null;
};

export type AdminOpsUser = {
  id: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminOpsGroup = {
  id: string;
  name: string;
  members: { id: string; username: string }[];
};

export type AdminApiState = {
  flagState: FeatureFlag[];
  settingsState: typeof SYSTEM_SETTINGS;
  usersState: AdminOpsUser[];
  groupsState: AdminOpsGroup[];
  nodeConfigState: Record<string, unknown>;
};

export function mockResponse(body: unknown, status?: number): MockApiResponse {
  return { body, status };
}

export function createAdminApiState(): AdminApiState {
  return {
    flagState: FEATURE_FLAGS.map(f => ({ ...f })),
    settingsState: { ...SYSTEM_SETTINGS },
    usersState: [
      { id: ADMIN_USER.id, username: 'admin', email: null, isAdmin: true, createdAt: '2026-03-11T00:00:00.000Z', updatedAt: '2026-03-11T00:00:00.000Z' },
      { ...REGULAR_USER },
    ],
    groupsState: [],
    nodeConfigState: { ...NODE_CONFIG },
  };
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

const WEBSOCKET_STATS_RESPONSE = {
  connections: { current: 1, max: 100, uniqueUsers: 1, maxPerUser: 10 },
  subscriptions: { total: 1, channels: 1, channelList: ['global:price'] },
  rateLimits: { maxMessagesPerSecond: 15 },
  recentRateLimitEvents: [],
};

export const STATIC_ADMIN_API_RESPONSES: Record<string, MockApiResponse> = {
  'GET /auth/me': mockResponse(ADMIN_USER),
  'GET /health': mockResponse({ status: 'ok' }),
  'GET /wallets': mockResponse([]),
  'GET /devices': mockResponse([]),
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
  'GET /admin/agents': mockResponse([]),
  'GET /admin/agents/dashboard': mockResponse([]),
  'GET /admin/agents/options': mockResponse(AGENT_MANAGEMENT_OPTIONS),
  'GET /transactions/recent': mockResponse([]),
  'GET /transactions/balance-history': mockResponse([]),
  'GET /admin/features/audit-log': mockResponse({ entries: [], total: 0, limit: 50, offset: 0 }),
  'GET /admin/electrum-servers': mockResponse([]),
  'GET /admin/tor-container/status': mockResponse({ available: true, exists: true, running: true, status: 'running' }),
  'GET /admin/websocket/stats': mockResponse(WEBSOCKET_STATS_RESPONSE),
  'GET /admin/audit-logs': mockResponse({ logs: [], total: 0, limit: 50, offset: 0 }),
  'GET /admin/audit-logs/stats': mockResponse({
    totalEvents: 0,
    byCategory: {},
    byAction: {},
    failedEvents: 0,
  }),
  'GET /admin/monitoring/services': mockResponse({ enabled: true, services: [] }),
  'GET /admin/monitoring/grafana': mockResponse({ username: 'admin', password: 'test', anonymousAccess: false }),
  'GET /ai/status': mockResponse({ available: false, containerAvailable: false }),
  'GET /ai/ollama-container/status': mockResponse({ available: true, exists: true, running: false, status: 'exited' }),
  'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
  'GET /admin/encryption-keys': mockResponse({ hasEncryptionKey: true, hasEncryptionSalt: true }),
};
