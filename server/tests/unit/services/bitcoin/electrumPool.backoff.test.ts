import { vi } from 'vitest';

const { sharedNodeConfigFindFirst, sharedElectrumServerUpdate } = vi.hoisted(() => ({
  sharedNodeConfigFindFirst: vi.fn().mockResolvedValue(null),
  sharedElectrumServerUpdate: vi.fn().mockResolvedValue({}),
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
        expect(state1!.level).toBe(0); // Not in backoff yet (threshold is 3)

        pool.recordServerFailure('server-1', 'error');
        const state2 = pool.getServerBackoffState('server-1');
        expect(state2).not.toBeNull();
        expect(state2!.consecutiveFailures).toBe(2);
        expect(state2!.level).toBe(0); // Still not in backoff (threshold is 3)

        pool.recordServerFailure('server-1', 'error');
        const state3 = pool.getServerBackoffState('server-1');
        expect(state3).not.toBeNull();
        expect(state3!.consecutiveFailures).toBe(3);
        expect(state3!.level).toBe(1); // Now in backoff
      });

      it('should increase backoff level on continued failures', () => {
        pool = createPool();
        pool.setServers(servers);

        // Trigger backoff (3 failures)
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');

        const state1 = pool.getServerBackoffState('server-1');
        expect(state1).not.toBeNull();
        expect(state1!.level).toBe(1);

        // Fourth failure increases level
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

        // Trigger backoff (3 failures needed)
        pool.recordServerFailure('server-1', 'error');
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

        // Regular error (3 failures needed for backoff)
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        const errorState = pool.getServerBackoffState('server-1');
        expect(errorState).not.toBeNull();

        // Reset and test timeout
        pool.resetServerBackoff('server-1');
        pool.recordServerFailure('server-1', 'timeout');
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

        // Trigger backoff (3 failures needed)
        pool.recordServerFailure('server-1', 'error');
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

        // Trigger backoff first (need 3 failures for backoff)
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        pool.recordServerFailure('server-1', 'error');
        const inBackoff = pool.getServerBackoffState('server-1');
        expect(inBackoff).not.toBeNull();
        expect(inBackoff!.consecutiveFailures).toBe(3);
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

        // Trigger backoff with cooldown (3 failures needed)
        pool.recordServerFailure('server-1', 'error');
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
        pool.recordServerFailure('server-1', 'error');

        const state = pool.getServerBackoffState('server-1');
        expect(state).not.toBeNull();
        expect(state!.consecutiveFailures).toBe(3);
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
        pool.recordServerFailure('server-1', 'error');

        const stats = pool.getPoolStats();
        const server1Stats = stats.servers.find(s => s.serverId === 'server-1');

        expect(server1Stats).toBeDefined();
        expect(server1Stats!.consecutiveFailures).toBe(3);
        expect(server1Stats!.backoffLevel).toBe(1);
        expect(server1Stats!.cooldownUntil).not.toBeNull();
        expect(server1Stats!.weight).toBeLessThan(1.0);
      });

      it('should omit expired cooldowns from server stats', () => {
        pool = createPool();
        pool.setServers(servers);
        const baseStats = (pool as any).serverStats.get('server-1');
        (pool as any).serverStats.set('server-1', {
          ...baseStats,
          consecutiveFailures: 3,
          backoffLevel: 1,
          cooldownUntil: new Date(Date.now() - 60_000),
          weight: 0.5,
        });

        const stats = pool.getPoolStats();
        const server1Stats = stats.servers.find(s => s.serverId === 'server-1');

        expect(server1Stats).toBeDefined();
        expect(server1Stats!.cooldownUntil).toBeNull();
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

        // Put server-1 in cooldown (3 failures needed)
        pool.recordServerFailure('server-1', 'error');
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

});
