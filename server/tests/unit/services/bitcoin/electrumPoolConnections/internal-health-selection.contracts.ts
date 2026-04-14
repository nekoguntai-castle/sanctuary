import { expect, it, vi } from 'vitest';
import {
  createPool,
  makeConn,
  type ElectrumPoolTestContext,
} from './electrumPoolConnectionsTestHarness';

export function registerElectrumPoolInternalHealthSelectionTests(context: ElectrumPoolTestContext): void {
    it('getSubscriptionConnection handles dead existing subscription and allocates a new one', async () => {
      context.pool = createPool({ enabled: true, maxConnections: 1, minConnections: 0 });
      (context.pool as any).isInitialized = true;
      const dead = makeConn({
        id: 'dead-sub',
        state: 'closed',
        client: { isConnected: vi.fn().mockReturnValue(false) },
      });
      (context.pool as any).connections.set(dead.id, dead);
      (context.pool as any).subscriptionConnectionId.value = dead.id;
      const created = makeConn({ id: 'new-sub', state: 'idle' });
      vi.spyOn(context.pool as any, 'createConnection').mockResolvedValue(created);
      vi.spyOn(context.pool as any, 'findIdleConnection').mockReturnValue(null);

      const client = await context.pool!.getSubscriptionConnection();
      expect(client).toBe(created.client);
      expect((context.pool as any).subscriptionConnectionId.value).toBe(created.id);
      expect(created.isDedicated).toBe(true);
    });

    it('reconnectConnection closes and removes connection after max attempts', async () => {
      context.pool = createPool({
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

      (context.pool as any).connections.set(conn.id, conn);
      (context.pool as any).subscriptionConnectionId.value = conn.id;

      const reconnectPromise = (context.pool as any).reconnectConnection(conn);
      await vi.runAllTimersAsync();
      await reconnectPromise;

      expect((context.pool as any).connections.has(conn.id)).toBe(false);
      expect((context.pool as any).subscriptionConnectionId.value).toBeNull();
      expect(conn.state).toBe('closed');
      vi.useRealTimers();
    });

    it('performHealthChecks records success/failure and invokes follow-up hooks', async () => {
      context.pool = createPool();
      context.pool!.setServers([
        { id: 'server-1', label: 'S1', host: 'a', port: 50001, useSsl: true, priority: 0, enabled: true },
        { id: 'server-2', label: 'S2', host: 'b', port: 50002, useSsl: true, priority: 1, enabled: true },
      ]);
      (context.pool as any).isShuttingDown = false;

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
      (context.pool as any).connections.set(successConn.id, successConn);
      (context.pool as any).connections.set(failConn.id, failConn);

      const reconnectSpy = vi.spyOn(context.pool as any, 'reconnectConnection').mockResolvedValue(undefined);
      const ensureSpy = vi.spyOn(context.pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      const exportSpy = vi.spyOn(context.pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (context.pool as any).performHealthChecks();

      expect(reconnectSpy).toHaveBeenCalledWith(failConn);
      expect(ensureSpy).toHaveBeenCalledTimes(1);
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });

    it('performHealthChecks routes disconnected non-dedicated connections to handleConnectionError', async () => {
      context.pool = createPool();
      context.pool!.setServers([
        { id: 'server-1', label: 'S1', host: 'a', port: 50001, useSsl: true, priority: 0, enabled: true },
      ]);
      (context.pool as any).isShuttingDown = false;

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
      (context.pool as any).connections.set(disconnected.id, disconnected);

      const handleSpy = vi.spyOn(context.pool as any, 'handleConnectionError').mockResolvedValue(undefined);
      const ensureSpy = vi.spyOn(context.pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      const exportSpy = vi.spyOn(context.pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (context.pool as any).performHealthChecks();

      expect(handleSpy).toHaveBeenCalledWith(disconnected);
      expect(ensureSpy).toHaveBeenCalledTimes(1);
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });

    it('sendKeepalives only pings idle non-dedicated connected clients', async () => {
      context.pool = createPool();
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

      (context.pool as any).connections.set(idleConn.id, idleConn);
      (context.pool as any).connections.set(activeConn.id, activeConn);
      (context.pool as any).connections.set(dedicatedConn.id, dedicatedConn);
      (context.pool as any).connections.set(disconnectedConn.id, disconnectedConn);

      await (context.pool as any).sendKeepalives();

      expect(idleConn.client.ping).toHaveBeenCalledTimes(1);
      expect(activeConn.client.ping).not.toHaveBeenCalled();
      expect(dedicatedConn.client.ping).not.toHaveBeenCalled();
      expect(disconnectedConn.client.ping).not.toHaveBeenCalled();
    });

    it('sendKeepalives returns early when shutting down', async () => {
      context.pool = createPool();
      (context.pool as any).isShuttingDown = true;
      const idleConn = makeConn({ id: 'idle-early', state: 'idle', isDedicated: false });
      (context.pool as any).connections.set(idleConn.id, idleConn);

      await (context.pool as any).sendKeepalives();
      expect(idleConn.client.ping).not.toHaveBeenCalled();
    });

    it('sendKeepalives swallows ping failures', async () => {
      context.pool = createPool();
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
      (context.pool as any).connections.set(idleConn.id, idleConn);

      await expect((context.pool as any).sendKeepalives()).resolves.toBeUndefined();
      expect(idleConn.client.ping).toHaveBeenCalledTimes(1);
    });

    it('cleanupIdleConnections removes stale idle connections but keeps dedicated ones', () => {
      context.pool = createPool({ minConnections: 1, idleTimeoutMs: 10 });
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

      (context.pool as any).connections.set(staleConn.id, staleConn);
      (context.pool as any).connections.set(dedicatedConn.id, dedicatedConn);

      (context.pool as any).cleanupIdleConnections();

      expect((context.pool as any).connections.has('stale')).toBe(false);
      expect((context.pool as any).connections.has('dedicated')).toBe(true);
      expect(staleConn.client.disconnect).toHaveBeenCalledTimes(1);
    });

    it('cleanupIdleConnections tolerates disconnect errors', () => {
      context.pool = createPool({ minConnections: 0, idleTimeoutMs: 10 });
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

      (context.pool as any).connections.set(staleConn.id, staleConn);
      (context.pool as any).cleanupIdleConnections();
      expect((context.pool as any).connections.has(staleConn.id)).toBe(false);
    });

    it('getSubscriptionConnection initializes pool when needed', async () => {
      context.pool = createPool();
      (context.pool as any).isInitialized = false;
      const initSpy = vi.spyOn(context.pool!, 'initialize').mockResolvedValue(undefined);
      const existing = makeConn({ id: 'sub-existing', state: 'idle' });
      (context.pool as any).connections.set(existing.id, existing);
      (context.pool as any).findIdleConnection = vi.fn().mockReturnValue(existing);

      const client = await context.pool!.getSubscriptionConnection();

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(client).toBe(existing.client);
    });

    it('getSubscriptionConnection single-mode reconnects or creates as needed', async () => {
      context.pool = createPool({ enabled: false });
      (context.pool as any).isInitialized = true;

      const disconnected = makeConn({
        id: 'single-sub',
        client: {
          isConnected: vi.fn().mockReturnValue(false),
          disconnect: vi.fn(),
          connect: vi.fn(),
          getServerVersion: vi.fn(),
        },
      });
      (context.pool as any).connections.set(disconnected.id, disconnected);
      const reconnectSpy = vi.spyOn(context.pool as any, 'reconnectConnection').mockResolvedValue(undefined);

      const first = await context.pool!.getSubscriptionConnection();
      expect(first).toBe(disconnected.client);
      expect(reconnectSpy).toHaveBeenCalledWith(disconnected);

      (context.pool as any).connections.clear();
      const created = makeConn({ id: 'single-sub-created' });
      vi.spyOn(context.pool as any, 'createConnection').mockImplementation(async () => {
        (context.pool as any).connections.set(created.id, created);
        return created;
      });
      const second = await context.pool!.getSubscriptionConnection();
      expect(second).toBe(created.client);
    });

    it('getSubscriptionConnection single-mode reuses an already connected existing connection', async () => {
      context.pool = createPool({ enabled: false });
      (context.pool as any).isInitialized = true;

      const connected = makeConn({
        id: 'single-sub-connected',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          disconnect: vi.fn(),
          connect: vi.fn(),
          getServerVersion: vi.fn(),
        },
      });
      (context.pool as any).connections.set(connected.id, connected);
      const reconnectSpy = vi.spyOn(context.pool as any, 'reconnectConnection').mockResolvedValue(undefined);
      const createSpy = vi.spyOn(context.pool as any, 'createConnection');

      const client = await context.pool!.getSubscriptionConnection();
      expect(client).toBe(connected.client);
      expect(reconnectSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('getSubscriptionConnection creates a new connection when no idle connection exists and capacity remains', async () => {
      context.pool = createPool({ enabled: true, minConnections: 0, maxConnections: 2 });
      (context.pool as any).isInitialized = true;

      const active = makeConn({ id: 'active-only', state: 'active' });
      (context.pool as any).connections.set(active.id, active);
      vi.spyOn(context.pool as any, 'findIdleConnection').mockReturnValue(null);

      const created = makeConn({ id: 'new-sub-capacity', state: 'idle' });
      const createSpy = vi.spyOn(context.pool as any, 'createConnection').mockResolvedValue(created);

      const client = await context.pool!.getSubscriptionConnection();
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(client).toBe(created.client);
      expect((context.pool as any).subscriptionConnectionId.value).toBe(created.id);
    });

    it('single-mode handle withClient returns callback result', async () => {
      context.pool = createPool({ enabled: false });
      (context.pool as any).isInitialized = true;
      const conn = makeConn({ id: 'single-with-client' });
      (context.pool as any).connections.set(conn.id, conn);

      const handle = await (context.pool as any).acquireInternal();
      const result = await handle.withClient(async (client) => {
        expect(client).toBe(conn.client);
        return 'ok';
      });

      expect(result).toBe('ok');
    });

    it('processWaitingQueue assigns idle connections to waiting requests', async () => {
      context.pool = createPool();
      const idle = makeConn({ id: 'idle-queue', state: 'idle' });
      (context.pool as any).connections.set(idle.id, idle);
      const resolve = vi.fn();
      const reject = vi.fn();
      const timeoutId = setTimeout(() => undefined, 1000);
      (context.pool as any).waitingQueue.push({
        resolve,
        reject,
        timeoutId,
        purpose: 'test-purpose',
        startTime: Date.now(),
      });

      (context.pool as any).processWaitingQueue();

      expect(resolve).toHaveBeenCalledTimes(1);
      clearTimeout(timeoutId);
    });

    it('processWaitingQueue returns when no idle connection exists', () => {
      context.pool = createPool();
      const resolve = vi.fn();
      const reject = vi.fn();
      const timeoutId = setTimeout(() => undefined, 1000);
      (context.pool as any).waitingQueue.push({
        resolve,
        reject,
        timeoutId,
        purpose: 'test-purpose',
        startTime: Date.now(),
      });

      (context.pool as any).processWaitingQueue();

      expect(resolve).not.toHaveBeenCalled();
      clearTimeout(timeoutId);
    });

    it('processWaitingQueue tolerates races where queue shift returns undefined', () => {
      context.pool = createPool();
      const idle = makeConn({ id: 'idle-race', state: 'idle' });
      (context.pool as any).connections.set(idle.id, idle);
      const timeoutId = setTimeout(() => undefined, 1000);
      (context.pool as any).waitingQueue.push({
        resolve: vi.fn(),
        reject: vi.fn(),
        timeoutId,
        purpose: 'race',
        startTime: Date.now(),
      });
      const shiftSpy = vi.spyOn((context.pool as any).waitingQueue, 'shift').mockReturnValueOnce(undefined as any);

      (context.pool as any).processWaitingQueue();

      expect(shiftSpy).toHaveBeenCalled();
      shiftSpy.mockRestore();
      clearTimeout(timeoutId);
    });

    it('selectServer handles cooldown fallback and load balancing branches', () => {
      context.pool = createPool({ loadBalancing: 'least_connections' });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true, supportsVerbose: true },
      ]);

      const now = Date.now();
      const stats1 = (context.pool as any).serverStats.get('s1');
      const stats2 = (context.pool as any).serverStats.get('s2');
      stats1.cooldownUntil = new Date(now + 10_000);
      stats2.cooldownUntil = new Date(now + 20_000);
      stats1.isHealthy = true;
      stats2.isHealthy = true;

      const cooldownFallback = (context.pool as any).selectServer();
      expect(cooldownFallback.id).toBe('s1');

      stats1.cooldownUntil = null;
      stats2.cooldownUntil = null;
      const leastConn = (context.pool as any).selectServer();
      expect(['s1', 's2']).toContain(leastConn.id);

      (context.pool as any).config.loadBalancing = 'failover_only';
      const failover = (context.pool as any).selectServer();
      expect(failover.id).toBe('s1');
    });

    it('selectServer least_connections accounts for currently active per-server connections', () => {
      context.pool = createPool({ loadBalancing: 'least_connections' });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      // One active connection on s1, none on s2
      (context.pool as any).connections.set('active-s1', makeConn({ id: 'active-s1', serverId: 's1', state: 'active' }));
      (context.pool as any).connections.set('idle-s2', makeConn({ id: 'idle-s2', serverId: 's2', state: 'idle' }));

      const selected = (context.pool as any).selectServer();
      expect(selected.id).toBe('s2');
    });

    it('selectServer falls back to first enabled server when all enabled are unhealthy', () => {
      context.pool = createPool({ loadBalancing: 'least_connections' });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      (context.pool as any).serverStats.get('s1').isHealthy = false;
      (context.pool as any).serverStats.get('s2').isHealthy = false;

      const selected = (context.pool as any).selectServer();
      expect(selected?.id).toBe('s1');
    });

    it('selectServer handles disabled servers and missing stats under least-connections strategy', () => {
      context.pool = createPool({ loadBalancing: 'least_connections' });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: false },
        { id: 's3', label: 'S3', host: 'c', port: 3, useSsl: true, priority: 2, enabled: true },
      ]);

      (context.pool as any).serverStats.delete('s1');
      (context.pool as any).connections.set('active-s3-a', makeConn({ id: 'active-s3-a', serverId: 's3', state: 'active' }));
      (context.pool as any).connections.set('active-s3-b', makeConn({ id: 'active-s3-b', serverId: 's3', state: 'active' }));

      const selected = (context.pool as any).selectServer();
      expect(selected.id).toBe('s1');
    });

    it('selectServer skips explicitly disabled servers when present in internal server list', () => {
      context.pool = createPool({ loadBalancing: 'failover_only' });
      (context.pool as any).servers = [
        { id: 'disabled-internal', label: 'Disabled', host: 'd', port: 1, useSsl: true, priority: 0, enabled: false },
        { id: 'enabled-internal', label: 'Enabled', host: 'e', port: 2, useSsl: true, priority: 1, enabled: true },
      ];
      (context.pool as any).serverStats.set('enabled-internal', {
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

      const selected = (context.pool as any).selectServer();
      expect(selected?.id).toBe('enabled-internal');
    });

    it('selectServer cooldown sort falls back to zero when cooldown metadata is missing during ranking', () => {
      context.pool = createPool({ loadBalancing: 'least_connections' });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      const now = Date.now();
      (context.pool as any).serverStats.get('s1').isHealthy = true;
      (context.pool as any).serverStats.get('s2').isHealthy = true;
      (context.pool as any).serverStats.get('s1').cooldownUntil = new Date(now + 5_000);
      (context.pool as any).serverStats.get('s2').cooldownUntil = new Date(now + 10_000);

      const statsMap = (context.pool as any).serverStats as Map<string, any>;
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
        const selected = (context.pool as any).selectServer();
        expect(selected).toBeDefined();
      } finally {
        getSpy.mockRestore();
      }
    });

    it('selectServer round-robin path tolerates servers without stats weight entries', () => {
      context.pool = createPool({ loadBalancing: 'round_robin' });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (context.pool as any).serverStats.delete('s2');

      const selected = (context.pool as any).selectServer();
      expect(['s1', 's2']).toContain(selected.id);
    });

    it('selectWeightedRoundRobin falls back to last server when cumulative selection never matches', () => {
      context.pool = createPool({ loadBalancing: 'round_robin' });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);

      // Force NaN weight math so point < cumulative never matches, exercising fallback branch.
      (context.pool as any).serverStats.get('s1').weight = Number.NaN;
      (context.pool as any).serverStats.get('s2').weight = Number.NaN;

      const selected = (context.pool as any).selectServer();
      expect(selected.id).toBe('s2');
    });

    it('ensureMinimumConnections handles both successful and failed server connection creation', async () => {
      context.pool = createPool({ enabled: true });
      context.pool!.setServers([
        { id: 's1', label: 'Server 1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'Server 2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (context.pool as any).isShuttingDown = false;
      (context.pool as any).connections.clear();

      const createSpy = vi.spyOn(context.pool as any, 'createConnection')
        .mockResolvedValueOnce(makeConn({ id: 'created-s1', serverId: 's1' }))
        .mockRejectedValueOnce(new Error('cannot connect s2'));

      await (context.pool as any).ensureMinimumConnections();

      expect(createSpy).toHaveBeenCalledTimes(2);
      const s1Stats = (context.pool as any).serverStats.get('s1');
      const s2Stats = (context.pool as any).serverStats.get('s2');
      expect(s1Stats.isHealthy).toBe(true);
      expect(s2Stats.isHealthy).toBe(false);
    });

    it('ensureMinimumConnections returns early when pool is disabled', async () => {
      context.pool = createPool({ enabled: false });
      context.pool!.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);
      const createSpy = vi.spyOn(context.pool as any, 'createConnection').mockResolvedValue(makeConn({ id: 'unused' }));

      await (context.pool as any).ensureMinimumConnections();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('ensureMinimumConnections counts only non-closed connections', async () => {
      context.pool = createPool({ enabled: true });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (context.pool as any).isShuttingDown = false;

      const s1Idle = makeConn({ id: 's1-idle', serverId: 's1', state: 'idle' });
      const s1Closed = makeConn({ id: 's1-closed', serverId: 's1', state: 'closed' });
      (context.pool as any).connections.set(s1Idle.id, s1Idle);
      (context.pool as any).connections.set(s1Closed.id, s1Closed);

      const createSpy = vi.spyOn(context.pool as any, 'createConnection').mockResolvedValue(makeConn({ id: 'created-s2', serverId: 's2' }));
      await (context.pool as any).ensureMinimumConnections();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));
    });

    it('ensureMinimumConnections skips health-stat updates when server stats are missing', async () => {
      context.pool = createPool({ enabled: true });
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
        { id: 's2', label: 'S2', host: 'b', port: 2, useSsl: true, priority: 1, enabled: true },
      ]);
      (context.pool as any).serverStats.delete('s1');
      (context.pool as any).serverStats.delete('s2');

      const createSpy = vi.spyOn(context.pool as any, 'createConnection')
        .mockResolvedValueOnce(makeConn({ id: 'created-s1', serverId: 's1' }))
        .mockRejectedValueOnce(new Error('cannot connect s2'));

      await (context.pool as any).ensureMinimumConnections();

      expect(createSpy).toHaveBeenCalledTimes(2);
    });
}
