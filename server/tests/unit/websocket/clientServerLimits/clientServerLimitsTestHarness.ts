import { vi } from 'vitest';
import { WebSocket } from 'ws';

const clientServerLimitMocks = vi.hoisted(() => {
  const mockCheckWalletAccess = vi.fn(async (_walletId: string, _userId: string) => ({
    hasAccess: true, canEdit: true, role: 'owner',
  }));
  const mockCheckWalletAccessCached = vi.fn(async (_walletId: string, _userId: string) => ({
    hasAccess: true, canEdit: true, role: 'owner',
  }));
  const mockVerifyToken = vi.fn(async () => ({
    userId: 'user-1',
    username: 'alice',
    isAdmin: false,
    sessionVersion: 0,
    jti: 'access-jti',
    exp: Math.floor(Date.now() / 1000) + 60,
  }));
  const mockResolveCurrentAccessTokenPayload = vi.fn(async (payload) => payload);
  const mockPublishBroadcast = vi.fn();
  const mockIsTokenRevoked = vi.fn(async () => false);
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const metricMocks = {
    websocketConnections: { inc: vi.fn(), dec: vi.fn() },
    websocketMessagesTotal: { inc: vi.fn() },
    websocketRateLimitHits: { inc: vi.fn() },
    websocketSubscriptions: { inc: vi.fn(), dec: vi.fn() },
    websocketConnectionDuration: { observe: vi.fn() },
  };

  return {
    metricMocks,
    mockCheckWalletAccess,
    mockCheckWalletAccessCached,
    mockPublishBroadcast,
    mockIsTokenRevoked,
    mockLogger,
    mockResolveCurrentAccessTokenPayload,
    mockVerifyToken,
  };
});

vi.mock('../../../../src/services/accessControl', () => ({
  checkWalletAccess: clientServerLimitMocks.mockCheckWalletAccessCached,
  checkWalletAccessUncached: clientServerLimitMocks.mockCheckWalletAccess,
}));

vi.mock('../../../../src/utils/jwt', () => ({
  TokenAudience: {
    ACCESS: 'sanctuary:access',
  },
  verifyToken: clientServerLimitMocks.mockVerifyToken,
}));

vi.mock('../../../../src/services/accessTokenSessionService', () => ({
  resolveCurrentAccessTokenPayload: clientServerLimitMocks.mockResolveCurrentAccessTokenPayload,
}));

vi.mock('../../../../src/services/tokenRevocation', () => ({
  isTokenRevoked: clientServerLimitMocks.mockIsTokenRevoked,
}));

vi.mock('../../../../src/websocket/redisBridge', () => ({
  redisBridge: {
    publishBroadcast: clientServerLimitMocks.mockPublishBroadcast,
    publishControl: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => clientServerLimitMocks.mockLogger,
}));

vi.mock('../../../../src/observability/metrics', () => clientServerLimitMocks.metricMocks);

const {
  metricMocks,
  mockCheckWalletAccess,
  mockCheckWalletAccessCached,
  mockPublishBroadcast,
  mockIsTokenRevoked,
  mockLogger,
  mockResolveCurrentAccessTokenPayload,
  mockVerifyToken,
} = clientServerLimitMocks;

export {
  metricMocks,
  mockCheckWalletAccess,
  mockCheckWalletAccessCached,
  mockPublishBroadcast,
  mockIsTokenRevoked,
  mockLogger,
  mockResolveCurrentAccessTokenPayload,
  mockVerifyToken,
};

export const loadModule = async () => {
  vi.resetModules();
  return import('../../../../src/websocket/clientServer');
};

export const loadServer = async () => (await loadModule()).SanctauryWebSocketServer;

export const createClient = (overrides: Record<string, unknown> = {}) => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  const client: any = {
    userId: undefined as string | undefined,
    subscriptions: new Set<string>(),
    isAlive: true,
    messageCount: 0,
    lastMessageReset: Date.now() - 2000,
    connectionTime: Date.now() - 6000,
    totalMessageCount: 0,
    messageQueue: [] as string[],
    isProcessingQueue: false,
    droppedMessages: 0,
    subscriptionGeneration: 0,
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
  };

  client.on = vi.fn((event: string, callback: (...args: any[]) => void) => {
    const list = handlers.get(event) || [];
    list.push(callback);
    handlers.set(event, list);
    return client;
  });

  client.once = vi.fn((event: string, callback: (...args: any[]) => void) => {
    const wrapper = (...args: any[]) => {
      callback(...args);
      const list = handlers.get(event) || [];
      handlers.set(event, list.filter(fn => fn !== wrapper));
    };
    const list = handlers.get(event) || [];
    list.push(wrapper);
    handlers.set(event, list);
    return client;
  });

  client.emit = (event: string, ...args: any[]) => {
    for (const cb of handlers.get(event) || []) {
      cb(...args);
    }
  };

  return Object.assign(client, overrides);
};

export const parseLastSend = (client: { send: ReturnType<typeof vi.fn> }) => {
  const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1];
  return JSON.parse(lastCall[0]);
};

export const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
export const activeServers: Array<{ close: () => void }> = [];

export const createRequest = (overrides: Record<string, unknown> = {}) => ({
  headers: { host: 'localhost' } as Record<string, string>,
  url: '/ws',
  socket: { remoteAddress: '127.0.0.1' },
  ...overrides,
});

export const setupClientServerLimitMocks = () => {
  vi.clearAllMocks();
  process.env.MAX_WS_MESSAGES_PER_SECOND = '2';
  process.env.MAX_WS_SUBSCRIPTIONS = '10';
  process.env.MAX_WEBSOCKET_CONNECTIONS = '10000';
  process.env.MAX_WEBSOCKET_PER_USER = '10';
  process.env.WS_GRACE_PERIOD_LIMIT = '500';
  process.env.WS_MAX_QUEUE_SIZE = '100';
  process.env.WS_QUEUE_OVERFLOW_POLICY = 'drop_oldest';
  mockCheckWalletAccess.mockResolvedValue({ hasAccess: true, canEdit: true, role: 'owner' });
  mockCheckWalletAccessCached.mockResolvedValue({ hasAccess: true, canEdit: true, role: 'owner' });
  mockResolveCurrentAccessTokenPayload.mockImplementation(async (payload) => payload);
  mockVerifyToken.mockResolvedValue({
    userId: 'user-1',
    username: 'alice',
    isAdmin: false,
    sessionVersion: 0,
    jti: 'access-jti',
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  mockIsTokenRevoked.mockResolvedValue(false);
};

export const cleanupClientServerLimitMocks = () => {
  for (const server of activeServers.splice(0)) {
    server.close();
  }
  vi.useRealTimers();
};
