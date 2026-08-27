import { vi } from 'vitest';

const { sharedNodeConfigFindFirst, sharedElectrumServerUpdate } = vi.hoisted(() => ({
  sharedNodeConfigFindFirst: vi.fn().mockResolvedValue(null),
  sharedElectrumServerUpdate: vi.fn().mockResolvedValue({}),
}));
const { verifyNodeClientNetwork } = vi.hoisted(() => ({
  verifyNodeClientNetwork: vi.fn().mockResolvedValue(undefined),
}));
/**
 * ElectrumPool Unit Tests
 *
 * Tests for the multi-server Electrum connection pool functionality.
 * Tests pool scaling, load balancing, and connection management.
 */

import {
  ElectrumPool,
  ServerConfig,
  ElectrumPoolConfig,
  getElectrumPool,
  getElectrumPoolAsync,
  getElectrumPoolForNetwork,
  getPoolConfig,
  getElectrumServers,
  initializeElectrumPool,
  isPoolEnabled,
  reloadElectrumServers,
  resetElectrumPool,
  resetElectrumPoolForNetwork,
  shutdownElectrumPool,
} from '../../../../src/services/bitcoin/electrumPool';
import prisma from '../../../../src/models/prisma';
import { recordHealthCheckResult, updateServerHealthInDb, sendKeepalives } from '../../../../src/services/bitcoin/electrumPool/healthChecker';
import { reconnectConnection, cleanupIdleConnections, findIdleConnection } from '../../../../src/services/bitcoin/electrumPool/connectionManager';

// Mock the ElectrumClient as a class
vi.mock('../../../../src/services/bitcoin/electrum', () => {
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

vi.mock('../../../../src/services/bitcoin/networkIdentity', () => ({
  verifyNodeClientNetwork,
}));

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: { findFirst: sharedNodeConfigFindFirst },
    electrumServer: { update: sharedElectrumServerUpdate },
  },
}));

