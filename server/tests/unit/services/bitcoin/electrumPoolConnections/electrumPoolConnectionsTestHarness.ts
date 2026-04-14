import { afterEach, beforeEach, vi } from 'vitest';
/**
 * ElectrumPool Unit Tests
 *
 * Tests for the multi-server Electrum connection pool functionality.
 * Tests pool scaling, load balancing, and connection management.
 */

import {
  ElectrumPool,
  type ElectrumPoolConfig,
  type ServerConfig,
} from '../../../../../src/services/bitcoin/electrumPool';

const electrumPoolConnectionMocks = vi.hoisted(() => ({
  sharedNodeConfigFindFirst: vi.fn().mockResolvedValue(null),
  sharedElectrumServerUpdate: vi.fn().mockResolvedValue({}),
}));
const { sharedNodeConfigFindFirst, sharedElectrumServerUpdate } = electrumPoolConnectionMocks;

export { sharedNodeConfigFindFirst, sharedElectrumServerUpdate };

// Mock the ElectrumClient as a class
vi.mock('../../../../../src/services/bitcoin/electrum', () => {
  // Create a mock class that can be instantiated with 'new'
  const MockElectrumClient = vi.fn().mockImplementation(function(this: any) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.disconnect = vi.fn();
    this.isConnected = vi.fn().mockReturnValue(true);
    this.getServerVersion = vi.fn().mockResolvedValue({ server: 'test', protocol: '1.4' });
    this.getBlockHeight = vi.fn().mockResolvedValue(800000);
    this.on = vi.fn();
    this.off = vi.fn();
  });
  return { ElectrumClient: MockElectrumClient };
});

// Mock Prisma
vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: { findFirst: sharedNodeConfigFindFirst },
    electrumServer: { update: sharedElectrumServerUpdate },
  },
}));

vi.mock('../../../../../src/repositories', () => ({
  nodeConfigRepository: {
    findDefault: (...args: unknown[]) => sharedNodeConfigFindFirst(...args),
    findDefaultWithServers: (...args: unknown[]) => sharedNodeConfigFindFirst(...args),
    findOrCreateDefault: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    electrumServer: {
      updateHealth: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// Mock logger
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

export interface ElectrumPoolTestContext {
  pool?: ElectrumPool;
}

export const createTestServers = (count: number): ServerConfig[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `server-${i + 1}`,
    label: `Server ${i + 1}`,
    host: `server${i + 1}.example.com`,
    port: 50002,
    useSsl: true,
    priority: i,
    enabled: true,
  }));
};

export const createPool = (config: Partial<ElectrumPoolConfig> = {}): ElectrumPool => {
  return new ElectrumPool({
    enabled: true,
    minConnections: 1,
    maxConnections: 5,
    loadBalancing: 'round_robin',
    healthCheckIntervalMs: 30000,
    idleTimeoutMs: 300000,
    acquisitionTimeoutMs: 5000,
    maxWaitingRequests: 100,
    connectionTimeoutMs: 10000,
    maxReconnectAttempts: 3,
    reconnectDelayMs: 1000,
    ...config,
  });
};

export const makeConn = (overrides: Record<string, any> = {}) => ({
  id: `conn-${Math.random()}`,
  client: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    getServerVersion: vi.fn().mockResolvedValue({ server: 'test', protocol: '1.4' }),
    getBlockHeight: vi.fn().mockResolvedValue(100),
    ping: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
  },
  state: 'idle',
  createdAt: new Date(),
  lastUsedAt: new Date(),
  lastHealthCheck: new Date(),
  useCount: 0,
  isDedicated: false,
  serverId: 'server-1',
  serverLabel: 'S1',
  serverHost: 'a',
  serverPort: 50001,
  ...overrides,
});

export function setupElectrumPoolConnectionTestHooks(context: ElectrumPoolTestContext): void {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (context.pool) {
      await context.pool.shutdown();
      context.pool = undefined;
    }
  });
}
