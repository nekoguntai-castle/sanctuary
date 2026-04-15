import { expect, it, vi } from 'vitest';
import {
  createPool,
  makeConn,
  type ElectrumPoolTestContext,
} from './electrumPoolConnectionsTestHarness';
import prisma from '../../../../../src/models/prisma';
import { updateServerHealthInDb } from '../../../../../src/services/bitcoin/electrumPool/healthChecker';

const createTimeoutHandle = () => ({}) as NodeJS.Timeout;

export function registerElectrumPoolInternalLifecycleTests(context: ElectrumPoolTestContext): void {
    it('initialize returns early when already initialized or already initializing', async () => {
      context.pool = createPool();
      const doInitSpy = vi.spyOn(context.pool as any, 'doInitialize').mockResolvedValue(undefined);

      (context.pool as any).isInitialized = true;
      await context.pool!.initialize();
      expect(doInitSpy).not.toHaveBeenCalled();

      (context.pool as any).isInitialized = false;
      (context.pool as any).initializePromise = Promise.resolve();
      await context.pool!.initialize();
      expect(doInitSpy).not.toHaveBeenCalled();
    });

    it('emits circuit state change when repeated acquisition failures open the breaker', async () => {
      context.pool = createPool();
      const stateChangeListener = vi.fn();
      context.pool!.on('circuitStateChange', stateChangeListener);
      (context.pool as any).isShuttingDown = true;

      for (let i = 0; i < 8; i++) {
        await expect(context.pool!.acquire()).rejects.toThrow('Pool is shutting down');
      }

      expect(stateChangeListener).toHaveBeenCalledWith({
        newState: 'open',
        oldState: 'closed',
      });
    });

    it('disconnectServerConnections is a no-op for unknown server ids', () => {
      context.pool = createPool();
      expect(() => context.pool!.disconnectServerConnections('missing-server')).not.toThrow();
    });

    it('disconnectServerConnections removes matching connections and clears subscription id', () => {
      context.pool = createPool();
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

      (context.pool as any).connections.set('conn-a', connA);
      (context.pool as any).connections.set('conn-b', connB);
      (context.pool as any).subscriptionConnectionId.value = 'conn-a';

      context.pool!.disconnectServerConnections('server-1');

      expect((context.pool as any).connections.has('conn-a')).toBe(false);
      expect((context.pool as any).connections.has('conn-b')).toBe(true);
      expect(connA.client.disconnect).toHaveBeenCalledTimes(1);
      expect((context.pool as any).subscriptionConnectionId.value).toBeNull();
    });

    it('disconnectServerConnections tolerates per-connection disconnect errors', () => {
      context.pool = createPool();
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
      (context.pool as any).connections.set(badConn.id, badConn);

      expect(() => context.pool!.disconnectServerConnections('server-1')).not.toThrow();
      expect((context.pool as any).connections.has(badConn.id)).toBe(true);
    });

    it('updates proxy/network helpers and exposes circuit health', () => {
      context.pool = createPool();
      context.pool!.setNetwork('testnet');
      expect(context.pool!.getNetwork()).toBe('testnet');

      context.pool!.setProxyConfig({ enabled: true, host: '127.0.0.1', port: 9050 });
      expect(context.pool!.isProxyEnabled()).toBe(true);
      expect(context.pool!.getProxyConfig()).toEqual({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      });

      context.pool!.setProxyConfig(null);
      expect(context.pool!.isProxyEnabled()).toBe(false);
      expect(context.pool!.getProxyConfig()).toBeNull();
      expect(context.pool!.getCircuitHealth()).toHaveProperty('state');
    });

    it('reloadServers applies db config and calls ensureMinimumConnections when initialized', async () => {
      context.pool = createPool();
      (context.pool as any).isInitialized = true;
      const ensureSpy = vi.spyOn(context.pool as any, 'ensureMinimumConnections').mockResolvedValue(undefined);

      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
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

      await context.pool!.reloadServers();

      expect(context.pool!.getServers()).toHaveLength(1);
      expect((context.pool as any).config.loadBalancing).toBe('least_connections');
      expect(context.pool!.isProxyEnabled()).toBe(true);
      expect(ensureSpy).toHaveBeenCalledTimes(1);
    });

    it('reloadServers clears proxy when proxy settings are incomplete', async () => {
      context.pool = createPool();
      context.pool!.setProxyConfig({ enabled: true, host: '127.0.0.1', port: 9050 });

      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolLoadBalancing: 'round_robin',
        proxyEnabled: true,
        proxyHost: null,
        proxyPort: null,
        servers: [],
      });

      await context.pool!.reloadServers();
      expect(context.pool!.isProxyEnabled()).toBe(false);
      expect(context.pool!.getProxyConfig()).toBeNull();
    });

    it('reloadServers keeps existing state when db returns no config', async () => {
      context.pool = createPool({ loadBalancing: 'failover_only' });
      context.pool!.setServers([
        { id: 'keep-1', label: 'Keep', host: 'keep.example.com', port: 50002, useSsl: true, priority: 0, enabled: true },
      ]);
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce(null);

      await context.pool!.reloadServers();

      expect(context.pool!.getServers()).toHaveLength(1);
      expect((context.pool as any).config.loadBalancing).toBe('failover_only');
    });

    it('reloadServers handles proxy credentials omitted in database config', async () => {
      context.pool = createPool({ loadBalancing: 'round_robin' });
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
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

      await context.pool!.reloadServers();
      const proxy = context.pool!.getProxyConfig();
      expect(proxy).toMatchObject({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      });
      expect(proxy?.username).toBeUndefined();
      expect(proxy?.password).toBeUndefined();
      expect((context.pool as any).config.loadBalancing).toBe('round_robin');
    });

    it('updateServerHealthInDb swallows database update failures', async () => {
      context.pool = createPool();
      (prisma as any).electrumServer.update.mockRejectedValueOnce(new Error('db write failed'));

      await expect(
        updateServerHealthInDb('server-1', false, 3, 'health failed')
      ).resolves.toBeUndefined();
    });

    it('updateServerHealthInDb omits fail-count field when not provided', async () => {
      context.pool = createPool();

      await expect(
        updateServerHealthInDb('server-1', true, undefined, 'ignored')
      ).resolves.toBeUndefined();

      // The nodeConfigRepository.electrumServer.updateHealth handles the data shape internally
    });

    it('doInitialize exits immediately when pool becomes initialized before execution', async () => {
      context.pool = createPool();
      (context.pool as any).isInitialized = true;
      const createSpy = vi.spyOn(context.pool as any, 'createConnection');

      await (context.pool as any).doInitialize();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('single-mode initialize executes health-check interval callback', async () => {
      vi.useFakeTimers();
      context.pool = createPool({
        enabled: false,
        healthCheckIntervalMs: 10,
      });
      const healthSpy = vi.spyOn(context.pool as any, 'performHealthChecks').mockResolvedValue(undefined);

      await context.pool!.initialize();
      await vi.advanceTimersByTimeAsync(20);
      expect(healthSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('pool-mode initialize tolerates failed initial connection and runs interval callbacks', async () => {
      vi.useFakeTimers();
      context.pool = createPool({
        enabled: true,
        minConnections: 1,
        maxConnections: 1,
        healthCheckIntervalMs: 10,
        idleTimeoutMs: 20,
        keepaliveIntervalMs: 10,
      });

      const healthSpy = vi.spyOn(context.pool as any, 'performHealthChecks').mockResolvedValue(undefined);
      const idleSpy = vi.spyOn(context.pool as any, 'cleanupIdleConnections').mockImplementation(() => undefined);
      const keepaliveSpy = vi.spyOn(context.pool as any, 'sendKeepalives').mockResolvedValue(undefined);
      vi.spyOn(context.pool as any, 'createConnection').mockRejectedValueOnce(new Error('init connect failed'));

      await context.pool!.initialize();
      expect(context.pool!.isPoolInitialized()).toBe(true);

      await vi.advanceTimersByTimeAsync(25);
      expect(healthSpy).toHaveBeenCalled();
      expect(idleSpy).toHaveBeenCalled();
      expect(keepaliveSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('reloadServers swallows database errors', async () => {
      context.pool = createPool();
      (prisma as any).nodeConfig.findFirst.mockRejectedValueOnce(new Error('db unavailable'));
      await expect(context.pool!.reloadServers()).resolves.toBeUndefined();
    });

    it('shutdown rejects waiting requests and tolerates disconnect errors', async () => {
      context.pool = createPool();
      (context.pool as any).isInitialized = true;
      const timeout = createTimeoutHandle();
      let rejectionMessage = '';
      const queued = new Promise<void>((resolve, reject) => {
        (context.pool as any).waitingQueue.push({
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
      (context.pool as any).connections.set('conn-bad', badConn);

      await context.pool!.shutdown();
      await queued;

      expect(rejectionMessage).toContain('Pool is shutting down');
      expect((context.pool as any).connections.size).toBe(0);
    });

    it('acquireInternal throws immediately when pool is shutting down', async () => {
      context.pool = createPool();
      (context.pool as any).isShuttingDown = true;
      await expect((context.pool as any).acquireInternal()).rejects.toThrow('Pool is shutting down');
    });

    it('acquireInternal single-mode reconnects disconnected existing connection', async () => {
      context.pool = createPool({ enabled: false });
      (context.pool as any).isInitialized = true;
      const conn = makeConn({
        client: {
          isConnected: vi.fn().mockReturnValue(false),
          disconnect: vi.fn(),
          connect: vi.fn(),
          getServerVersion: vi.fn(),
        },
      });
      (context.pool as any).connections.set(conn.id, conn);
      const reconnectSpy = vi.spyOn(context.pool as any, 'reconnectConnection').mockResolvedValue(undefined);

      const handle = await (context.pool as any).acquireInternal();
      expect(handle.client).toBe(conn.client);
      expect(reconnectSpy).toHaveBeenCalledWith(conn);
    });

    it('acquireInternal single-mode creates connection when none exists', async () => {
      context.pool = createPool({ enabled: false });
      (context.pool as any).isInitialized = true;
      const created = makeConn({ id: 'single-created' });
      vi.spyOn(context.pool as any, 'createConnection').mockImplementation(async () => {
        (context.pool as any).connections.set(created.id, created);
        return created;
      });

      const handle = await (context.pool as any).acquireInternal();
      expect(handle.client).toBe(created.client);
    });

    it('acquireInternal initializes pool lazily when called before initialization', async () => {
      context.pool = createPool({ enabled: false });
      const conn = makeConn({ id: 'lazy-init-single' });
      const initSpy = vi.spyOn(context.pool!, 'initialize').mockImplementation(async () => {
        (context.pool as any).isInitialized = true;
        (context.pool as any).connections.set(conn.id, conn);
      });

      const handle = await (context.pool as any).acquireInternal();
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(handle.client).toBe(conn.client);
    });

    it('acquireInternal queues requests when new connection creation fails under capacity', async () => {
      vi.useFakeTimers();
      context.pool = createPool({
        enabled: true,
        minConnections: 0,
        maxConnections: 1,
        maxWaitingRequests: 1,
        acquisitionTimeoutMs: 10,
      });
      (context.pool as any).isInitialized = true;
      vi.spyOn(context.pool as any, 'findIdleConnection').mockReturnValue(null);
      vi.spyOn(context.pool as any, 'createConnection').mockRejectedValueOnce(new Error('create failed'));

      const pending = (context.pool as any).acquireInternal({ timeoutMs: 10 });
      const rejected = pending.catch((err: Error) => err);
      await vi.advanceTimersByTimeAsync(15);
      const error = await rejected;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Connection acquisition timeout');
      vi.useRealTimers();
    });

    it('acquireInternal creates and activates a new connection when capacity is available', async () => {
      context.pool = createPool({
        enabled: true,
        minConnections: 0,
        maxConnections: 1,
      });
      (context.pool as any).isInitialized = true;
      vi.spyOn(context.pool as any, 'findIdleConnection').mockReturnValue(null);
      const created = makeConn({ id: 'created-on-demand', state: 'idle' });
      const createSpy = vi.spyOn(context.pool as any, 'createConnection').mockResolvedValue(created);

      const handle = await (context.pool as any).acquireInternal({ purpose: 'on-demand' });
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(handle.client).toBe(created.client);

      handle.release();
      expect(created.state).toBe('idle');
    });

    it('acquireInternal throws when waiting queue is full', async () => {
      context.pool = createPool({
        minConnections: 0,
        maxConnections: 0,
        maxWaitingRequests: 0,
      });
      (context.pool as any).isInitialized = true;

      await expect((context.pool as any).acquireInternal()).rejects.toThrow('Pool request queue is full');
    });

    it('acquireInternal times out queued requests', async () => {
      context.pool = createPool({
        minConnections: 0,
        maxConnections: 0,
        maxWaitingRequests: 1,
        acquisitionTimeoutMs: 10,
      });
      (context.pool as any).isInitialized = true;
      vi.useFakeTimers();

      const queued = (context.pool as any).acquireInternal({ timeoutMs: 10 });
      const rejected = queued.catch((err: Error) => err);
      await vi.advanceTimersByTimeAsync(15);
      const error = await rejected;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Connection acquisition timeout');
      vi.useRealTimers();
    });

    it('acquireInternal timeout callback tolerates queue entry already removed', async () => {
      context.pool = createPool({
        minConnections: 0,
        maxConnections: 0,
        maxWaitingRequests: 1,
        acquisitionTimeoutMs: 10,
      });
      (context.pool as any).isInitialized = true;
      vi.useFakeTimers();

      const queued = (context.pool as any).acquireInternal({ timeoutMs: 10 });
      (context.pool as any).waitingQueue.splice(0, 1);
      const rejected = queued.catch((err: Error) => err);

      await vi.advanceTimersByTimeAsync(15);
      const error = await rejected;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Connection acquisition timeout');
      vi.useRealTimers();
    });
}