vi.mock('../../../../src/repositories', () => ({
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
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ElectrumPool', () => {
  let pool: ElectrumPool;

  const createTestServers = (count: number): ServerConfig[] => {
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

  const createPool = (config: Partial<ElectrumPoolConfig> = {}): ElectrumPool => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });


  describe('Auto-scaling: getEffectiveMinConnections', () => {
    it('should return configured min when no servers are set', () => {
      pool = createPool({ minConnections: 2 });
      expect(pool.getEffectiveMinConnections()).toBe(2);
    });

    it('should return server count when greater than configured min', () => {
      pool = createPool({ minConnections: 1 });
      pool.setServers(createTestServers(3));
      expect(pool.getEffectiveMinConnections()).toBe(3);
    });

    it('should return configured min when greater than server count', () => {
      pool = createPool({ minConnections: 5 });
      pool.setServers(createTestServers(2));
      expect(pool.getEffectiveMinConnections()).toBe(5);
    });

    it('should handle empty server list', () => {
      pool = createPool({ minConnections: 3 });
      pool.setServers([]);
      expect(pool.getEffectiveMinConnections()).toBe(3);
    });
  });

  describe('Auto-scaling: getEffectiveMaxConnections', () => {
    it('should return configured max when no servers are set', () => {
      pool = createPool({ maxConnections: 10 });
      expect(pool.getEffectiveMaxConnections()).toBe(10);
    });

    it('should return server count when greater than configured max', () => {
      pool = createPool({ maxConnections: 2 });
      pool.setServers(createTestServers(5));
      expect(pool.getEffectiveMaxConnections()).toBe(5);
    });

    it('should return configured max when greater than server count', () => {
      pool = createPool({ maxConnections: 10 });
      pool.setServers(createTestServers(3));
      expect(pool.getEffectiveMaxConnections()).toBe(10);
    });

    it('should handle empty server list', () => {
      pool = createPool({ maxConnections: 5 });
      pool.setServers([]);
      expect(pool.getEffectiveMaxConnections()).toBe(5);
    });
  });

  describe('setServers', () => {
    it('should filter out disabled servers', () => {
      pool = createPool();
      const servers: ServerConfig[] = [
        { id: '1', label: 'Enabled', host: 'a.com', port: 50002, useSsl: true, priority: 0, enabled: true },
        { id: '2', label: 'Disabled', host: 'b.com', port: 50002, useSsl: true, priority: 1, enabled: false },
        { id: '3', label: 'Enabled2', host: 'c.com', port: 50002, useSsl: true, priority: 2, enabled: true },
      ];
      pool.setServers(servers);
      expect(pool.getServers()).toHaveLength(2);
    });

    it('should sort servers by priority', () => {
      pool = createPool();
      const servers: ServerConfig[] = [
        { id: '1', label: 'Low', host: 'a.com', port: 50002, useSsl: true, priority: 10, enabled: true },
        { id: '2', label: 'High', host: 'b.com', port: 50002, useSsl: true, priority: 1, enabled: true },
        { id: '3', label: 'Medium', host: 'c.com', port: 50002, useSsl: true, priority: 5, enabled: true },
      ];
      pool.setServers(servers);
      const sortedServers = pool.getServers();
      expect(sortedServers[0].label).toBe('High');
      expect(sortedServers[1].label).toBe('Medium');
      expect(sortedServers[2].label).toBe('Low');
    });

    it('should initialize server stats for new servers', () => {
      pool = createPool();
      pool.setServers(createTestServers(2));
      const stats = pool.getPoolStats();
      expect(stats.servers).toHaveLength(2);
      expect(stats.servers[0].serverId).toBe('server-1');
      expect(stats.servers[1].serverId).toBe('server-2');
    });

    it('should handle replacing existing servers', () => {
      pool = createPool();
      pool.setServers(createTestServers(3));
      expect(pool.getServers()).toHaveLength(3);

      pool.setServers(createTestServers(2));
      expect(pool.getServers()).toHaveLength(2);
    });
  });

  describe('getPoolStats', () => {
    it('should return correct structure', () => {
      pool = createPool();
      pool.setServers(createTestServers(1));

      const stats = pool.getPoolStats();

      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('activeConnections');
      expect(stats).toHaveProperty('idleConnections');
      expect(stats).toHaveProperty('waitingRequests');
      expect(stats).toHaveProperty('totalAcquisitions');
      expect(stats).toHaveProperty('averageAcquisitionTimeMs');
      expect(stats).toHaveProperty('healthCheckFailures');
      expect(stats).toHaveProperty('serverCount');
      expect(stats).toHaveProperty('servers');
    });

    it('should include per-server stats', () => {
      pool = createPool();
      pool.setServers(createTestServers(2));

      const stats = pool.getPoolStats();

      expect(stats.serverCount).toBe(2);
      expect(stats.servers).toHaveLength(2);

      for (const serverStats of stats.servers) {
        expect(serverStats).toHaveProperty('serverId');
        expect(serverStats).toHaveProperty('label');
        expect(serverStats).toHaveProperty('host');
        expect(serverStats).toHaveProperty('port');
        expect(serverStats).toHaveProperty('connectionCount');
        expect(serverStats).toHaveProperty('healthyConnections');
        expect(serverStats).toHaveProperty('totalRequests');
        expect(serverStats).toHaveProperty('failedRequests');
        expect(serverStats).toHaveProperty('isHealthy');
        expect(serverStats).toHaveProperty('lastHealthCheck');
      }
    });

    it('should show zero connections before initialization', () => {
      pool = createPool();
      const stats = pool.getPoolStats();
      expect(stats.totalConnections).toBe(0);
      expect(stats.activeConnections).toBe(0);
      expect(stats.idleConnections).toBe(0);
    });

    it('uses fallback server stats defaults when server metadata is missing', () => {
      pool = createPool();
      pool.setServers([
        { id: 'server-1', label: 'Server 1', host: 'one.example.com', port: 50002, useSsl: true, priority: 0, enabled: true },
      ]);

      (pool as any).serverStats.delete('server-1');
      (pool as any).connections.set('conn-closed', {
        id: 'conn-closed',
        client: { isConnected: vi.fn().mockReturnValue(true) },
        state: 'closed',
        createdAt: new Date(),
        lastUsedAt: new Date(),
        lastHealthCheck: new Date(),
        useCount: 0,
        isDedicated: false,
        serverId: 'server-1',
        serverLabel: 'Server 1',
        serverHost: 'one.example.com',
        serverPort: 50002,
      });
      (pool as any).connections.set('conn-disconnected', {
        id: 'conn-disconnected',
        client: { isConnected: vi.fn().mockReturnValue(false) },
        state: 'idle',
        createdAt: new Date(),
        lastUsedAt: new Date(),
        lastHealthCheck: new Date(),
        useCount: 0,
        isDedicated: false,
        serverId: 'server-1',
        serverLabel: 'Server 1',
        serverHost: 'one.example.com',
        serverPort: 50002,
      });

      const stats = pool.getPoolStats();
      expect(stats.servers[0]).toMatchObject({
        healthyConnections: 0,
        isHealthy: true,
        cooldownUntil: null,
        weight: 1,
      });
      expect(stats.servers[0].healthHistory).toEqual([]);
    });
  });

  describe('isPoolInitialized', () => {
    it('should return false before initialization', () => {
      pool = createPool();
      expect(pool.isPoolInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      pool = createPool();
      await pool.initialize();
      expect(pool.isPoolInitialized()).toBe(true);
    });

    it('should return false after shutdown', async () => {
      pool = createPool();
      await pool.initialize();
      await pool.shutdown();
      expect(pool.isPoolInitialized()).toBe(false);
    });
  });

  describe('isHealthy', () => {
    it('should return false when not initialized', () => {
      pool = createPool();
      expect(pool.isHealthy()).toBe(false);
    });

    it('should return true when pool has connections', async () => {
      pool = createPool({ minConnections: 1 });
      await pool.initialize();
      expect(pool.isHealthy()).toBe(true);
    });

    it('should return false when initialized and at capacity with no idle connections', () => {
      pool = createPool({ minConnections: 1, maxConnections: 1 });
      (pool as any).isInitialized = true;
      (pool as any).connections.set('active-capacity', {
        id: 'active-capacity',
        client: { isConnected: vi.fn().mockReturnValue(true) },
        state: 'active',
        createdAt: new Date(),
        lastUsedAt: new Date(),
        lastHealthCheck: new Date(),
        useCount: 0,
        isDedicated: false,
        serverId: 'server-1',
        serverLabel: 'Server 1',
        serverHost: 'one.example.com',
        serverPort: 50002,
      });
      vi.spyOn(pool as any, 'getEffectiveMaxConnections').mockReturnValue(1);

      expect(pool.isHealthy()).toBe(false);
    });
  });

  describe('Single-Connection Mode (pool disabled)', () => {
    it('should indicate pool mode is disabled', () => {
      pool = createPool({ enabled: false });
      // The pool should still function but in single-connection mode
      expect(pool.getEffectiveMinConnections()).toBe(1);
      expect(pool.getEffectiveMaxConnections()).toBe(5);
    });

    it('should work with acquire in single mode', async () => {
      pool = createPool({ enabled: false });
      await pool.initialize();

      const handle = await pool.acquire();
      expect(handle).toBeDefined();
      expect(handle.client).toBeDefined();
      handle.release();
    });
  });

  describe('Pool Mode', () => {
    it('should initialize successfully', async () => {
      pool = createPool({ minConnections: 2, maxConnections: 5 });
      await pool.initialize();
      expect(pool.isPoolInitialized()).toBe(true);
    });

    it('should acquire and release connections', async () => {
      pool = createPool({ minConnections: 2, maxConnections: 5 });
      await pool.initialize();

      const handle = await pool.acquire();
      expect(handle).toBeDefined();
      expect(handle.client).toBeDefined();
      expect(typeof handle.release).toBe('function');

      handle.release();
    });

    it('should track active connections', async () => {
      pool = createPool({ minConnections: 2, maxConnections: 5 });
      await pool.initialize();

      const statsBefore = pool.getPoolStats();
      const initialActive = statsBefore.activeConnections;

      const handle = await pool.acquire();
      const statsAfter = pool.getPoolStats();
      expect(statsAfter.activeConnections).toBe(initialActive + 1);

      handle.release();
    });

    it('should return connections to idle on release', async () => {
      pool = createPool({ minConnections: 2, maxConnections: 5 });
      await pool.initialize();

      const handle = await pool.acquire();
      handle.release();

      const stats = pool.getPoolStats();
      expect(stats.activeConnections).toBe(0);
    });
  });

  describe('withClient helper', () => {
    it('should execute callback and auto-release', async () => {
      pool = createPool();
      await pool.initialize();

      const handle = await pool.acquire();
      const result = await handle.withClient(async (client) => {
        return client.getBlockHeight();
      });

      expect(result).toBe(800000);
    });

    it('should release connection even on error', async () => {
      pool = createPool();
      await pool.initialize();

      const handle = await pool.acquire();

      await expect(
        handle.withClient(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });

  describe('getSubscriptionConnection', () => {
    it('should return a subscription connection', async () => {
      pool = createPool();
      await pool.initialize();

      const subClient = await pool.getSubscriptionConnection();
      expect(subClient).toBeDefined();
      expect(subClient.isConnected()).toBe(true);
    });

    it('should return same connection on multiple calls', async () => {
      pool = createPool();
      await pool.initialize();

      const subClient1 = await pool.getSubscriptionConnection();
      const subClient2 = await pool.getSubscriptionConnection();
      expect(subClient1).toBe(subClient2);
    });
  });

  describe('shutdown', () => {
    it('should close all connections', async () => {
      pool = createPool({ minConnections: 3 });
      await pool.initialize();

      await pool.shutdown();

      const stats = pool.getPoolStats();
      expect(stats.totalConnections).toBe(0);
    });

    it('should mark pool as not initialized', async () => {
      pool = createPool();
      await pool.initialize();
      expect(pool.isPoolInitialized()).toBe(true);

      await pool.shutdown();
      expect(pool.isPoolInitialized()).toBe(false);
    });

    it('should be safe to call multiple times', async () => {
      pool = createPool();
      await pool.initialize();

      await pool.shutdown();
      await pool.shutdown(); // Should not throw
      expect(pool.isPoolInitialized()).toBe(false);
    });
  });

  describe('Load Balancing Strategies', () => {
    const servers = [
      { id: '1', label: 'Primary', host: 'primary.com', port: 50002, useSsl: true, priority: 0, enabled: true },
      { id: '2', label: 'Secondary', host: 'secondary.com', port: 50002, useSsl: true, priority: 1, enabled: true },
      { id: '3', label: 'Tertiary', host: 'tertiary.com', port: 50002, useSsl: true, priority: 2, enabled: true },
    ];

    it('should accept round_robin strategy', () => {
      pool = createPool({ loadBalancing: 'round_robin' });
      pool.setServers(servers);
      expect(pool.getServers()).toHaveLength(3);
    });

    it('should accept least_connections strategy', () => {
      pool = createPool({ loadBalancing: 'least_connections' });
      pool.setServers(servers);
      expect(pool.getServers()).toHaveLength(3);
    });

    it('should accept failover_only strategy', () => {
      pool = createPool({ loadBalancing: 'failover_only' });
      pool.setServers(servers);
      expect(pool.getServers()).toHaveLength(3);
    });
  });

});
