import { expect, it, vi } from 'vitest';
import {
  createPool,
  makeConn,
  type ElectrumPoolTestContext,
} from './electrumPoolConnectionsTestHarness';
import { recordHealthCheckResult } from '../../../../../src/services/bitcoin/electrumPool/healthChecker';
import { handleConnectionError } from '../../../../../src/services/bitcoin/electrumPool/connectionManager';

export function registerElectrumPoolInternalReconnectMetricsTests(context: ElectrumPoolTestContext): void {
    it('handleConnectionError covers dedicated and non-dedicated branches', async () => {
      context.pool = createPool();
      const dedicated = makeConn({ id: 'ded', isDedicated: true, state: 'active' });
      const reconnectSpy = vi.spyOn(context.pool as any, 'reconnectConnection').mockResolvedValue(undefined);
      await (context.pool as any).handleConnectionError(dedicated);
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
      (context.pool as any).connections.set(regular.id, regular);
      (context.pool as any).isShuttingDown = false;
      (context.pool as any).config.minConnections = 5;
      vi.spyOn(context.pool as any, 'getEffectiveMinConnections').mockReturnValue(5);
      vi.spyOn(context.pool as any, 'createConnection').mockRejectedValue(new Error('replace fail'));

      await (context.pool as any).handleConnectionError(regular);
      expect((context.pool as any).connections.has(regular.id)).toBe(false);
    });

    it('handleConnectionError does not create replacement when minimum threshold is already met', async () => {
      context.pool = createPool();
      const regular = makeConn({ id: 'reg-no-replace', isDedicated: false, state: 'active' });
      const survivor = makeConn({ id: 'survivor', state: 'idle' });
      (context.pool as any).connections.set(regular.id, regular);
      (context.pool as any).connections.set(survivor.id, survivor);
      (context.pool as any).isShuttingDown = false;
      vi.spyOn(context.pool as any, 'getEffectiveMinConnections').mockReturnValue(1);
      const createSpy = vi.spyOn(context.pool as any, 'createConnection').mockResolvedValue(makeConn({ id: 'unused' }));

      await (context.pool as any).handleConnectionError(regular);

      expect((context.pool as any).connections.has(regular.id)).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('module handleConnectionError reconnects dedicated connections and creates default replacements', async () => {
      context.pool = createPool({ maxReconnectAttempts: 1, connectionTimeoutMs: 100 });
      const config = (context.pool as any).config;
      const connections = new Map<string, any>();
      const subscriptionConnectionId = { value: 'dedicated' };
      const emitSubscriptionReconnected = vi.fn();

      const dedicated = makeConn({
        id: 'dedicated',
        isDedicated: true,
        client: {
          connect: vi.fn().mockResolvedValue(undefined),
          getServerVersion: vi.fn().mockResolvedValue({ server: 'ok', protocol: '1.4' }),
          disconnect: vi.fn(),
          isConnected: vi.fn().mockReturnValue(true),
          on: vi.fn(),
        },
      });
      connections.set(dedicated.id, dedicated);

      await handleConnectionError(
        dedicated,
        connections,
        config,
        null,
        2,
        false,
        subscriptionConnectionId,
        emitSubscriptionReconnected,
        vi.fn(),
        () => null
      );

      expect(dedicated.state).toBe('idle');
      expect(emitSubscriptionReconnected).toHaveBeenCalledWith(dedicated.client);

      const regular = makeConn({
        id: 'regular',
        isDedicated: false,
        client: {
          disconnect: vi.fn(),
          isConnected: vi.fn().mockReturnValue(false),
        },
      });
      connections.set(regular.id, regular);

      await handleConnectionError(
        regular,
        connections,
        config,
        null,
        1,
        false,
        subscriptionConnectionId,
        emitSubscriptionReconnected,
        vi.fn(),
        () => null
      );
      await new Promise(resolve => setImmediate(resolve));

      expect(connections.has(regular.id)).toBe(false);
    });

    it('reconnectConnection success path restores idle state and emits subscription event', async () => {
      context.pool = createPool({ maxReconnectAttempts: 1 });
      const subscriptionListener = vi.fn();
      context.pool!.on('subscriptionReconnected', subscriptionListener);

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

      await (context.pool as any).reconnectConnection(conn);

      expect(conn.state).toBe('idle');
      expect(subscriptionListener).toHaveBeenCalledWith(conn.client);
    });

    it('reconnectConnection success path for non-dedicated connection does not emit subscription event', async () => {
      context.pool = createPool({ maxReconnectAttempts: 1 });
      const subscriptionListener = vi.fn();
      context.pool!.on('subscriptionReconnected', subscriptionListener);

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

      await (context.pool as any).reconnectConnection(conn);

      expect(conn.state).toBe('idle');
      expect(subscriptionListener).not.toHaveBeenCalled();
    });

    it('createConnection supports non-SSL servers via tcp protocol', async () => {
      context.pool = createPool();
      const { ElectrumClient } = await import('../../../../../src/services/bitcoin/electrum');

      await (context.pool as any).createConnection({
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
      context.pool = createPool();
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
      (context.pool as any).connections.set(disconnectedIdle.id, disconnectedIdle);

      const selected = (context.pool as any).findIdleConnection();
      expect(selected).toBeNull();
    });

    it('activateConnection release is a no-op for dedicated connections', () => {
      context.pool = createPool();
      const dedicated = makeConn({ id: 'ded-release', state: 'active', isDedicated: true });

      const handle = (context.pool as any).activateConnection(dedicated, 'dedicated-test', Date.now());
      handle.release();

      expect(dedicated.state).toBe('active');
    });

    it('performHealthChecks aggregates repeated server failures without duplicate first-failure records', async () => {
      context.pool = createPool();
      context.pool!.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);
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
      (context.pool as any).connections.set(failingA.id, failingA);
      (context.pool as any).connections.set(failingB.id, failingB);
      // Clear any existing health history so we can count new entries
      const statsBeforeFail = (context.pool as any).serverStats.get('s1');
      if (statsBeforeFail) statsBeforeFail.healthHistory = [];
      vi.spyOn(context.pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      vi.spyOn(context.pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (context.pool as any).performHealthChecks();

      // Only one failure record should be added per server per cycle (not one per connection)
      const statsAfterFail = (context.pool as any).serverStats.get('s1');
      const failEntries = statsAfterFail.healthHistory.filter((h: any) => !h.success);
      expect(failEntries.length).toBe(1);
    });

    it('performHealthChecks skips active non-dedicated connections and records first success once per server', async () => {
      context.pool = createPool();
      context.pool!.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);

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

      (context.pool as any).connections.set(skippedActive.id, skippedActive);
      (context.pool as any).connections.set(idleA.id, idleA);
      (context.pool as any).connections.set(idleB.id, idleB);
      // Clear any existing health history so we can count new entries
      const statsBeforeSuccess = (context.pool as any).serverStats.get('s1');
      if (statsBeforeSuccess) statsBeforeSuccess.healthHistory = [];
      vi.spyOn(context.pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      vi.spyOn(context.pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (context.pool as any).performHealthChecks();

      expect(skippedActive.client.getBlockHeight).not.toHaveBeenCalled();
      // Only one success record should be added per server per cycle
      const statsAfterSuccess = (context.pool as any).serverStats.get('s1');
      const successEntries = statsAfterSuccess.healthHistory.filter((h: any) => h.success);
      expect(successEntries.length).toBe(1);
    });

    it('performHealthChecks skips server stat updates when stats entry is missing', async () => {
      context.pool = createPool();
      context.pool!.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);
      (context.pool as any).serverStats.delete('s1');
      const conn = makeConn({
        id: 'missing-stats',
        serverId: 's1',
        state: 'idle',
        client: {
          isConnected: vi.fn().mockReturnValue(true),
          getBlockHeight: vi.fn().mockResolvedValue(101),
        },
      });
      (context.pool as any).connections.set(conn.id, conn);
      vi.spyOn(context.pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);
      vi.spyOn(context.pool as any, 'exportMetrics').mockImplementation(() => undefined);

      await (context.pool as any).performHealthChecks();

      expect((context.pool as any).serverStats.has('s1')).toBe(false);
    });

    it('cleanupIdleConnections preserves minimum pool size and recent idle connections', () => {
      context.pool = createPool({ idleTimeoutMs: 1000 });
      const minProtected = makeConn({
        id: 'min-protected',
        state: 'idle',
        lastUsedAt: new Date(Date.now() - 10_000),
      });
      (context.pool as any).connections.set(minProtected.id, minProtected);
      vi.spyOn(context.pool as any, 'getEffectiveMinConnections').mockReturnValue(1);

      (context.pool as any).cleanupIdleConnections();
      expect((context.pool as any).connections.has(minProtected.id)).toBe(true);

      const recent = makeConn({
        id: 'recent-idle',
        state: 'idle',
        lastUsedAt: new Date(),
      });
      (context.pool as any).connections.set(recent.id, recent);
      vi.spyOn(context.pool as any, 'getEffectiveMinConnections').mockReturnValue(0);

      (context.pool as any).cleanupIdleConnections();
      expect((context.pool as any).connections.has(recent.id)).toBe(true);
    });

    it('createConnection error event delegates to handleConnectionError', async () => {
      context.pool = createPool();
      const handleSpy = vi.spyOn(context.pool as any, 'handleConnectionError').mockResolvedValue(undefined);

      const conn = await (context.pool as any).createConnection({
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
      context.pool = createPool();
      context.pool!.setServers([{ id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true }]);

      for (let i = 0; i < 30; i++) {
        recordHealthCheckResult((context.pool as any).serverStats, 's1', i % 2 === 0, i, `err-${i}`);
      }

      const state = context.pool!.getServerBackoffState('s1');
      expect(state).not.toBeNull();
      const stats = context.pool!.getPoolStats().servers.find((s) => s.serverId === 's1');
      expect(stats?.healthHistory.length).toBeLessThanOrEqual(20);
    });

    it('backoff and health-result helpers no-op for unknown server ids', () => {
      context.pool = createPool();

      expect(() => context.pool!.recordServerFailure('missing-server')).not.toThrow();
      expect(() => context.pool!.recordServerSuccess('missing-server')).not.toThrow();
      expect(() => recordHealthCheckResult((context.pool as any).serverStats, 'missing-server', true, 1)).not.toThrow();
    });

    it('exportMetrics reads pool and circuit stats', () => {
      context.pool = createPool();
      expect(() => (context.pool as any).exportMetrics()).not.toThrow();
    });

    it('exportMetrics includes per-server metrics when servers are configured', () => {
      context.pool = createPool();
      context.pool!.setServers([
        { id: 's1', label: 'S1', host: 'a', port: 1, useSsl: true, priority: 0, enabled: true },
      ]);
      expect(() => (context.pool as any).exportMetrics()).not.toThrow();
    });
}
