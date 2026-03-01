import { vi } from 'vitest';
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
import { db as prismaDb } from '../../../../src/repositories/db';
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

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    electrumServer: { update: vi.fn().mockResolvedValue({}) },
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

  describe('Server Backoff System', () => {
    const servers = [
      { id: 'server-1', label: 'Primary', host: 'primary.com', port: 50002, useSsl: true, priority: 0, enabled: true },
      { id: 'server-2', label: 'Secondary', host: 'secondary.com', port: 50002, useSsl: true, priority: 1, enabled: true },
    ];

    describe('recordServerFailure', () => {
      it('should track consecutive failures', () => {
        pool = createPool();
        pool.setServers(servers);

        pool.recordServerFailure('server-1', 'error');
        const state1 = pool.getServerBackoffState('server-1');
        expect(state1).not.toBeNull();
        expect(state1!.consecutiveFailures).toBe(1);
        expect(state1!.level).toBe(0); // Not in backoff yet (threshold is 2)

        pool.recordServerFailure('server-1', 'error');
        const state2 = pool.getServerBackoffState('server-1');
        expect(state2).not.toBeNull();
        expect(state2!.consecutiveFailures).toBe(2);
        expect(state2!.level).toBe(1); // Now in backoff
      });

      it('should increase backoff level on continued failures', () => {
        pool = createPool();
        pool.setServers(servers);

        // Trigger backoff (2 failures)
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const state1 = pool.getServerBackoffState('server-1');
        expect(state1).not.toBeNull();
        expect(state1!.level).toBe(1);

        // Third failure increases level
        pool.recordServerFailure('server-1', 'error');
        const state2 = pool.getServerBackoffState('server-1');
        expect(state2).not.toBeNull();
        expect(state2!.level).toBe(2);
      });

      it('should reduce weight on failures', () => {
        pool = createPool();
        pool.setServers(servers);

        const initialState = pool.getServerBackoffState('server-1');
        expect(initialState).not.toBeNull();
        expect(initialState!.weight).toBe(1.0);

        // Trigger backoff
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        expect(state!.weight).toBeLessThan(1.0);
        expect(state!.weight).toBeGreaterThanOrEqual(0.1); // minWeight
      });

      it('should apply extra penalty for timeout errors', () => {
        pool = createPool();
        pool.setServers(servers);

        // Regular error
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        const errorState = pool.getServerBackoffState('server-1');
        expect(errorState).not.toBeNull();

        // Reset and test timeout
        pool.resetServerBackoff('server-1');
        pool.recordServerFailure('server-1', 'timeout');
        pool.recordServerFailure('server-1', 'timeout');
        const timeoutState = pool.getServerBackoffState('server-1');
        expect(timeoutState).not.toBeNull();

        // Timeout should result in lower weight (higher penalty)
        expect(timeoutState!.weight).toBeLessThanOrEqual(errorState!.weight);
      });

      it('should set cooldown period when backoff is triggered', () => {
        pool = createPool();
        pool.setServers(servers);

        // Before backoff - no cooldown
        expect(pool.isServerInCooldown('server-1')).toBe(false);

        // Trigger backoff
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        expect(state!.inCooldown).toBe(true);
        expect(pool.isServerInCooldown('server-1')).toBe(true);
      });

      it('should never reduce weight below minimum', () => {
        pool = createPool();
        pool.setServers(servers);

        // Many failures
        for (let i = 0; i < 20; i++) {
          pool.recordServerFailure('server-1', 'timeout');
        }

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        expect(state!.weight).toBeGreaterThanOrEqual(0.1); // minWeight
      });

      it('handles failure backoff for stats entries that do not map to configured servers', () => {
        pool = createPool();
        pool.setServers(servers);
        const baseStats = (pool as any).serverStats.get('server-1');
        (pool as any).serverStats.set('ghost-failure', {
          ...baseStats,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          backoffLevel: 0,
          cooldownUntil: null,
          weight: 1.0,
        });

        pool.recordServerFailure('ghost-failure', 'error');
        pool.recordServerFailure('ghost-failure', 'error');

        const state = pool.getServerBackoffState('ghost-failure');
        expect(state).not.toBeNull();
        expect(state!.level).toBeGreaterThan(0);
      });
    });

    describe('recordServerSuccess', () => {
      it('should reset consecutive failures after recovery threshold', () => {
        pool = createPool();
        pool.setServers(servers);

        // Trigger backoff first (need 2 failures for backoff)
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        const inBackoff = pool.getServerBackoffState('server-1');
        expect(inBackoff).not.toBeNull();
        expect(inBackoff!.consecutiveFailures).toBe(2);
        expect(inBackoff!.level).toBe(1);

        // Recovery threshold is 3 successes to reduce backoff level
        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1');

        const afterRecovery = pool.getServerBackoffState('server-1');
        expect(afterRecovery).not.toBeNull();
        expect(afterRecovery!.consecutiveFailures).toBe(0);
        expect(afterRecovery!.level).toBe(0);
      });

      it('should gradually recover weight after successes', () => {
        pool = createPool();
        pool.setServers(servers);

        // Trigger backoff (reduce weight)
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const afterFailure = pool.getServerBackoffState('server-1');
        expect(afterFailure).not.toBeNull();
        expect(afterFailure!.weight).toBeLessThan(1.0);
        expect(afterFailure!.level).toBeGreaterThan(0);

        // Success should start recovery
        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1'); // Recovery threshold is 3

        const afterRecovery = pool.getServerBackoffState('server-1');
        expect(afterRecovery).not.toBeNull();
        expect(afterRecovery!.level).toBeLessThan(afterFailure!.level);
        expect(afterRecovery!.weight).toBeGreaterThan(afterFailure!.weight);
      });

      it('should clear cooldown after recovery threshold successes', () => {
        pool = createPool();
        pool.setServers(servers);

        // Trigger backoff with cooldown
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        expect(pool.isServerInCooldown('server-1')).toBe(true);

        // Recover with successes (recovery threshold is 3)
        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1');

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        // Cooldown should be cleared after recovery
        expect(state!.level).toBe(0);
      });

      it('handles recovery threshold when no backoff level is active', () => {
        pool = createPool();
        pool.setServers(servers);

        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1');
        pool.recordServerSuccess('server-1');

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        expect(state!.level).toBe(0);
        expect(state!.weight).toBe(1.0);
      });

      it('handles both full and partial recovery for stats-only server entries', () => {
        pool = createPool();
        pool.setServers(servers);
        const baseStats = (pool as any).serverStats.get('server-1');

        (pool as any).serverStats.set('ghost-full-recovery', {
          ...baseStats,
          consecutiveFailures: 2,
          consecutiveSuccesses: 2,
          backoffLevel: 1,
          cooldownUntil: new Date(Date.now() + 1000),
          weight: 0.7,
        });
        (pool as any).serverStats.set('ghost-partial-recovery', {
          ...baseStats,
          consecutiveFailures: 3,
          consecutiveSuccesses: 2,
          backoffLevel: 2,
          cooldownUntil: new Date(Date.now() + 1000),
          weight: 0.6,
        });

        pool.recordServerSuccess('ghost-full-recovery');
        pool.recordServerSuccess('ghost-partial-recovery');

        const full = pool.getServerBackoffState('ghost-full-recovery');
        const partial = pool.getServerBackoffState('ghost-partial-recovery');
        expect(full).not.toBeNull();
        expect(partial).not.toBeNull();
        expect(full!.level).toBe(0);
        expect(partial!.level).toBe(1);
      });
    });

    describe('isServerInCooldown', () => {
      it('should return false for healthy server', () => {
        pool = createPool();
        pool.setServers(servers);

        expect(pool.isServerInCooldown('server-1')).toBe(false);
      });

      it('should return true when server is in backoff cooldown', () => {
        pool = createPool();
        pool.setServers(servers);

        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        expect(pool.isServerInCooldown('server-1')).toBe(true);
      });

      it('should return false for unknown server', () => {
        pool = createPool();
        pool.setServers(servers);

        expect(pool.isServerInCooldown('unknown-server')).toBe(false);
      });
    });

    describe('getServerBackoffState', () => {
      it('should return default state for healthy server', () => {
        pool = createPool();
        pool.setServers(servers);

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        expect(state).toEqual({
          level: 0,
          weight: 1.0,
          inCooldown: false,
          cooldownRemaining: 0,
          consecutiveFailures: 0,
        });
      });

      it('should return actual state after failures', () => {
        pool = createPool();
        pool.setServers(servers);

        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        expect(state!.consecutiveFailures).toBe(2);
        expect(state!.level).toBe(1);
        expect(state!.inCooldown).toBe(true);
        expect(state!.weight).toBeLessThan(1.0);
      });

      it('should return null for unknown server', () => {
        pool = createPool();
        pool.setServers(servers);

        const state = pool.getServerBackoffState('unknown-server');
        expect(state).toBeNull();
      });
    });

    describe('resetServerBackoff', () => {
      it('should reset all backoff state', () => {
        pool = createPool();
        pool.setServers(servers);

        // Build up backoff state
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const beforeReset = pool.getServerBackoffState('server-1');
        expect(beforeReset).not.toBeNull();
        expect(beforeReset!.level).toBeGreaterThan(0);
        expect(beforeReset!.weight).toBeLessThan(1.0);

        pool.resetServerBackoff('server-1');

        const afterReset = pool.getServerBackoffState('server-1');
        expect(afterReset).not.toBeNull();
        expect(afterReset).toEqual({
          level: 0,
          weight: 1.0,
          inCooldown: false,
          cooldownRemaining: 0,
          consecutiveFailures: 0,
        });
      });

      it('should not throw for unknown server', () => {
        pool = createPool();
        pool.setServers(servers);

        expect(() => pool.resetServerBackoff('unknown-server')).not.toThrow();
      });

      it('resets stats-only server entries without matching configured servers', () => {
        pool = createPool();
        pool.setServers(servers);
        const baseStats = (pool as any).serverStats.get('server-1');
        (pool as any).serverStats.set('ghost-reset', {
          ...baseStats,
          consecutiveFailures: 5,
          backoffLevel: 3,
          cooldownUntil: new Date(Date.now() + 1000),
          weight: 0.2,
          isHealthy: false,
        });

        pool.resetServerBackoff('ghost-reset');

        const state = pool.getServerBackoffState('ghost-reset');
        expect(state).not.toBeNull();
        expect(state!.level).toBe(0);
        expect(state!.weight).toBe(1.0);
      });
    });

    describe('getPoolStats with backoff info', () => {
      it('should include backoff state in server stats', () => {
        pool = createPool();
        pool.setServers(servers);

        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const stats = pool.getPoolStats();
        const server1Stats = stats.servers.find(s => s.serverId === 'server-1');

        expect(server1Stats).toBeDefined();
        expect(server1Stats!.consecutiveFailures).toBe(2);
        expect(server1Stats!.backoffLevel).toBe(1);
        expect(server1Stats!.cooldownUntil).not.toBeNull();
        expect(server1Stats!.weight).toBeLessThan(1.0);
      });

      it('should include health history in server stats', () => {
        pool = createPool();
        pool.setServers(servers);

        const stats = pool.getPoolStats();
        const server1Stats = stats.servers.find(s => s.serverId === 'server-1');

        expect(server1Stats).toBeDefined();
        expect(server1Stats!.healthHistory).toBeDefined();
        expect(Array.isArray(server1Stats!.healthHistory)).toBe(true);
      });
    });

    describe('Backoff integration with server selection', () => {
      it('should not return servers in cooldown when selecting', async () => {
        pool = createPool();
        pool.setServers(servers);
        await pool.initialize();

        // Put server-1 in cooldown
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        expect(pool.isServerInCooldown('server-1')).toBe(true);
        expect(pool.isServerInCooldown('server-2')).toBe(false);

        // Server selection should prefer server-2
        // This is tested implicitly - the pool should continue to function
        const handle = await pool.acquire();
        expect(handle).toBeDefined();
        handle.release();
      });
    });
  });

  describe('internal connection and queue branches', () => {
    const makeConn = (overrides: Record<string, any> = {}) => ({
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

    it('initialize returns early when already initialized or already initializing', async () => {
      pool = createPool();
      const doInitSpy = vi.spyOn(pool as any, 'doInitialize').mockResolvedValue(undefined);

      (pool as any).isInitialized = true;
      await pool.initialize();
      expect(doInitSpy).not.toHaveBeenCalled();

      (pool as any).isInitialized = false;
      (pool as any).initializePromise = Promise.resolve();
      await pool.initialize();
      expect(doInitSpy).not.toHaveBeenCalled();
    });

    it('emits circuit state change when repeated acquisition failures open the breaker', async () => {
      pool = createPool();
      const stateChangeListener = vi.fn();
      pool.on('circuitStateChange', stateChangeListener);
      (pool as any).isShuttingDown = true;

      for (let i = 0; i < 5; i++) {
        await expect(pool.acquire()).rejects.toThrow('Pool is shutting down');
      }

      expect(stateChangeListener).toHaveBeenCalledWith({
        newState: 'open',
        oldState: 'closed',
      });
    });

    it('disconnectServerConnections is a no-op for unknown server ids', () => {
      pool = createPool();
      expect(() => pool.disconnectServerConnections('missing-server')).not.toThrow();
    });

    it('disconnectServerConnections removes matching connections and clears subscription id', () => {
      pool = createPool();
      const connA = {
        id: 'conn-a',
        client: { disconnect: vi.fn(), isConnected: vi.fn().mockReturnValue(true) },
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
      };
      const connB = {
        ...connA,
        id: 'conn-b',
        serverId: 'server-2',
        client: { disconnect: vi.fn(), isConnected: vi.fn().mockReturnValue(true) },
      };

      (pool as any).connections.set('conn-a', connA);
      (pool as any).connections.set('conn-b', connB);
      (pool as any).subscriptionConnectionId.value = 'conn-a';

      pool.disconnectServerConnections('server-1');

      expect((pool as any).connections.has('conn-a')).toBe(false);
      expect((pool as any).connections.has('conn-b')).toBe(true);
      expect(connA.client.disconnect).toHaveBeenCalledTimes(1);
      expect((pool as any).subscriptionConnectionId.value).toBeNull();
    });

    it('disconnectServerConnections tolerates per-connection disconnect errors', () => {
      pool = createPool();
      const badConn = {
        id: 'conn-err',
        client: {
          disconnect: vi.fn(() => {
            throw new Error('disconnect failed');
          }),
          isConnected: vi.fn().mockReturnValue(true),
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
      };
      (pool as any).connections.set(badConn.id, badConn);

      expect(() => pool.disconnectServerConnections('server-1')).not.toThrow();
      expect((pool as any).connections.has(badConn.id)).toBe(true);
    });

    it('updates proxy/network helpers and exposes circuit health', () => {
      pool = createPool();
      pool.setNetwork('testnet');
      expect(pool.getNetwork()).toBe('testnet');

      pool.setProxyConfig({ enabled: true, host: '127.0.0.1', port: 9050 });
      expect(pool.isProxyEnabled()).toBe(true);
      expect(pool.getProxyConfig()).toEqual({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      });

      pool.setProxyConfig(null);
      expect(pool.isProxyEnabled()).toBe(false);
      expect(pool.getProxyConfig()).toBeNull();
      expect(pool.getCircuitHealth()).toHaveProperty('state');
    });

    it('reloadServers applies db config and calls ensureMinimumConnections when initialized', async () => {
      pool = createPool();
      (pool as any).isInitialized = true;
      const ensureSpy = vi.spyOn(pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);

      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolLoadBalancing: 'least_connections',
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: 'u',
        proxyPassword: 'p',
        servers: [
          {
            id: 's1',
            label: 'Server One',
            host: 'one.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
            supportsVerbose: true,
          },
        ],
      });

      await pool.reloadServers();

      expect(pool.getServers()).toHaveLength(1);
      expect((pool as any).config.loadBalancing).toBe('least_connections');
      expect(pool.isProxyEnabled()).toBe(true);
      expect(ensureSpy).toHaveBeenCalledTimes(1);
    });

    it('reloadServers clears proxy when proxy settings are incomplete', async () => {
      pool = createPool();
      pool.setProxyConfig({ enabled: true, host: '127.0.0.1', port: 9050 });

      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolLoadBalancing: 'round_robin',
        proxyEnabled: true,
        proxyHost: null,
        proxyPort: null,
        servers: [],
      });

      await pool.reloadServers();
      expect(pool.isProxyEnabled()).toBe(false);
      expect(pool.getProxyConfig()).toBeNull();
    });

    it('reloadServers keeps existing state when db returns no config', async () => {
      pool = createPool({ loadBalancing: 'failover_only' });
      pool.setServers([
        { id: 'keep-1', label: 'Keep', host: 'keep.example.com', port: 50002, useSsl: true, priority: 0, enabled: true },
      ]);
      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce(null);

      await pool.reloadServers();

      expect(pool.getServers()).toHaveLength(1);
      expect((pool as any).config.loadBalancing).toBe('failover_only');
    });

    it('reloadServers handles proxy credentials omitted in database config', async () => {
      pool = createPool({ loadBalancing: 'round_robin' });
      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: null,
        proxyPassword: null,
        servers: [
          {
            id: 's-proxy',
            label: 'Proxy Server',
            host: 'proxy.example.com',
            port: 50001,
            useSsl: false,
            priority: 0,
            enabled: true,
            supportsVerbose: false,
          },
        ],
      });

      await pool.reloadServers();
      const proxy = pool.getProxyConfig();
      expect(proxy).toMatchObject({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      });
      expect(proxy?.username).toBeUndefined();
      expect(proxy?.password).toBeUndefined();
      expect((pool as any).config.loadBalancing).toBe('round_robin');
    });

    it('updateServerHealthInDb swallows database update failures', async () => {
      pool = createPool();
      (prismaDb as any).electrumServer.update.mockRejectedValueOnce(new Error('db write failed'));

      await expect(
        updateServerHealthInDb('server-1', false, 3, 'health failed')
      ).resolves.toBeUndefined();
    });

    it('updateServerHealthInDb omits fail-count field when not provided', async () => {
      pool = createPool();

      await expect(
        updateServerHealthInDb('server-1', true, undefined, 'ignored')
      ).resolves.toBeUndefined();

      expect((prismaDb as any).electrumServer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ healthCheckFails: expect.anything() }),
        })
      );
    });

    it('doInitialize exits immediately when pool becomes initialized before execution', async () => {
      pool = createPool();
      (pool as any).isInitialized = true;
      const createSpy = vi.spyOn(pool as any, 'createConnection');

      await (pool as any).doInitialize();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('single-mode initialize executes health-check interval callback', async () => {
      vi.useFakeTimers();
      pool = createPool({
        enabled: false,
        healthCheckIntervalMs: 10,
      });
      const healthSpy = vi.spyOn(pool as any, 'performHealthChecks').mockResolvedValue(undefined);

      await pool.initialize();
      await vi.advanceTimersByTimeAsync(20);
      expect(healthSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('pool-mode initialize tolerates failed initial connection and runs interval callbacks', async () => {
      vi.useFakeTimers();
      pool = createPool({
        enabled: true,
        minConnections: 1,
        maxConnections: 1,
        healthCheckIntervalMs: 10,
        idleTimeoutMs: 20,
        keepaliveIntervalMs: 10,
      });

      const healthSpy = vi.spyOn(pool as any, 'performHealthChecks').mockResolvedValue(undefined);
      const idleSpy = vi.spyOn(pool as any, 'cleanupIdleConnections').mockImplementation(() => undefined);
      const keepaliveSpy = vi.spyOn(pool as any, 'sendKeepalives').mockResolvedValue(undefined);
      vi.spyOn(pool as any, 'createConnection').mockRejectedValueOnce(new Error('init connect failed'));

      await pool.initialize();
      expect(pool.isPoolInitialized()).toBe(true);

      await vi.advanceTimersByTimeAsync(25);
      expect(healthSpy).toHaveBeenCalled();
      expect(idleSpy).toHaveBeenCalled();
      expect(keepaliveSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('reloadServers swallows database errors', async () => {
      pool = createPool();
      (prismaDb as any).nodeConfig.findFirst.mockRejectedValueOnce(new Error('db unavailable'));
      await expect(pool.reloadServers()).resolves.toBeUndefined();
    });

    it('shutdown rejects waiting requests and tolerates disconnect errors', async () => {
      pool = createPool();
      (pool as any).isInitialized = true;
      const timeout = setTimeout(() => undefined, 1000);
      let rejectionMessage = '';
      const queued = new Promise<void>((resolve, reject) => {
        (pool as any).waitingQueue.push({
          resolve,
          reject: (err: Error) => {
            rejectionMessage = err.message;
            reject(err);
          },
          timeoutId: timeout,
          purpose: undefined,
          startTime: Date.now(),
        });
      }).catch(() => undefined);

      const badConn = makeConn({
        id: 'conn-bad',
        client: {
          disconnect: vi.fn(() => {
            throw new Error('disconnect failed');
          }),
          isConnected: vi.fn().mockReturnValue(true),
        },
      });
      (pool as any).connections.set('conn-bad', badConn);

      await pool.shutdown();
      await queued;

      expect(rejectionMessage).toContain('Pool is shutting down');
      expect((pool as any).connections.size).toBe(0);
    });

    it('acquireInternal throws immediately when pool is shutting down', async () => {
      pool = createPool();
      (pool as any).isShuttingDown = true;
      await expect((pool as any).acquireInternal()).rejects.toThrow('Pool is shutting down');
    });

    it('acquireInternal single-mode reconnects disconnected existing connection', async () => {
      pool = createPool({ enabled: false });
      (pool as any).isInitialized = true;
      const conn = makeConn({
        client: {
          isConnected: vi.fn().mockReturnValue(false),
          disconnect: vi.fn(),
          connect: vi.fn(),
          getServerVersion: vi.fn(),
        },
      });
      (pool as any).connections.set(conn.id, conn);
      const reconnectSpy = vi.spyOn(pool as any, 'reconnectConnection').mockResolvedValue(undefined);

      const handle = await (pool as any).acquireInternal();
      expect(handle.client).toBe(conn.client);
      expect(reconnectSpy).toHaveBeenCalledWith(conn);
    });

    it('acquireInternal single-mode creates connection when none exists', async () => {
      pool = createPool({ enabled: false });
      (pool as any).isInitialized = true;
      const created = makeConn({ id: 'single-created' });
      vi.spyOn(pool as any, 'createConnection').mockImplementation(async () => {
        (pool as any).connections.set(created.id, created);
        return created;
      });

      const handle = await (pool as any).acquireInternal();
      expect(handle.client).toBe(created.client);
    });

    it('acquireInternal initializes pool lazily when called before initialization', async () => {
      pool = createPool({ enabled: false });
      const conn = makeConn({ id: 'lazy-init-single' });
      const initSpy = vi.spyOn(pool, 'initialize').mockImplementation(async () => {
        (pool as any).isInitialized = true;
        (pool as any).connections.set(conn.id, conn);
      });

      const handle = await (pool as any).acquireInternal();
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(handle.client).toBe(conn.client);
    });

    it('acquireInternal queues requests when new connection creation fails under capacity', async () => {
      vi.useFakeTimers();
      pool = createPool({
        enabled: true,
        minConnections: 0,
        maxConnections: 1,
        maxWaitingRequests: 1,
        acquisitionTimeoutMs: 10,
      });
      (pool as any).isInitialized = true;
      vi.spyOn(pool as any, 'findIdleConnection').mockReturnValue(null);
      vi.spyOn(pool as any, 'createConnection').mockRejectedValueOnce(new Error('create failed'));

      const pending = (pool as any).acquireInternal({ timeoutMs: 10 });
      const rejected = pending.catch((err: Error) => err);
      await vi.advanceTimersByTimeAsync(15);
      const error = await rejected;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Connection acquisition timeout');
      vi.useRealTimers();
    });

    it('acquireInternal creates and activates a new connection when capacity is available', async () => {
      pool = createPool({
        enabled: true,
        minConnections: 0,
        maxConnections: 1,
      });
      (pool as any).isInitialized = true;
      vi.spyOn(pool as any, 'findIdleConnection').mockReturnValue(null);
      const created = makeConn({ id: 'created-on-demand', state: 'idle' });
      const createSpy = vi.spyOn(pool as any, 'createConnection').mockResolvedValue(created);

      const handle = await (pool as any).acquireInternal({ purpose: 'on-demand' });
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(handle.client).toBe(created.client);

      handle.release();
      expect(created.state).toBe('idle');
    });

    it('acquireInternal throws when waiting queue is full', async () => {
      pool = createPool({
        minConnections: 0,
        maxConnections: 0,
        maxWaitingRequests: 0,
      });
      (pool as any).isInitialized = true;

      await expect((pool as any).acquireInternal()).rejects.toThrow('Pool request queue is full');
    });

    it('acquireInternal times out queued requests', async () => {
      pool = createPool({
        minConnections: 0,
        maxConnections: 0,
        maxWaitingRequests: 1,
        acquisitionTimeoutMs: 10,
      });
      (pool as any).isInitialized = true;
      vi.useFakeTimers();

      const queued = (pool as any).acquireInternal({ timeoutMs: 10 });
      const rejected = queued.catch((err: Error) => err);
      await vi.advanceTimersByTimeAsync(15);
      const error = await rejected;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Connection acquisition timeout');
      vi.useRealTimers();
    });

    it('acquireInternal timeout callback tolerates queue entry already removed', async () => {
      pool = createPool({
        minConnections: 0,
        maxConnections: 0,
        maxWaitingRequests: 1,
        acquisitionTimeoutMs: 10,
      });
      (pool as any).isInitialized = true;
      vi.useFakeTimers();

      const queued = (pool as any).acquireInternal({ timeoutMs: 10 });
      (pool as any).waitingQueue.splice(0, 1);
      const rejected = queued.catch((err: Error) => err);

      await vi.advanceTimersByTimeAsync(15);
      const error = await rejected;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Connection acquisition timeout');
      vi.useRealTimers();
    });

    it('getSubscriptionConnection handles dead existing subscription and allocates a new one', async () => {
      pool = createPool({ enabled: true, maxConnections: 1, minConnections: 0 });
      (pool as any).isInitialized = true;
      const dead = makeConn({
        id: 'dead-sub',
        state: 'closed',
        client: { isConnected: vi.fn().mockReturnValue(false) },
      });
      (pool as any).connections.set(dead.id, dead);
      (pool as any).subscriptionConnectionId.value = dead.id;
      const created = makeConn({ id: 'new-sub', state: 'idle' });
      vi.spyOn(pool as any, 'createConnection').mockResolvedValue(created);
      vi.spyOn(pool as any, 'findIdleConnection').mockReturnValue(null);

      const client = await pool.getSubscriptionConnection();
      expect(client).toBe(created.client);
      expect((pool as any).subscriptionConnectionId.value).toBe(created.id);
      expect(created.isDedicated).toBe(true);
    });

    it('reconnectConnection closes and removes connection after max attempts', async () => {
      pool = createPool({
        maxReconnectAttempts: 2,
        reconnectDelayMs: 5,
      });
      vi.useFakeTimers();

      const conn = {
        id: 'dedicated-1',
        client: {
          connect: vi.fn().mockRejectedValue(new Error('connect fail')),
          getServerVersion: vi.fn(),
          disconnect: vi.fn(),
        },
        state: 'idle',
        createdAt: new Date(),
        lastUsedAt: new Date(),
        lastHealthCheck: new Date(),
        useCount: 0,
        isDedicated: true,
        serverId: 'server-1',
        serverLabel: 'S1',
        serverHost: 'h',
        serverPort: 50001,
      };

      (pool as any).connections.set(conn.id, conn);
      (pool as any).subscriptionConnectionId.value = conn.id;

      const reconnectPromise = (pool as any).reconnectConnection(conn);
      await vi.runAllTimersAsync();
      await reconnectPromise;

      expect((pool as any).connections.has(conn.id)).toBe(false);
      expect((pool as any).subscriptionConnectionId.value).toBeNull();
      expect(conn.state).toBe('closed');
      vi.useRealTimers();
    });

    it('performHealthChecks records success/failure and invokes follow-up hooks', async () => {
      pool = createPool();
      pool.setServers([
        { id: 'server-1', label: 'S1', host: 'a', port: 50001, useSsl: true, priority: 0, enabled: true },
        { id: 'server-2', label: 'S2', host: 'b', port: 50002, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isShuttingDown = false;

      const successConn = makeConn({
        id: 'ok',
        serverId: 'server-1',
        state: 'idle',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockResolvedValue(123),
          disconnect: vi.fn(),
        },
      });
      const failConn = makeConn({
        id: 'fail',
        serverId: 'server-2',
        state: 'idle',
        isDedicated: true,
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockRejectedValue(new Error('nope')),
          disconnect: vi.fn(),
        },
      });
      (pool as any).connections.set(successConn.id, successConn);
      (pool as any).connections.set(failConn.id, failConn);

      const reconnectSpy = vi.spyOn(pool as any, 'reconnectConnection').mockResolvedValue(undefined);
      const ensureSpy = vi.spyOn(pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      const exportSpy = vi.spyOn(pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (pool as any).performHealthChecks();

      expect(reconnectSpy).toHaveBeenCalledWith(failConn);
      expect(ensureSpy).toHaveBeenCalledTimes(1);
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });

    it('performHealthChecks routes disconnected non-dedicated connections to handleConnectionError', async () => {
      pool = createPool();
      pool.setServers([
        { id: 'server-1', label: 'S1', host: 'a', port: 50001, useSsl: true, priority: 0, enabled: true },
      ]);
      (pool as any).isShuttingDown = false;

      const disconnected = makeConn({
        id: 'disc-health',
        state: 'idle',
        isDedicated: false,
        serverId: 'server-1',
        client: {
          isConnected: vi.fn().mockReturnValue(false),
          getBlockHeight: vi.fn(),
          disconnect: vi.fn(),
        },
      });
      (pool as any).connections.set(disconnected.id, disconnected);

      const handleSpy = vi.spyOn(pool as any, 'handleConnectionError').mockResolvedValue(undefined);
      const ensureSpy = vi.spyOn(pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      const exportSpy = vi.spyOn(pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (pool as any).performHealthChecks();

      expect(handleSpy).toHaveBeenCalledWith(disconnected);
      expect(ensureSpy).toHaveBeenCalledTimes(1);
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });

    it('sendKeepalives only pings idle non-dedicated connected clients', async () => {
      pool = createPool();
      const idleConn = makeConn({
        id: 'idle',
        state: 'idle',
        isDedicated: false,
      });
      const activeConn = makeConn({
        id: 'active',
        state: 'active',
      });
      const dedicatedConn = makeConn({
        id: 'ded',
        state: 'idle',
        isDedicated: true,
      });
      const disconnectedConn = makeConn({
        id: 'disc',
        state: 'idle',
        isDedicated: false,
        client: {
          ...makeConn().client,
          isConnected: vi.fn().mockReturnValue(false),
          ping: vi.fn(),
        },
      });

      (pool as any).connections.set(idleConn.id, idleConn);
      (pool as any).connections.set(activeConn.id, activeConn);
      (pool as any).connections.set(dedicatedConn.id, dedicatedConn);
      (pool as any).connections.set(disconnectedConn.id, disconnectedConn);

      await (pool as any).sendKeepalives();

      expect(idleConn.client.ping).toHaveBeenCalledTimes(1);
      expect(activeConn.client.ping).not.toHaveBeenCalled();
      expect(dedicatedConn.client.ping).not.toHaveBeenCalled();
      expect(disconnectedConn.client.ping).not.toHaveBeenCalled();
    });

    it('sendKeepalives returns early when shutting down', async () => {
      pool = createPool();
      (pool as any).isShuttingDown = true;
      const idleConn = makeConn({ id: 'idle-early', state: 'idle', isDedicated: false });
      (pool as any).connections.set(idleConn.id, idleConn);

      await (pool as any).sendKeepalives();
      expect(idleConn.client.ping).not.toHaveBeenCalled();
    });

    it('sendKeepalives swallows ping failures', async () => {
      pool = createPool();
      const idleConn = makeConn({
        id: 'idle-fail',
        state: 'idle',
        isDedicated: false,
        client: {
          ...makeConn().client,
          isConnected: vi.fn().mockReturnValue(true),
          ping: vi.fn().mockRejectedValue(new Error('ping failed')),
        },
      });
      (pool as any).connections.set(idleConn.id, idleConn);

      await expect((pool as any).sendKeepalives()).resolves.toBeUndefined();
      expect(idleConn.client.ping).toHaveBeenCalledTimes(1);
    });

    it('cleanupIdleConnections removes stale idle connections but keeps dedicated ones', () => {
      pool = createPool({ minConnections: 1, idleTimeoutMs: 10 });
      const oldDate = new Date(Date.now() - 1000);
      const staleConn = {
        id: 'stale',
        client: { disconnect: vi.fn(), isConnected: vi.fn().mockReturnValue(true) },
        state: 'idle',
        createdAt: oldDate,
        lastUsedAt: oldDate,
        lastHealthCheck: oldDate,
        useCount: 0,
        isDedicated: false,
        serverId: 's1',
        serverLabel: 'S1',
        serverHost: 'h',
        serverPort: 50001,
      };
      const dedicatedConn = {
        ...staleConn,
        id: 'dedicated',
        isDedicated: true,
        client: { disconnect: vi.fn(), isConnected: vi.fn().mockReturnValue(true) },
      };

      (pool as any).connections.set(staleConn.id, staleConn);
      (pool as any).connections.set(dedicatedConn.id, dedicatedConn);

      (pool as any).cleanupIdleConnections();

      expect((pool as any).connections.has('stale')).toBe(false);
      expect((pool as any).connections.has('dedicated')).toBe(true);
      expect(staleConn.client.disconnect).toHaveBeenCalledTimes(1);
    });

    it('cleanupIdleConnections tolerates disconnect errors', () => {
      pool = createPool({ minConnections: 0, idleTimeoutMs: 10 });
      const oldDate = new Date(Date.now() - 1000);
      const staleConn = makeConn({
        id: 'stale-err',
        state: 'idle',
        createdAt: oldDate,
        lastUsedAt: oldDate,
        client: {
          disconnect: vi.fn(() => {
            throw new Error('boom');
          }),
          isConnected: vi.fn().mockReturnValue(true),
        },
      });

      (pool as any).connections.set(staleConn.id, staleConn);
      (pool as any).cleanupIdleConnections();
      expect((pool as any).connections.has(staleConn.id)).toBe(false);
    });

    it('getSubscriptionConnection initializes pool when needed', async () => {
      pool = createPool();
      (pool as any).isInitialized = false;
      const initSpy = vi.spyOn(pool, 'initialize').mockResolvedValue(undefined);
      const existing = makeConn({ id: 'sub-existing', state: 'idle' });
      (pool as any).connections.set(existing.id, existing);
      (pool as any).findIdleConnection = vi.fn().mockReturnValue(existing);

      const client = await pool.getSubscriptionConnection();

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(client).toBe(existing.client);
    });

    it('getSubscriptionConnection single-mode reconnects or creates as needed', async () => {
      pool = createPool({ enabled: false });
      (pool as any).isInitialized = true;

      const disconnected = makeConn({
        id: 'single-sub',
        client: {
          isConnected: vi.fn().mockReturnValue(false),
          disconnect: vi.fn(),
          connect: vi.fn(),
          getServerVersion: vi.fn(),
        },
      });
      (pool as any).connections.set(disconnected.id, disconnected);
      const reconnectSpy = vi.spyOn(pool as any, 'reconnectConnection').mockResolvedValue(undefined);

      const first = await pool.getSubscriptionConnection();
      expect(first).toBe(disconnected.client);
      expect(reconnectSpy).toHaveBeenCalledWith(disconnected);

      (pool as any).connections.clear();
      const created = makeConn({ id: 'single-sub-created' });
      vi.spyOn(pool as any, 'createConnection').mockImplementation(async () => {
        (pool as any).connections.set(created.id, created);
        return created;
      });
      const second = await pool.getSubscriptionConnection();
      expect(second).toBe(created.client);
    });

    it('getSubscriptionConnection single-mode reuses an already connected existing connection', async () => {
      pool = createPool({ enabled: false });
      (pool as any).isInitialized = true;

      const connected = makeConn({
        id: 'single-sub-connected',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          disconnect: vi.fn(),
          connect: vi.fn(),
          getServerVersion: vi.fn(),
        },
      });
      (pool as any).connections.set(connected.id, connected);
      const reconnectSpy = vi.spyOn(pool as any, 'reconnectConnection').mockResolvedValue(undefined);
      const createSpy = vi.spyOn(pool as any, 'createConnection');

      const client = await pool.getSubscriptionConnection();
      expect(client).toBe(connected.client);
      expect(reconnectSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('getSubscriptionConnection creates a new connection when no idle connection exists and capacity remains', async () => {
      pool = createPool({ enabled: true, minConnections: 0, maxConnections: 2 });
      (pool as any).isInitialized = true;

      const active = makeConn({ id: 'active-only', state: 'active' });
      (pool as any).connections.set(active.id, active);
      vi.spyOn(pool as any, 'findIdleConnection').mockReturnValue(null);

      const created = makeConn({ id: 'new-sub-capacity', state: 'idle' });
      const createSpy = vi.spyOn(pool as any, 'createConnection').mockResolvedValue(created);

      const client = await pool.getSubscriptionConnection();
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(client).toBe(created.client);
      expect((pool as any).subscriptionConnectionId.value).toBe(created.id);
    });

    it('single-mode handle withClient returns callback result', async () => {
      pool = createPool({ enabled: false });
      (pool as any).isInitialized = true;
      const conn = makeConn({ id: 'single-with-client' });
      (pool as any).connections.set(conn.id, conn);

      const handle = await (pool as any).acquireInternal();
      const result = await handle.withClient(async (client) => {
        expect(client).toBe(conn.client);
        return 'ok';
      });

      expect(result).toBe('ok');
    });

    it('processWaitingQueue assigns idle connections to waiting requests', async () => {
      pool = createPool();
      const idle = makeConn({ id: 'idle-queue', state: 'idle' });
      (pool as any).connections.set(idle.id, idle);
      const resolve = vi.fn();
      const reject = vi.fn();
      const timeoutId = setTimeout(() => undefined, 1000);
      (pool as any).waitingQueue.push({
        resolve,
        reject,
        timeoutId,
        purpose: 'test-purpose',
        startTime: Date.now(),
      });

      (pool as any).processWaitingQueue();

      expect(resolve).toHaveBeenCalledTimes(1);
      clearTimeout(timeoutId);
    });

    it('processWaitingQueue returns when no idle connection exists', () => {
      pool = createPool();
      const resolve = vi.fn();
      const reject = vi.fn();
      const timeoutId = setTimeout(() => undefined, 1000);
      (pool as any).waitingQueue.push({
        resolve,
        reject,
        timeoutId,
        purpose: 'test-purpose',
        startTime: Date.now(),
      });

      (pool as any).processWaitingQueue();

      expect(resolve).not.toHaveBeenCalled();
      clearTimeout(timeoutId);
    });

    it('processWaitingQueue tolerates races where queue shift returns undefined', () => {
      pool = createPool();
      const idle = makeConn({ id: 'idle-race', state: 'idle' });
      (pool as any).connections.set(idle.id, idle);
      const timeoutId = setTimeout(() => undefined, 1000);
      (pool as any).waitingQueue.push({
        resolve: vi.fn(),
        reject: vi.fn(),
        timeoutId,
        purpose: 'race',
        startTime: Date.now(),
      });
      const shiftSpy = vi.spyOn((pool as any).waitingQueue, 'shift').mockReturnValueOnce(undefined as any);

      (pool as any).processWaitingQueue();

      expect(shiftSpy).toHaveBeenCalled();
      shiftSpy.mockRestore();
      clearTimeout(timeoutId);
    });

    it('selectServer handles cooldown fallback and load balancing branches', () => {
      pool = createPool({ loadBalancing: 'least_connections' });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true, supportsVerbose: true },
      ]);

      const now = Date.now();
      const stats1 = (pool as any).serverStats.get('s1');
      const stats2 = (pool as any).serverStats.get('s2');
      stats1.cooldownUntil = new Date(now + 10_000);
      stats2.cooldownUntil = new Date(now + 20_000);
      stats1.isHealthy = true;
      stats2.isHealthy = true;

      const cooldownFallback = (pool as any).selectServer();
      expect(cooldownFallback.id).toBe('s1');

      stats1.cooldownUntil = null;
      stats2.cooldownUntil = null;
      const leastConn = (pool as any).selectServer();
      expect(['s1', 's2']).toContain(leastConn.id);

      (pool as any).config.loadBalancing = 'failover_only';
      const failover = (pool as any).selectServer();
      expect(failover.id).toBe('s1');
    });

    it('selectServer least_connections accounts for currently active per-server connections', () => {
      pool = createPool({ loadBalancing: 'least_connections' });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      // One active connection on s1, none on s2
      (pool as any).connections.set('active-s1', makeConn({ id: 'active-s1', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('idle-s2', makeConn({ id: 'idle-s2', serverId: 's2', state: 'idle' }));

      const selected = (pool as any).selectServer();
      expect(selected.id).toBe('s2');
    });

    it('selectServer falls back to first enabled server when all enabled are unhealthy', () => {
      pool = createPool({ loadBalancing: 'least_connections' });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      (pool as any).serverStats.get('s1').isHealthy = false;
      (pool as any).serverStats.get('s2').isHealthy = false;

      const selected = (pool as any).selectServer();
      expect(selected?.id).toBe('s1');
    });

    it('selectServer handles disabled servers and missing stats under least-connections strategy', () => {
      pool = createPool({ loadBalancing: 'least_connections' });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: false },
        { id: 's3', label: 'S3', host: 'c', port: 3, useSsl: true, priority: 2, enabled: true },
      ]);

      (pool as any).serverStats.delete('s1');
      (pool as any).connections.set('active-s3-a', makeConn({ id: 'active-s3-a', serverId: 's3', state: 'active' }));
      (pool as any).connections.set('active-s3-b', makeConn({ id: 'active-s3-b', serverId: 's3', state: 'active' }));

      const selected = (pool as any).selectServer();
      expect(selected.id).toBe('s1');
    });

    it('selectServer skips explicitly disabled servers when present in internal server list', () => {
      pool = createPool({ loadBalancing: 'failover_only' });
      (pool as any).servers = [
        { id: 'disabled-internal', label: 'Disabled', host: 'd', port: 1, useSsl: true, priority: 0, enabled: false },
        { id: 'enabled-internal', label: 'Enabled', host: 'e', port: 2, useSsl: true, priority: 1, enabled: true },
      ];
      (pool as any).serverStats.set('enabled-internal', {
        totalRequests: 0,
        failedRequests: 0,
        isHealthy: true,
        lastHealthCheck: null,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        backoffLevel: 0,
        cooldownUntil: null,
        weight: 1,
        healthHistory: [],
      });

      const selected = (pool as any).selectServer();
      expect(selected?.id).toBe('enabled-internal');
    });

    it('selectServer cooldown sort falls back to zero when cooldown metadata is missing during ranking', () => {
      pool = createPool({ loadBalancing: 'least_connections' });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      const now = Date.now();
      (pool as any).serverStats.get('s1').isHealthy = true;
      (pool as any).serverStats.get('s2').isHealthy = true;
      (pool as any).serverStats.get('s1').cooldownUntil = new Date(now + 5_000);
      (pool as any).serverStats.get('s2').cooldownUntil = new Date(now + 10_000);

      const statsMap = (pool as any).serverStats as Map<string, any>;
      const originalGet = statsMap.get.bind(statsMap);
      let getCount = 0;
      const getSpy = vi.spyOn(statsMap, 'get').mockImplementation((key: string) => {
        getCount += 1;
        const stats = originalGet(key);
        if ((key === 's1' || key === 's2') && getCount > 4) {
          return {
            ...stats,
            cooldownUntil: undefined,
          };
        }
        return stats;
      });

      try {
        const selected = (pool as any).selectServer();
        expect(selected).toBeDefined();
      } finally {
        getSpy.mockRestore();
      }
    });

    it('selectServer round-robin path tolerates servers without stats weight entries', () => {
      pool = createPool({ loadBalancing: 'round_robin' });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).serverStats.delete('s2');

      const selected = (pool as any).selectServer();
      expect(['s1', 's2']).toContain(selected.id);
    });

    it('selectWeightedRoundRobin falls back to last server when cumulative selection never matches', () => {
      pool = createPool({ loadBalancing: 'round_robin' });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      // Force NaN weight math so point < cumulative never matches, exercising fallback branch.
      (pool as any).serverStats.get('s1').weight = Number.NaN;
      (pool as any).serverStats.get('s2').weight = Number.NaN;

      const selected = (pool as any).selectServer();
      expect(selected.id).toBe('s2');
    });

    it('ensureMinimumConnections handles both successful and failed server connection creation', async () => {
      pool = createPool({ enabled: true });
      pool.setServers([
        { id: 's1', label: 'Server 1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Server 2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isShuttingDown = false;
      (pool as any).connections.clear();

      const createSpy = vi.spyOn(pool as any, 'createConnection')
        .mockResolvedValueOnce(makeConn({ id: 'created-s1', serverId: 's1' }))
        .mockRejectedValueOnce(new Error('cannot connect s2'));

      await (pool as any).ensureMinimumConnections();

      expect(createSpy).toHaveBeenCalledTimes(2);
      const s1Stats = (pool as any).serverStats.get('s1');
      const s2Stats = (pool as any).serverStats.get('s2');
      expect(s1Stats.isHealthy).toBe(true);
      expect(s2Stats.isHealthy).toBe(false);
    });

    it('ensureMinimumConnections returns early when pool is disabled', async () => {
      pool = createPool({ enabled: false });
      pool.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);
      const createSpy = vi.spyOn(pool as any, 'createConnection').mockResolvedValue(makeConn({ id: 'unused' }));

      await (pool as any).ensureMinimumConnections();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('ensureMinimumConnections counts only non-closed connections', async () => {
      pool = createPool({ enabled: true });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isShuttingDown = false;

      const s1Idle = makeConn({ id: 's1-idle', serverId: 's1', state: 'idle' });
      const s1Closed = makeConn({ id: 's1-closed', serverId: 's1', state: 'closed' });
      (pool as any).connections.set(s1Idle.id, s1Idle);
      (pool as any).connections.set(s1Closed.id, s1Closed);

      const createSpy = vi.spyOn(pool as any, 'createConnection').mockResolvedValue(makeConn({ id: 'created-s2', serverId: 's2' }));
      await (pool as any).ensureMinimumConnections();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));
    });

    it('ensureMinimumConnections skips health-stat updates when server stats are missing', async () => {
      pool = createPool({ enabled: true });
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).serverStats.delete('s1');
      (pool as any).serverStats.delete('s2');

      const createSpy = vi.spyOn(pool as any, 'createConnection')
        .mockResolvedValueOnce(makeConn({ id: 'created-s1', serverId: 's1' }))
        .mockRejectedValueOnce(new Error('cannot connect s2'));

      await (pool as any).ensureMinimumConnections();

      expect(createSpy).toHaveBeenCalledTimes(2);
    });

    it('handleConnectionError covers dedicated and non-dedicated branches', async () => {
      pool = createPool();
      const dedicated = makeConn({ id: 'ded', isDedicated: true, state: 'active' });
      const reconnectSpy = vi.spyOn(pool as any, 'reconnectConnection').mockResolvedValue(undefined);
      await (pool as any).handleConnectionError(dedicated);
      expect(reconnectSpy).toHaveBeenCalledWith(dedicated);

      const regular = makeConn({
        id: 'reg',
        isDedicated: false,
        state: 'active',
        client: {
          disconnect: vi.fn(() => {
            throw new Error('disconnect failed');
          }),
          isConnected: vi.fn().mockReturnValue(false),
        },
      });
      (pool as any).connections.set(regular.id, regular);
      (pool as any).isShuttingDown = false;
      (pool as any).config.minConnections = 5;
      vi.spyOn(pool as any, 'getEffectiveMinConnections').mockReturnValue(5);
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('replace fail'));

      await (pool as any).handleConnectionError(regular);
      expect((pool as any).connections.has(regular.id)).toBe(false);
    });

    it('handleConnectionError does not create replacement when minimum threshold is already met', async () => {
      pool = createPool();
      const regular = makeConn({ id: 'reg-no-replace', isDedicated: false, state: 'active' });
      const survivor = makeConn({ id: 'survivor', state: 'idle' });
      (pool as any).connections.set(regular.id, regular);
      (pool as any).connections.set(survivor.id, survivor);
      (pool as any).isShuttingDown = false;
      vi.spyOn(pool as any, 'getEffectiveMinConnections').mockReturnValue(1);
      const createSpy = vi.spyOn(pool as any, 'createConnection').mockResolvedValue(makeConn({ id: 'unused' }));

      await (pool as any).handleConnectionError(regular);

      expect((pool as any).connections.has(regular.id)).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('reconnectConnection success path restores idle state and emits subscription event', async () => {
      pool = createPool({ maxReconnectAttempts: 1 });
      const subscriptionListener = vi.fn();
      pool.on('subscriptionReconnected', subscriptionListener);

      const conn = makeConn({
        id: 'reconnect-ok',
        isDedicated: true,
        state: 'active',
        client: {
          connect: vi.fn().mockResolvedValue(undefined),
          getServerVersion: vi.fn().mockResolvedValue({ server: 'ok', protocol: '1.4' }),
          disconnect: vi.fn(() => {
            throw new Error('already disconnected');
          }),
          isConnected: vi.fn().mockReturnValue(true),
        },
      });

      await (pool as any).reconnectConnection(conn);

      expect(conn.state).toBe('idle');
      expect(subscriptionListener).toHaveBeenCalledWith(conn.client);
    });

    it('reconnectConnection success path for non-dedicated connection does not emit subscription event', async () => {
      pool = createPool({ maxReconnectAttempts: 1 });
      const subscriptionListener = vi.fn();
      pool.on('subscriptionReconnected', subscriptionListener);

      const conn = makeConn({
        id: 'reconnect-non-dedicated',
        isDedicated: false,
        state: 'active',
        client: {
          connect: vi.fn().mockResolvedValue(undefined),
          getServerVersion: vi.fn().mockResolvedValue({ server: 'ok', protocol: '1.4' }),
          disconnect: vi.fn(),
          isConnected: vi.fn().mockReturnValue(true),
        },
      });

      await (pool as any).reconnectConnection(conn);

      expect(conn.state).toBe('idle');
      expect(subscriptionListener).not.toHaveBeenCalled();
    });

    it('createConnection supports non-SSL servers via tcp protocol', async () => {
      pool = createPool();
      const { ElectrumClient } = await import('../../../../src/services/bitcoin/electrum');

      await (pool as any).createConnection({
        id: 'tcp-server',
        label: 'TCP Server',
        host: 'tcp.example.com',
        port: 50001,
        useSsl: false,
        priority: 0,
        enabled: true,
      });

      expect(ElectrumClient).toHaveBeenCalledWith(
        expect.objectContaining({
          protocol: 'tcp',
        })
      );
    });

    it('findIdleConnection ignores disconnected idle connections', () => {
      pool = createPool();
      const disconnectedIdle = makeConn({
        id: 'idle-disconnected',
        state: 'idle',
        client: {
          connect: vi.fn(),
          disconnect: vi.fn(),
          isConnected: vi.fn().mockReturnValue(false),
          getServerVersion: vi.fn(),
          getBlockHeight: vi.fn(),
          ping: vi.fn(),
          on: vi.fn(),
        },
      });
      (pool as any).connections.set(disconnectedIdle.id, disconnectedIdle);

      const selected = (pool as any).findIdleConnection();
      expect(selected).toBeNull();
    });

    it('activateConnection release is a no-op for dedicated connections', () => {
      pool = createPool();
      const dedicated = makeConn({ id: 'ded-release', state: 'active', isDedicated: true });

      const handle = (pool as any).activateConnection(dedicated, 'dedicated-test', Date.now());
      handle.release();

      expect(dedicated.state).toBe('active');
    });

    it('performHealthChecks aggregates repeated server failures without duplicate first-failure records', async () => {
      pool = createPool();
      pool.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);
      const failingA = makeConn({
        id: 'fail-a',
        serverId: 's1',
        state: 'idle',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockRejectedValue(new Error('boom-a')),
        },
      });
      const failingB = makeConn({
        id: 'fail-b',
        serverId: 's1',
        state: 'idle',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockRejectedValue(new Error('boom-b')),
        },
      });
      (pool as any).connections.set(failingA.id, failingA);
      (pool as any).connections.set(failingB.id, failingB);
      // Clear any existing health history so we can count new entries
      const statsBeforeFail = (pool as any).serverStats.get('s1');
      if (statsBeforeFail) statsBeforeFail.healthHistory = [];
      vi.spyOn(pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      vi.spyOn(pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (pool as any).performHealthChecks();

      // Only one failure record should be added per server per cycle (not one per connection)
      const statsAfterFail = (pool as any).serverStats.get('s1');
      const failEntries = statsAfterFail.healthHistory.filter((h: any) => !h.success);
      expect(failEntries.length).toBe(1);
    });

    it('performHealthChecks skips active non-dedicated connections and records first success once per server', async () => {
      pool = createPool();
      pool.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);

      const skippedActive = makeConn({
        id: 'active-skip',
        serverId: 's1',
        state: 'active',
        isDedicated: false,
      });
      const idleA = makeConn({
        id: 'idle-a',
        serverId: 's1',
        state: 'idle',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockResolvedValue(101),
        },
      });
      const idleB = makeConn({
        id: 'idle-b',
        serverId: 's1',
        state: 'idle',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockResolvedValue(102),
        },
      });

      (pool as any).connections.set(skippedActive.id, skippedActive);
      (pool as any).connections.set(idleA.id, idleA);
      (pool as any).connections.set(idleB.id, idleB);
      // Clear any existing health history so we can count new entries
      const statsBeforeSuccess = (pool as any).serverStats.get('s1');
      if (statsBeforeSuccess) statsBeforeSuccess.healthHistory = [];
      vi.spyOn(pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      vi.spyOn(pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (pool as any).performHealthChecks();

      expect(skippedActive.client.getBlockHeight).not.toHaveBeenCalled();
      // Only one success record should be added per server per cycle
      const statsAfterSuccess = (pool as any).serverStats.get('s1');
      const successEntries = statsAfterSuccess.healthHistory.filter((h: any) => h.success);
      expect(successEntries.length).toBe(1);
    });

    it('performHealthChecks skips server stat updates when stats entry is missing', async () => {
      pool = createPool();
      pool.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);
      (pool as any).serverStats.delete('s1');
      const conn = makeConn({
        id: 'missing-stats',
        serverId: 's1',
        state: 'idle',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockResolvedValue(101),
        },
      });
      (pool as any).connections.set(conn.id, conn);
      vi.spyOn(pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      vi.spyOn(pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (pool as any).performHealthChecks();

      expect((pool as any).serverStats.has('s1')).toBe(false);
    });

    it('cleanupIdleConnections preserves minimum pool size and recent idle connections', () => {
      pool = createPool({ idleTimeoutMs: 1000 });
      const minProtected = makeConn({
        id: 'min-protected',
        state: 'idle',
        lastUsedAt: new Date(Date.now() - 10_000),
      });
      (pool as any).connections.set(minProtected.id, minProtected);
      vi.spyOn(pool as any, 'getEffectiveMinConnections').mockReturnValue(1);

      (pool as any).cleanupIdleConnections();
      expect((pool as any).connections.has(minProtected.id)).toBe(true);

      const recent = makeConn({
        id: 'recent-idle',
        state: 'idle',
        lastUsedAt: new Date(),
      });
      (pool as any).connections.set(recent.id, recent);
      vi.spyOn(pool as any, 'getEffectiveMinConnections').mockReturnValue(0);

      (pool as any).cleanupIdleConnections();
      expect((pool as any).connections.has(recent.id)).toBe(true);
    });

    it('createConnection error event delegates to handleConnectionError', async () => {
      pool = createPool();
      const handleSpy = vi.spyOn(pool as any, 'handleConnectionError').mockResolvedValue(undefined);

      const conn = await (pool as any).createConnection({
        id: 'evt-server',
        label: 'Evt Server',
        host: 'evt.example.com',
        port: 50002,
        useSsl: true,
        priority: 0,
        enabled: true,
      });

      const onCalls = (conn.client.on as any).mock.calls as Array<[string, (...args: any[]) => void]>;
      const errorHandler = onCalls.find(([eventName]) => eventName === 'error')?.[1];
      expect(errorHandler).toBeDefined();

      errorHandler!(new Error('synthetic connection error'));
      expect(handleSpy).toHaveBeenCalledWith(conn);
    });

    it('recordHealthCheckResult trims history to max size', () => {
      pool = createPool();
      pool.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);

      for (let i = 0; i < 30; i++) {
        recordHealthCheckResult((pool as any).serverStats, 's1', i % 2 === 0, i, `err-${i}`);
      }

      const state = pool.getServerBackoffState('s1');
      expect(state).not.toBeNull();
      const stats = pool.getPoolStats().servers.find((s) => s.serverId === 's1');
      expect(stats?.healthHistory.length).toBeLessThanOrEqual(20);
    });

    it('backoff and health-result helpers no-op for unknown server ids', () => {
      pool = createPool();

      expect(() => pool.recordServerFailure('missing-server')).not.toThrow();
      expect(() => pool.recordServerSuccess('missing-server')).not.toThrow();
      expect(() => recordHealthCheckResult((pool as any).serverStats, 'missing-server', true, 1)).not.toThrow();
    });

    it('exportMetrics reads pool and circuit stats', () => {
      pool = createPool();
      expect(() => (pool as any).exportMetrics()).not.toThrow();
    });

    it('exportMetrics includes per-server metrics when servers are configured', () => {
      pool = createPool();
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
      ]);
      expect(() => (pool as any).exportMetrics()).not.toThrow();
    });
  });

  describe('module-level pool helpers', () => {
    afterEach(async () => {
      await shutdownElectrumPool();
      await resetElectrumPoolForNetwork('mainnet');
      await resetElectrumPoolForNetwork('testnet');
      await resetElectrumPoolForNetwork('signet');
      await resetElectrumPoolForNetwork('regtest');
      await resetElectrumPool();
    });

    it('initializes async singleton and reuses it', async () => {
      const first = await getElectrumPoolAsync();
      const second = await getElectrumPoolAsync();

      expect(first).toBe(second);
      expect(getPoolConfig()).not.toBeNull();
      expect(isPoolEnabled()).toBe(true);
    });

    it('module-level helpers return defaults when singleton is not initialized', async () => {
      expect(getPoolConfig()).toBeNull();
      expect(isPoolEnabled()).toBe(true);
      expect(getElectrumServers()).toEqual([]);
      await expect(reloadElectrumServers()).resolves.toBeUndefined();
    });

    it('reuses in-flight async initialization across concurrent callers', async () => {
      const initSpy = vi.spyOn(ElectrumPool.prototype, 'initialize');

      const [first, second] = await Promise.all([
        getElectrumPoolAsync(),
        getElectrumPoolAsync(),
      ]);

      expect(first).toBe(second);
      expect(initSpy).toHaveBeenCalledTimes(1);
    });

    it('supports network-scoped pool lifecycle and reset', async () => {
      const first = await getElectrumPoolForNetwork('testnet');
      const second = await getElectrumPoolForNetwork('testnet');
      expect(second).toBe(first);

      await resetElectrumPoolForNetwork('testnet');
      const recreated = await getElectrumPoolForNetwork('testnet');
      expect(recreated).not.toBe(first);
    });

    it('reuses in-flight network initialization for concurrent callers', async () => {
      const initSpy = vi.spyOn(ElectrumPool.prototype, 'initialize');

      const [first, second] = await Promise.all([
        getElectrumPoolForNetwork('signet'),
        getElectrumPoolForNetwork('signet'),
      ]);

      expect(first).toBe(second);
      expect(initSpy).toHaveBeenCalledTimes(1);
    });

    it('returns pool from inner race guard when network pool appears during init', async () => {
      const fallbackPool = new ElectrumPool({
        enabled: true,
        minConnections: 1,
        maxConnections: 1,
      });
      const originalGet = Map.prototype.get;
      let regtestLookupCount = 0;
      const getSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function(this: Map<any, any>, key: any) {
        if (key === 'regtest') {
          regtestLookupCount += 1;
          if (regtestLookupCount <= 2) return undefined as any;
          if (regtestLookupCount === 3) return fallbackPool as any;
        }
        return originalGet.call(this, key);
      });

      try {
        const loaded = await getElectrumPoolForNetwork('regtest');
        expect(loaded).toBe(fallbackPool);
      } finally {
        getSpy.mockRestore();
      }
    });

    it('loads per-network db pool settings, proxy, and servers for network bootstrap', async () => {
      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        testnetPoolMin: 4,
        testnetPoolMax: 6,
        testnetPoolLoadBalancing: 'least_connections',
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: 'tor-user',
        proxyPassword: 'tor-pass',
        servers: [
          {
            id: 'tn-server-1',
            label: 'Testnet Server',
            host: 'tn.example.com',
            port: 51002,
            useSsl: true,
            priority: 0,
            enabled: true,
            supportsVerbose: true,
          },
        ],
      });

      const testnetPool = await getElectrumPoolForNetwork('testnet');
      expect((testnetPool as any).config.minConnections).toBe(4);
      expect((testnetPool as any).config.maxConnections).toBe(6);
      expect((testnetPool as any).config.loadBalancing).toBe('least_connections');
      expect(testnetPool.isProxyEnabled()).toBe(true);
      expect(testnetPool.getServers()).toHaveLength(1);

      await resetElectrumPoolForNetwork('testnet');

      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        signetPoolMin: 3,
        signetPoolMax: 7,
        signetPoolLoadBalancing: 'failover_only',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [
          {
            id: 'sig-server-1',
            label: 'Signet Server',
            host: 'sig.example.com',
            port: 60002,
            useSsl: true,
            priority: 0,
            enabled: true,
            supportsVerbose: true,
          },
        ],
      });

      const signetPool = await getElectrumPoolForNetwork('signet');
      expect((signetPool as any).config.minConnections).toBe(3);
      expect((signetPool as any).config.maxConnections).toBe(7);
      expect((signetPool as any).config.loadBalancing).toBe('failover_only');
      expect(signetPool.getServers()).toHaveLength(1);
    });

    it('falls back to global pool settings when per-network settings are missing and omits null proxy credentials', async () => {
      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolEnabled: true,
        poolMinConnections: 2,
        poolMaxConnections: 4,
        poolLoadBalancing: 'round_robin',
        testnetPoolMin: null,
        testnetPoolMax: null,
        testnetPoolLoadBalancing: null,
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: null,
        proxyPassword: null,
        servers: [
          {
            id: 'tn-fallback-1',
            label: 'Testnet Fallback Server',
            host: 'tn-fallback.example.com',
            port: 51002,
            useSsl: true,
            priority: 0,
            enabled: true,
            supportsVerbose: true,
          },
        ],
      });

      const testnetPool = await getElectrumPoolForNetwork('testnet');
      expect((testnetPool as any).config.minConnections).toBe(2);
      expect((testnetPool as any).config.maxConnections).toBe(4);
      expect((testnetPool as any).config.loadBalancing).toBe('round_robin');
      expect(testnetPool.getProxyConfig()).toMatchObject({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      });
      expect(testnetPool.getProxyConfig()?.username).toBeUndefined();
      expect(testnetPool.getProxyConfig()?.password).toBeUndefined();

      await resetElectrumPoolForNetwork('testnet');

      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolEnabled: true,
        poolMinConnections: 3,
        poolMaxConnections: 6,
        poolLoadBalancing: 'least_connections',
        signetPoolMin: null,
        signetPoolMax: null,
        signetPoolLoadBalancing: null,
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [
          {
            id: 'sig-fallback-1',
            label: 'Signet Fallback Server',
            host: 'sig-fallback.example.com',
            port: 60002,
            useSsl: true,
            priority: 0,
            enabled: true,
            supportsVerbose: true,
          },
        ],
      });

      const signetPool = await getElectrumPoolForNetwork('signet');
      expect((signetPool as any).config.minConnections).toBe(3);
      expect((signetPool as any).config.maxConnections).toBe(6);
      expect((signetPool as any).config.loadBalancing).toBe('least_connections');
    });

    it('keeps base pool settings for regtest (no per-network override branch)', async () => {
      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolEnabled: true,
        poolMinConnections: 3,
        poolMaxConnections: 8,
        poolLoadBalancing: 'round_robin',
        mainnetPoolMin: 10,
        mainnetPoolMax: 12,
        mainnetPoolLoadBalancing: 'failover_only',
        testnetPoolMin: 6,
        testnetPoolMax: 9,
        testnetPoolLoadBalancing: 'least_connections',
        signetPoolMin: 5,
        signetPoolMax: 7,
        signetPoolLoadBalancing: 'failover_only',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [],
      });

      const regtestPool = await getElectrumPoolForNetwork('regtest');
      expect((regtestPool as any).config.minConnections).toBe(3);
      expect((regtestPool as any).config.maxConnections).toBe(8);
      expect((regtestPool as any).config.loadBalancing).toBe('round_robin');
    });

    it('links mainnet network pool to legacy global singleton', async () => {
      const mainnetPool = await getElectrumPoolForNetwork('mainnet');
      expect(getElectrumPool()).toBe(mainnetPool);
    });

    it('supports config helpers and server reload passthrough', async () => {
      const configured = await initializeElectrumPool({
        enabled: false,
        minConnections: 1,
        maxConnections: 1,
      });

      expect(getElectrumPool()).toBe(configured);
      expect(isPoolEnabled()).toBe(false);
      expect(getElectrumServers()).toEqual([]);

      const reloadSpy = vi.spyOn(configured, 'reloadServers').mockResolvedValue(undefined);
      await reloadElectrumServers();
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      const config = getPoolConfig();
      expect(config?.enabled).toBe(false);
      expect(config?.minConnections).toBe(1);
    });

    it('loads servers and proxy settings from database during async bootstrap', async () => {
      (prismaDb as any).nodeConfig.findFirst.mockResolvedValueOnce({
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: 'tor-user',
        proxyPassword: 'tor-pass',
        servers: [
          {
            id: 'db-server-1',
            label: 'DB Server',
            host: 'db.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
            supportsVerbose: true,
          },
        ],
      });

      const loaded = await getElectrumPoolAsync();

      expect(loaded.getServers()).toHaveLength(1);
      expect(getElectrumServers()).toHaveLength(1);
      expect(loaded.isProxyEnabled()).toBe(true);
      expect(loaded.getProxyConfig()).toMatchObject({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      });
    });

    it('falls back to defaults when database pool config lookup fails', async () => {
      (prismaDb as any).nodeConfig.findFirst.mockRejectedValueOnce(new Error('db failure'));

      const loaded = await getElectrumPoolAsync();

      expect(loaded).toBeDefined();
      expect(getElectrumServers()).toEqual([]);
    });

    it('initializeElectrumPool without explicit config uses async bootstrap path', async () => {
      const initSpy = vi.spyOn(ElectrumPool.prototype, 'initialize');

      const initialized = await initializeElectrumPool();

      expect(initialized).toBeDefined();
      expect(initSpy).toHaveBeenCalled();
    });
  });
});
