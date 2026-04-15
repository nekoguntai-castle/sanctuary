import { beforeAll, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';

import { errorHandler } from '../../../../src/errors/errorHandler';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

const nodeConfigRouteMocks = vi.hoisted(() => ({
  mockTestNodeConfig: vi.fn(),
  mockResetNodeClient: vi.fn(),
  mockEncrypt: vi.fn((value: string) => `enc:${value}`),
  mockAuditLogFromRequest: vi.fn(),
  mockSocksCreateConnection: vi.fn(),
  mockHttpsGet: vi.fn(),
  mockSocksProxyAgentConstruct: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
}));

export const mockTestNodeConfig = nodeConfigRouteMocks.mockTestNodeConfig;
export const mockResetNodeClient = nodeConfigRouteMocks.mockResetNodeClient;
export const mockEncrypt = nodeConfigRouteMocks.mockEncrypt;
export const mockAuditLogFromRequest = nodeConfigRouteMocks.mockAuditLogFromRequest;
export const mockSocksCreateConnection = nodeConfigRouteMocks.mockSocksCreateConnection;
export const mockHttpsGet = nodeConfigRouteMocks.mockHttpsGet;
export const mockSocksProxyAgentConstruct = nodeConfigRouteMocks.mockSocksProxyAgentConstruct;
export const mockLogInfo = nodeConfigRouteMocks.mockLogInfo;
export const mockLogWarn = nodeConfigRouteMocks.mockLogWarn;
export const mockLogError = nodeConfigRouteMocks.mockLogError;

vi.mock('../../../../src/repositories', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');

  return {
    nodeConfigRepository: {
      findDefault: () => prisma.nodeConfig.findFirst({ where: { isDefault: true } }),
      findDefaultWithServers: () => prisma.nodeConfig.findFirst({
        where: { isDefault: true },
        include: { servers: { orderBy: { priority: 'asc' } } },
      }),
      findOrCreateDefault: (data: unknown) => prisma.nodeConfig.create({ data }),
      update: (id: string, data: unknown) => prisma.nodeConfig.update({ where: { id }, data }),
      electrumServer: {
        updateHealth: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

vi.mock('../../../../src/middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  testNodeConfig: nodeConfigRouteMocks.mockTestNodeConfig,
  resetNodeClient: nodeConfigRouteMocks.mockResetNodeClient,
}));

vi.mock('../../../../src/utils/encryption', () => ({
  encrypt: nodeConfigRouteMocks.mockEncrypt,
}));

vi.mock('../../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: nodeConfigRouteMocks.mockAuditLogFromRequest,
  },
  AuditAction: {
    NODE_CONFIG_UPDATE: 'NODE_CONFIG_UPDATE',
  },
  AuditCategory: {
    ADMIN: 'ADMIN',
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: nodeConfigRouteMocks.mockLogInfo,
    warn: nodeConfigRouteMocks.mockLogWarn,
    error: nodeConfigRouteMocks.mockLogError,
  }),
}));

vi.mock('socks', () => ({
  SocksClient: {
    createConnection: nodeConfigRouteMocks.mockSocksCreateConnection,
  },
}));

vi.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: class MockSocksProxyAgent {
    constructor(proxyUrl: string) {
      nodeConfigRouteMocks.mockSocksProxyAgentConstruct(proxyUrl);
    }
  },
  default: {
    SocksProxyAgent: class MockDefaultSocksProxyAgent {
      constructor(proxyUrl: string) {
        nodeConfigRouteMocks.mockSocksProxyAgentConstruct(proxyUrl);
      }
    },
  },
}));

vi.mock('node:https', () => ({
  default: {
    get: (...args: any[]) => nodeConfigRouteMocks.mockHttpsGet(...args),
  },
}));

export { mockPrismaClient };

export type NodeConfigRecord = {
  id: string;
  type: string;
  host: string;
  port: number;
  useSsl: boolean;
  allowSelfSignedCert: boolean;
  explorerUrl: string;
  feeEstimatorUrl: string | null;
  mempoolEstimator: string;
  poolEnabled: boolean;
  poolMinConnections: number;
  poolMaxConnections: number;
  poolLoadBalancing: string;
  servers: Array<{ id: string; host: string; port: number; priority: number }>;
  mainnetMode: string;
  mainnetSingletonHost: string | null;
  mainnetSingletonPort: number | null;
  mainnetSingletonSsl: boolean | null;
  mainnetPoolMin: number | null;
  mainnetPoolMax: number | null;
  mainnetPoolLoadBalancing: string | null;
  testnetEnabled: boolean;
  testnetMode: string | null;
  testnetSingletonHost: string | null;
  testnetSingletonPort: number | null;
  testnetSingletonSsl: boolean | null;
  testnetPoolMin: number | null;
  testnetPoolMax: number | null;
  testnetPoolLoadBalancing: string | null;
  signetEnabled: boolean;
  signetMode: string | null;
  signetSingletonHost: string | null;
  signetSingletonPort: number | null;
  signetSingletonSsl: boolean | null;
  signetPoolMin: number | null;
  signetPoolMax: number | null;
  signetPoolLoadBalancing: string | null;
  proxyEnabled: boolean;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
  isDefault: boolean;
};

export function buildNodeConfig(overrides: Partial<NodeConfigRecord> = {}): NodeConfigRecord {
  return {
    id: 'default',
    type: 'electrum',
    host: 'electrum.example.com',
    port: 50002,
    useSsl: true,
    allowSelfSignedCert: false,
    explorerUrl: 'https://mempool.space',
    feeEstimatorUrl: 'https://mempool.space',
    mempoolEstimator: 'simple',
    poolEnabled: true,
    poolMinConnections: 1,
    poolMaxConnections: 5,
    poolLoadBalancing: 'round_robin',
    servers: [],
    mainnetMode: 'pool',
    mainnetSingletonHost: 'electrum.blockstream.info',
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: 'round_robin',
    testnetEnabled: false,
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
    proxyEnabled: false,
    proxyHost: null,
    proxyPort: null,
    proxyUsername: null,
    proxyPassword: null,
    isDefault: true,
    ...overrides,
  };
}

export function httpsGetMock(statusCode: number, body: string) {
  return (_url: string, _options: unknown, callback: Function) => {
    const handlers: Record<string, Function> = {};
    const res = {
      statusCode,
      on(event: string, handler: Function) {
        handlers[event] = handler;
        return this;
      },
    };

    callback(res);
    process.nextTick(() => {
      handlers.data?.(body);
      handlers.end?.();
    });

    return { on: vi.fn() };
  };
}

let app: Express;

export function setupAdminNodeConfigRouteTests(): void {
  beforeAll(async () => {
    const { default: nodeConfigRouter } = await import('../../../../src/api/admin/nodeConfig');

    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', nodeConfigRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockResetNodeClient.mockResolvedValue(undefined);
    mockTestNodeConfig.mockResolvedValue({
      success: true,
      message: 'Connection successful',
      info: { blockHeight: 850000 },
    });
    mockSocksCreateConnection.mockResolvedValue({
      socket: { destroy: vi.fn() },
    });
    mockHttpsGet.mockImplementation(
      httpsGetMock(200, JSON.stringify({ IsTor: true, IP: '1.2.3.4' }))
    );
  });
}

export function getAdminNodeConfigApp(): Express {
  if (!app) {
    throw new Error('Admin node config test app was not initialized');
  }

  return app;
}
