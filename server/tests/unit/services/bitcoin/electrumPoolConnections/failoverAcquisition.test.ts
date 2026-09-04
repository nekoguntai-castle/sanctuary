/**
 * Failover-aware acquisition regression suite (dashboard-network-status-card
 * A1/A2). Locks the desired behaviour: under `failover_only`, idle-socket
 * acquisition and queue draining must target the canonically-ordered
 * eligible primary rather than an idle backup socket, while round_robin and
 * least_connections keep the pre-existing first-idle behaviour.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPool,
  createTestServers,
  makeConn,
  setupElectrumPoolConnectionTestHooks,
  type ElectrumPoolTestContext,
} from './electrumPoolConnectionsTestHarness';
import { nodeConfigRepository } from '../../../../../src/repositories';
import {
  compareServerOrder,
  sortServersCanonically,
  selectFailoverServer,
} from '../../../../../src/services/bitcoin/electrumPool/serverSelector';
import { evictIdleConnectionForFailoverTarget } from '../../../../../src/services/bitcoin/electrumPool/connectionManager';
import type { ServerState } from '../../../../../src/services/bitcoin/electrumPool/types';

const healthyState = (overrides: Partial<ServerState> = {}): ServerState => ({
  totalRequests: 0,
  failedRequests: 0,
  lastHealthCheck: new Date(),
  isHealthy: true,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  backoffLevel: 0,
  cooldownUntil: null,
  weight: 1.0,
  healthHistory: [],
  ...overrides,
});

describe('ElectrumPool failover-aware acquisition', () => {
  const context: ElectrumPoolTestContext = {};
  setupElectrumPoolConnectionTestHooks(context);

  describe('A1: raw activeConnections vs socket presence', () => {
    it('counts only borrowed sockets as active while idle healthy sockets remain available', async () => {
      const pool = createPool({ loadBalancing: 'round_robin' });
      context.pool = pool;
      pool.setServers(createTestServers(3));
      (pool as any).isInitialized = true;
      for (const s of ['server-1', 'server-2', 'server-3']) {
        (pool as any).serverStats.set(s, healthyState());
      }
      for (const s of ['server-1', 'server-2', 'server-3']) {
        (pool as any).connections.set(`idle-${s}`, makeConn({ id: `idle-${s}`, serverId: s, state: 'idle' }));
      }

      const before = pool.getPoolStats();
      expect(before.activeConnections).toBe(0);
      expect(before.totalConnections).toBe(3);

      const handle = await pool.acquire();
      const after = pool.getPoolStats();
      expect(after.activeConnections).toBe(1);
      expect(after.idleConnections).toBe(2);
      expect(after.totalConnections).toBe(3);

      handle.release();
      expect(pool.getPoolStats().activeConnections).toBe(0);
    });
  });

  describe('A1/A2: failover_only idle-socket targeting', () => {
    it('picks the primary socket even when a backup socket was inserted first', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 5 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      // Backup's idle socket inserted before the primary's.
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));
      (pool as any).connections.set('primary-idle', makeConn({ id: 'primary-idle', serverId: 's1', state: 'idle' }));

      const handle = await pool.acquire();
      const primaryConn = (pool as any).connections.get('primary-idle');
      expect(primaryConn.state).toBe('active');
      const backupConn = (pool as any).connections.get('backup-idle');
      expect(backupConn.state).toBe('idle');
      handle.release();
    });

    it('creates a new primary connection when the primary is busy and capacity remains, never spilling to an idle backup', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 5 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));

      const handle = await pool.acquire();
      const backupConn = (pool as any).connections.get('backup-idle');
      expect(backupConn.state).toBe('idle');

      const newActiveEntries = [...(pool as any).connections.values()].filter(
        (c: any) => c.state === 'active' && c.serverId === 's1',
      );
      expect(newActiveEntries).toHaveLength(2);
      handle.release();
    });

    it('queues rather than spilling to a busy backup once at capacity', async () => {
      // No idle backup socket exists here (backup-active is busy), so the
      // at-capacity eviction path (starvation fix, tested separately below)
      // finds nothing to evict and this genuinely queues.
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-active', makeConn({ id: 'backup-active', serverId: 's2', state: 'active' }));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      const backupConn = (pool as any).connections.get('backup-active');
      expect(backupConn.state).toBe('active');

      // Clean up: release the primary so the queued promise settles.
      const primaryActive = (pool as any).connections.get('primary-active');
      primaryActive.state = 'idle';
      (pool as any).processWaitingQueue();
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });
  });

  describe('A1/A2: queued failover drain re-evaluates target', () => {
    it('does not drain a queued request via a backup release while the primary remains eligible', async () => {
      // Backup starts busy (not idle) so the acquire below genuinely queues
      // rather than being served immediately by the at-capacity eviction path.
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-active', makeConn({ id: 'backup-active', serverId: 's2', state: 'active' }));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));
      expect(pool.getPoolStats().waitingRequests).toBe(1);

      // A backup release must not drain the queue while the primary is eligible.
      (pool as any).connections.get('backup-active').state = 'idle';
      (pool as any).processWaitingQueue();
      await new Promise((r) => setImmediate(r));
      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);

      // Releasing the primary does drain it.
      (pool as any).connections.get('primary-active').state = 'idle';
      (pool as any).processWaitingQueue();
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });

    it('drains a queued request via backup only after the primary becomes ineligible before drain', async () => {
      // Backup starts busy so the acquire genuinely queues instead of being
      // served immediately by the at-capacity eviction path.
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-active', makeConn({ id: 'backup-active', serverId: 's2', state: 'active' }));

      const pending = pool.acquire({ timeoutMs: 5000 });
      await new Promise((r) => setImmediate(r));
      expect(pool.getPoolStats().waitingRequests).toBe(1);

      // Primary becomes ineligible (offline) and its backup frees up before drain.
      (pool as any).serverStats.get('s1').isHealthy = false;
      (pool as any).connections.get('backup-active').state = 'idle';
      (pool as any).processWaitingQueue();

      const handle = await pending;
      expect(handle).toBeDefined();
      const backupConn = (pool as any).connections.get('backup-active');
      expect(backupConn.state).toBe('active');
      handle.release();
    });
  });

  describe('A1: failover transition lifecycle without pool restart', () => {
    it('primary healthy -> cooldown -> backup selected -> primary recovered -> primary selected again', () => {
      const pool = createPool({ loadBalancing: 'failover_only' });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());

      expect((pool as any).selectServer().id).toBe('s1');

      (pool as any).serverStats.get('s1').cooldownUntil = new Date(Date.now() + 60_000);
      expect((pool as any).selectServer().id).toBe('s2');

      (pool as any).serverStats.get('s1').isHealthy = false;
      (pool as any).serverStats.get('s1').cooldownUntil = null;
      expect((pool as any).selectServer().id).toBe('s2');

      (pool as any).serverStats.get('s1').isHealthy = true;
      expect((pool as any).selectServer().id).toBe('s1');
    });

    it('skips an ineligible server and preserves the documented all-unhealthy fallback', () => {
      const pool = createPool({ loadBalancing: 'failover_only' });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
        { id: 's3', label: 'Tertiary', host: 'c', port: 3, useSsl: true, priority: 2, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState({ isHealthy: false }));
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).serverStats.set('s3', healthyState());

      expect((pool as any).selectServer().id).toBe('s2');

      (pool as any).serverStats.get('s2').isHealthy = false;
      (pool as any).serverStats.get('s3').isHealthy = false;
      // All unhealthy: falls back to first enabled server without treating it as online.
      expect((pool as any).selectServer().id).toBe('s1');
    });
  });

  describe('A2: equal-priority deterministic ordering', () => {
    it('drives runtime acquisition, primary id, and next-failover id by (priority, serverId)', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 5 });
      context.pool = pool;
      // Equal priority; canonical order must be by id: server-a before server-b.
      pool.setServers([
        { id: 'server-b', label: 'B', host: 'b', port: 2, useSsl: true, priority: 0, enabled: true },
        { id: 'server-a', label: 'A', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('server-a', healthyState());
      (pool as any).serverStats.set('server-b', healthyState());

      expect((pool as any).servers.map((s: any) => s.id)).toEqual(['server-a', 'server-b']);
      expect((pool as any).selectServer().id).toBe('server-a');

      expect(sortServersCanonically((pool as any).servers)[0].id).toBe('server-a');
      expect(selectFailoverServer((pool as any).servers, (pool as any).serverStats, Date.now())?.id).toBe('server-a');
      expect(
        selectFailoverServer((pool as any).servers, (pool as any).serverStats, Date.now(), 'server-a')?.id,
      ).toBe('server-b');

      (pool as any).connections.set('idle-b', makeConn({ id: 'idle-b', serverId: 'server-b', state: 'idle' }));
      const handle = await pool.acquire();
      const activeB = [...(pool as any).connections.values()].find((c: any) => c.serverId === 'server-b');
      expect(activeB.state).toBe('idle');
      const activeA = [...(pool as any).connections.values()].find((c: any) => c.serverId === 'server-a');
      expect(activeA).toBeDefined();
      expect(activeA.state).toBe('active');
      handle.release();
    });
  });

  describe('A1: round-robin and least-connections acquisition unchanged', () => {
    it('round_robin still grabs the first idle connection regardless of priority order', async () => {
      const pool = createPool({ loadBalancing: 'round_robin', maxConnections: 5 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('idle-s2', makeConn({ id: 'idle-s2', serverId: 's2', state: 'idle' }));

      const handle = await pool.acquire();
      const conn = (pool as any).connections.get('idle-s2');
      expect(conn.state).toBe('active');
      handle.release();
    });

    it('least_connections still grabs the first idle connection regardless of priority order', async () => {
      const pool = createPool({ loadBalancing: 'least_connections', maxConnections: 5 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('idle-s2', makeConn({ id: 'idle-s2', serverId: 's2', state: 'idle' }));

      const handle = await pool.acquire();
      const conn = (pool as any).connections.get('idle-s2');
      expect(conn.state).toBe('active');
      handle.release();
    });
  });

  describe('A2: getOperationalConfigSnapshot', () => {
    it('reflects live pool configuration', () => {
      const pool = createPool({
        loadBalancing: 'failover_only',
        healthCheckIntervalMs: 12345,
        enabled: true,
      });
      context.pool = pool;
      expect(pool.getOperationalConfigSnapshot()).toEqual({
        loadBalancing: 'failover_only',
        healthCheckIntervalMs: 12345,
        enabled: true,
      });
    });
  });

  describe('A2: pure selector helpers', () => {
    it('compareServerOrder and sortServersCanonically order by (priority, serverId)', () => {
      const list = [
        { id: 'z', priority: 1 },
        { id: 'b', priority: 0 },
        { id: 'a', priority: 0 },
      ] as any[];
      expect(sortServersCanonically(list).map((s) => s.id)).toEqual(['a', 'b', 'z']);
      expect(compareServerOrder(list[1], list[2])).toBeGreaterThan(0);
      expect(compareServerOrder({ id: 's', priority: 0 } as any, { id: 's', priority: 0 } as any)).toBe(0);
    });

    it('selectFailoverServer never mutates roundRobinIndex-shaped state and honors exclusion', () => {
      const list = [
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ];
      const stats = new Map<string, ServerState>([
        ['s1', healthyState()],
        ['s2', healthyState()],
      ]);
      expect(selectFailoverServer(list, stats, Date.now())?.id).toBe('s1');
      expect(selectFailoverServer(list, stats, Date.now(), 's1')?.id).toBe('s2');
    });
  });

  describe('A2 gap-fix: unreachable failover-target connect failure reroutes instead of starving the queue', () => {
    const twoServerSetup = (maxConnections: number) => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections });
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      return pool;
    };

    it('resolves on the backup once the primary has become ineligible from the recorded failure, when a backup idle socket is already available', async () => {
      const pool = twoServerSetup(5);
      context.pool = pool;
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('primary host unreachable'));

      const handle = await pool.acquire({ timeoutMs: 5000 });
      expect(handle).toBeDefined();
      expect((pool as any).connections.get('backup-idle').state).toBe('active');
      expect((pool as any).serverStats.get('s1').isHealthy).toBe(false);
      expect((pool as any).serverStats.get('s1').consecutiveFailures).toBe(1);
      handle.release();
    });

    it('queues (does not throw, does not starve) on the first failed attempt when no immediate alternative exists yet', async () => {
      // Single-server pool: there is no backup to reroute to at all, so a
      // failed primary connect attempt must still queue rather than reject
      // outright or spin. This documents the "before an alternative is
      // actually available" queueing behaviour the reroute logic falls
      // back to.
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 5 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('primary host unreachable'));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      // The failure was still recorded even though there was nowhere to reroute to.
      expect((pool as any).serverStats.get('s1').isHealthy).toBe(false);
      expect((pool as any).serverStats.get('s1').consecutiveFailures).toBe(1);

      // Clean up the still-queued request so it doesn't leak a timer.
      const waiting = (pool as any).waitingQueue[0];
      clearTimeout(waiting.timeoutId);
      (pool as any).waitingQueue = [];
      waiting.reject(new Error('test cleanup'));
      await pending.catch(() => {});
    });

    it('a busy-but-healthy primary still never spills to a busy backup (no connect failure occurs, reroute never engages)', async () => {
      // Backup starts busy (not idle), so the at-capacity eviction path
      // (starvation fix, tested separately) finds nothing to evict and
      // createConnection is never attempted here.
      const pool = twoServerSetup(2);
      context.pool = pool;
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-active', makeConn({ id: 'backup-active', serverId: 's2', state: 'active' }));
      const createConnectionSpy = vi.spyOn(pool as any, 'createConnection');

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      // At capacity with no idle backup to evict, createConnection is never
      // attempted, so the failure-reroute path never engages either.
      expect(createConnectionSpy).not.toHaveBeenCalled();
      expect(resolved).toBe(false);
      expect((pool as any).connections.get('backup-active').state).toBe('active');

      (pool as any).connections.get('primary-active').state = 'idle';
      (pool as any).processWaitingQueue();
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });

    it('does not double-count: a later ensureMinimumConnections pass records its own independent failure rather than duplicating the acquire-time one', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 5 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      const recordFailureSpy = vi.spyOn(pool, 'recordServerFailure');
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('primary host unreachable'));

      const pending = pool.acquire({ timeoutMs: 5000 });
      await new Promise((r) => setImmediate(r));
      expect(recordFailureSpy).toHaveBeenCalledTimes(1);
      expect((pool as any).serverStats.get('s1').consecutiveFailures).toBe(1);

      // Clean up the queued request from the acquire-time failure.
      const waiting = (pool as any).waitingQueue[0];
      clearTimeout(waiting.timeoutId);
      (pool as any).waitingQueue = [];
      waiting.reject(new Error('test cleanup'));
      await pending.catch(() => {});

      // A later, independent ensureMinimumConnections pass fails again for
      // the same server: this must add exactly one more failure, not
      // replay or double the earlier one.
      await (pool as any).ensureMinimumConnections();
      expect(recordFailureSpy).toHaveBeenCalledTimes(2);
      expect((pool as any).serverStats.get('s1').consecutiveFailures).toBe(2);
    });

    it('queues when the revised target has no idle socket to hand out yet', async () => {
      const pool = twoServerSetup(5);
      context.pool = pool;
      // No sockets at all for either server yet.
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('primary host unreachable'));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      expect((pool as any).serverStats.get('s1').isHealthy).toBe(false);

      const waiting = (pool as any).waitingQueue[0];
      clearTimeout(waiting.timeoutId);
      (pool as any).waitingQueue = [];
      waiting.reject(new Error('test cleanup'));
      await pending.catch(() => {});
    });

    it('logs and does not crash when persisting the failure to the database fails', async () => {
      const pool = twoServerSetup(5);
      context.pool = pool;
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('primary host unreachable'));
      const updateHealthSpy = vi
        .spyOn(nodeConfigRepository.electrumServer, 'updateHealth')
        .mockRejectedValueOnce(new Error('db unavailable'));

      const handle = await pool.acquire({ timeoutMs: 5000 });
      expect(handle).toBeDefined();
      expect((pool as any).connections.get('backup-idle').state).toBe('active');
      expect(updateHealthSpy).toHaveBeenCalledTimes(1);
      handle.release();
    });

    it('does not throw when the failed target has no serverStats entry (defensive branch)', async () => {
      const pool = twoServerSetup(5);
      context.pool = pool;
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));
      // Simulate a server present in `this.servers` (via setServers) whose
      // stats entry was removed out-of-band -- recordFailoverTargetConnectFailure
      // must not assume the entry exists (it guards with `if (stats)`).
      // With no stats entry, `isServerAvailable` treats s1 as still
      // "available" (missing stats -> available, matching
      // createDefaultServerState() semantics), so the revised target stays
      // s1 and the request queues rather than rerouting to the backup --
      // the point of this test is that recording the failure itself never
      // throws, not that it reroutes.
      (pool as any).serverStats.delete('s1');
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('primary host unreachable'));

      let rejected: unknown;
      const pending = pool.acquire({ timeoutMs: 50 }).catch((error) => {
        rejected = error;
      });
      await new Promise((r) => setImmediate(r));

      expect(() => (pool as any).serverStats.get('s1')).not.toThrow();
      expect((pool as any).serverStats.has('s1')).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);

      await pending;
      expect(rejected).toBeInstanceOf(Error);
    });
  });

  describe('starvation fix: evict idle backup at capacity instead of queueing', () => {
    it('evicts the idle backup socket and creates the primary connection when at effective capacity', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));

      const handle = await pool.acquire({ timeoutMs: 5000 });

      expect(handle).toBeDefined();
      expect((pool as any).connections.has('backup-idle')).toBe(false);
      const primaryConns = [...(pool as any).connections.values()].filter((c: any) => c.serverId === 's1');
      expect(primaryConns).toHaveLength(2);
      expect(primaryConns.some((c: any) => c.state === 'active' && c.id !== 'primary-active')).toBe(true);
      handle.release();
    });

    it('still queues at capacity when the only backup socket is active (not idle)', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-active', makeConn({ id: 'backup-active', serverId: 's2', state: 'active' }));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      expect((pool as any).connections.has('backup-active')).toBe(true);

      const primaryActive = (pool as any).connections.get('primary-active');
      primaryActive.state = 'idle';
      (pool as any).processWaitingQueue();
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });

    it('never evicts the dedicated subscription connection to free capacity', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set(
        'backup-dedicated',
        makeConn({ id: 'backup-dedicated', serverId: 's2', state: 'idle', isDedicated: true }),
      );

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      expect((pool as any).connections.has('backup-dedicated')).toBe(true);

      const primaryActive = (pool as any).connections.get('primary-active');
      primaryActive.state = 'idle';
      (pool as any).processWaitingQueue();
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });

    it('round_robin at capacity queues rather than evicting an idle socket to another server', async () => {
      const pool = createPool({ loadBalancing: 'round_robin', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      // Both connections busy: round_robin's idle search happens up front, so
      // this exercises the at-capacity branch without an eviction path.
      (pool as any).connections.set('c1', makeConn({ id: 'c1', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('c2', makeConn({ id: 'c2', serverId: 's2', state: 'active' }));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      expect((pool as any).connections.size).toBe(2);

      (pool as any).connections.get('c1').state = 'idle';
      (pool as any).processWaitingQueue();
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });

    it('least_connections at capacity queues rather than evicting an idle socket to another server', async () => {
      const pool = createPool({ loadBalancing: 'least_connections', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('c1', makeConn({ id: 'c1', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('c2', makeConn({ id: 'c2', serverId: 's2', state: 'active' }));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      expect((pool as any).connections.size).toBe(2);

      (pool as any).connections.get('c2').state = 'idle';
      (pool as any).processWaitingQueue();
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });

    it('evictIdleConnectionForFailoverTarget skips an idle target-server connection and evicts the next idle backup', () => {
      const connections = new Map<string, ReturnType<typeof makeConn>>([
        ['target-idle', makeConn({ id: 'target-idle', serverId: 's1', state: 'idle' })],
        ['backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' })],
      ]);

      const evicted = evictIdleConnectionForFailoverTarget(connections as any, 's1');

      expect(evicted).toBe(true);
      expect(connections.has('target-idle')).toBe(true);
      expect(connections.has('backup-idle')).toBe(false);
    });

    it('rethrows without rerouting when the pool is shutting down after create fails post-eviction', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));
      vi.spyOn(pool as any, 'createConnection').mockImplementation(async () => {
        (pool as any).isShuttingDown = true;
        throw new Error('shutting down mid-create');
      });

      await expect(pool.acquire({ timeoutMs: 5000 })).rejects.toThrow('shutting down mid-create');
    });

    it('falls into the existing failure/reroute handling when create fails after eviction', async () => {
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-idle', makeConn({ id: 'backup-idle', serverId: 's2', state: 'idle' }));
      vi.spyOn(pool as any, 'createConnection').mockRejectedValue(new Error('primary host unreachable'));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));

      // The backup socket was evicted to attempt the primary create, which
      // failed; with no other idle alternative the request must queue, and
      // the failure must have been recorded via the existing reroute path.
      expect((pool as any).connections.has('backup-idle')).toBe(false);
      expect(resolved).toBe(false);
      expect(pool.getPoolStats().waitingRequests).toBe(1);
      expect((pool as any).serverStats.get('s1').isHealthy).toBe(false);

      const waiting = (pool as any).waitingQueue[0];
      clearTimeout(waiting.timeoutId);
      (pool as any).waitingQueue = [];
      waiting.reject(new Error('test cleanup'));
      await pending.catch(() => {});
    });
  });

  describe('connection-loss wake path targets the failover server', () => {
    it('restores capacity on the eligible primary (createConnection called with the primary), not the backup', async () => {
      // Effective max is at least the server count (2), so both sockets
      // must be occupied to be genuinely at capacity.
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-active', makeConn({ id: 'backup-active', serverId: 's2', state: 'active' }));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));
      expect(pool.getPoolStats().waitingRequests).toBe(1);

      // Primary connection is lost (e.g. socket error) but the server
      // itself stays eligible.
      (pool as any).connections.delete('primary-active');
      const createConnectionSpy = vi
        .spyOn(pool as any, 'createConnection')
        .mockImplementation(async (server?: any) => {
          const conn = makeConn({ id: 'restored', serverId: server?.id ?? 'default', state: 'idle' });
          (pool as any).connections.set(conn.id, conn);
          return conn;
        });

      await (pool as any).wakeWaitingRequestsAfterConnectionLoss();

      expect(createConnectionSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });

    it('restores capacity on the backup once the primary has become ineligible', async () => {
      // Effective max is at least the server count (2), so both sockets
      // must be occupied to be genuinely at capacity.
      const pool = createPool({ loadBalancing: 'failover_only', maxConnections: 2 });
      context.pool = pool;
      pool.setServers([
        { id: 's1', label: 'Primary', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Backup', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (pool as any).isInitialized = true;
      (pool as any).serverStats.set('s1', healthyState());
      (pool as any).serverStats.set('s2', healthyState());
      (pool as any).connections.set('primary-active', makeConn({ id: 'primary-active', serverId: 's1', state: 'active' }));
      (pool as any).connections.set('backup-active', makeConn({ id: 'backup-active', serverId: 's2', state: 'active' }));

      let resolved = false;
      const pending = pool.acquire({ timeoutMs: 5000 }).then((h) => {
        resolved = true;
        return h;
      });
      await new Promise((r) => setImmediate(r));
      expect(pool.getPoolStats().waitingRequests).toBe(1);

      // Primary connection is lost and, unlike the sibling test, the
      // primary server itself has also become ineligible before the wake.
      (pool as any).connections.delete('primary-active');
      (pool as any).serverStats.get('s1').isHealthy = false;

      const createConnectionSpy = vi
        .spyOn(pool as any, 'createConnection')
        .mockImplementation(async (server?: any) => {
          const conn = makeConn({ id: 'restored', serverId: server?.id ?? 'default', state: 'idle' });
          (pool as any).connections.set(conn.id, conn);
          return conn;
        });

      await (pool as any).wakeWaitingRequestsAfterConnectionLoss();

      expect(createConnectionSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));
      const handle = await pending;
      expect(resolved).toBe(true);
      handle.release();
    });
  });
});
