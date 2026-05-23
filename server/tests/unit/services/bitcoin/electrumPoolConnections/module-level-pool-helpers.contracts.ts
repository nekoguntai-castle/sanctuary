import { afterEach, describe, expect, it, vi } from 'vitest';
import './electrumPoolConnectionsTestHarness';
import {
  ElectrumPool,
  getElectrumPool,
  getElectrumPoolAsync,
  getElectrumPoolForNetwork,
  getElectrumPoolForNetworkAndFeatures,
  getSubscriptionConnectionForFeatures,
  getPoolConfig,
  getElectrumServers,
  initializeElectrumPool,
  isPoolEnabled,
  reloadElectrumServers,
  resetElectrumPool,
  resetElectrumPoolForNetwork,
  shutdownElectrumPool,
} from '../../../../../src/services/bitcoin/electrumPool';
import {
  getLoadBalancingStrategy,
  getProxyConfig,
  mapEnabledServers,
} from '../../../../../src/services/bitcoin/electrumPool/nodeConfigMapper';
import prisma from '../../../../../src/models/prisma';

export function registerElectrumPoolModuleHelperTests(): void {
  describe('module-level pool helpers', () => {
    afterEach(async () => {
      await shutdownElectrumPool();
      await resetElectrumPoolForNetwork('mainnet');
      await resetElectrumPoolForNetwork('testnet3');
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
      const first = await getElectrumPoolForNetwork('testnet3');
      const second = await getElectrumPoolForNetwork('testnet3');
      expect(second).toBe(first);

      await resetElectrumPoolForNetwork('testnet3');
      const recreated = await getElectrumPoolForNetwork('testnet3');
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
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        testnet3PoolMin: 4,
        testnet3PoolMax: 6,
        testnet3PoolLoadBalancing: 'least_connections',
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
            network: 'testnet3',
            supportsVerbose: true,
          },
        ],
      });

      const testnet3Pool = await getElectrumPoolForNetwork('testnet3');
      expect((testnet3Pool as any).config.minConnections).toBe(4);
      expect((testnet3Pool as any).config.maxConnections).toBe(6);
      expect((testnet3Pool as any).config.loadBalancing).toBe('least_connections');
      expect(testnet3Pool.isProxyEnabled()).toBe(true);
      expect(testnet3Pool.getServers()).toHaveLength(1);

      await resetElectrumPoolForNetwork('testnet3');

      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
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
            network: 'signet',
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

    it('partitions general and Silent Payments feature pools by usage and capability freshness', async () => {
      const freshCapabilityCheck = new Date();
      const staleCapabilityCheck = new Date(Date.now() - (25 * 60 * 60 * 1000));
      (prisma as any).nodeConfig.findFirst.mockResolvedValue({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [
          {
            id: 'general-1',
            label: 'General',
            host: 'general.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'general',
            supportsVerbose: null,
          },
          {
            id: 'sp-1',
            label: 'Frigate',
            host: 'frigate.example.com',
            port: 50002,
            useSsl: true,
            priority: 1,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'silent_payments',
            supportsVerbose: true,
            supportsSilentPaymentsV0: true,
            silentPaymentVersions: [0],
            lastCapabilityCheck: freshCapabilityCheck,
            lastCapabilityError: null,
          },
          {
            id: 'both-1',
            label: 'Both',
            host: 'both.example.com',
            port: 50002,
            useSsl: true,
            priority: 2,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'both',
            supportsVerbose: true,
            supportsSilentPaymentsV0: true,
            silentPaymentVersions: [0],
            lastCapabilityCheck: freshCapabilityCheck,
            lastCapabilityError: null,
          },
          {
            id: 'sp-stale',
            label: 'Stale Frigate',
            host: 'stale.example.com',
            port: 50002,
            useSsl: true,
            priority: 3,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'silent_payments',
            supportsVerbose: true,
            supportsSilentPaymentsV0: true,
            silentPaymentVersions: [0],
            lastCapabilityCheck: staleCapabilityCheck,
            lastCapabilityError: null,
          },
          {
            id: 'sp-unknown',
            label: 'Unknown Frigate',
            host: 'unknown.example.com',
            port: 50002,
            useSsl: true,
            priority: 4,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'silent_payments',
            supportsVerbose: true,
            supportsSilentPaymentsV0: null,
            silentPaymentVersions: null,
            lastCapabilityCheck: null,
            lastCapabilityError: null,
          },
        ],
      });

      const generalPool = await getElectrumPoolForNetwork('mainnet');
      expect(generalPool.getServers().map(server => server.id)).toEqual([
        'general-1',
        'both-1',
      ]);

      const silentPaymentsPool = await getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );
      expect(silentPaymentsPool.getServers().map(server => server.id)).toEqual([
        'sp-1',
        'both-1',
      ]);
    });

    it('falls back to global pool settings when per-network settings are missing and omits null proxy credentials', async () => {
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 2,
        poolMaxConnections: 4,
        poolLoadBalancing: 'round_robin',
        testnet3PoolMin: null,
        testnet3PoolMax: null,
        testnet3PoolLoadBalancing: null,
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
            network: 'testnet3',
            supportsVerbose: true,
          },
        ],
      });

      const testnet3Pool = await getElectrumPoolForNetwork('testnet3');
      expect((testnet3Pool as any).config.minConnections).toBe(2);
      expect((testnet3Pool as any).config.maxConnections).toBe(4);
      expect((testnet3Pool as any).config.loadBalancing).toBe('round_robin');
      expect(testnet3Pool.getProxyConfig()).toMatchObject({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      });
      expect(testnet3Pool.getProxyConfig()?.username).toBeUndefined();
      expect(testnet3Pool.getProxyConfig()?.password).toBeUndefined();

      await resetElectrumPoolForNetwork('testnet3');

      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
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
            network: 'signet',
            supportsVerbose: true,
          },
        ],
      });

      const signetPool = await getElectrumPoolForNetwork('signet');
      expect((signetPool as any).config.minConnections).toBe(3);
      expect((signetPool as any).config.maxConnections).toBe(6);
      expect((signetPool as any).config.loadBalancing).toBe('least_connections');
    });

    it('rejects unsupported global pool load-balancing values', () => {
      expect(getLoadBalancingStrategy({ poolLoadBalancing: 'failover_only' }))
        .toBe('failover_only');
      expect(getLoadBalancingStrategy({ poolLoadBalancing: 'unsupported' })).toBeNull();
      expect(getLoadBalancingStrategy({ poolLoadBalancing: null })).toBeNull();
    });

    it('maps enabled saved servers with normalized Silent Payments capability metadata', () => {
      const mapped = mapEnabledServers([
        {
          id: 'enabled-sp',
          label: 'Frigate',
          host: 'frigate.example.com',
          port: 50002,
          useSsl: true,
          priority: 0,
          enabled: true,
          network: 'mainnet',
          serverUsage: 'silent_payments',
          supportsVerbose: true,
          supportsSilentPaymentsV0: true,
          silentPaymentVersions: [0, 0],
          capabilityProfileKey: 'cap-key',
          lastCapabilityCheck: new Date('2026-05-23T12:00:00.000Z'),
          lastCapabilityError: null,
        },
        {
          id: 'disabled',
          label: 'Disabled',
          host: 'disabled.example.com',
          port: 50002,
          useSsl: true,
          priority: 1,
          enabled: false,
          supportsVerbose: null,
        },
      ]);

      expect(mapped).toEqual([
        expect.objectContaining({
          id: 'enabled-sp',
          network: 'mainnet',
          serverUsage: 'silent_payments',
          silentPaymentVersions: [0],
          supportsSilentPaymentsV0: true,
          capabilityProfileKey: 'cap-key',
        }),
      ]);

      expect(mapEnabledServers([
        {
          id: 'enabled-general',
          label: 'General',
          host: 'general.example.com',
          port: 50002,
          useSsl: true,
          priority: 0,
          enabled: true,
          supportsVerbose: null,
        },
      ])).toEqual([
        expect.objectContaining({
          id: 'enabled-general',
          serverUsage: 'general',
          capabilityProfileKey: null,
          lastCapabilityCheck: null,
        }),
      ]);
    });

    it('projects proxy configuration through the shared node config helper', () => {
      expect(getProxyConfig({
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: 'tor-user',
        proxyPassword: 'tor-pass',
      })).toEqual({
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
        username: 'tor-user',
        password: 'tor-pass',
      });
      expect(getProxyConfig({ proxyEnabled: false })).toBeNull();
    });

    it('keeps base pool settings for regtest (no per-network override branch)', async () => {
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 3,
        poolMaxConnections: 8,
        poolLoadBalancing: 'round_robin',
        mainnetPoolMin: 10,
        mainnetPoolMax: 12,
        mainnetPoolLoadBalancing: 'failover_only',
        testnet3PoolMin: 6,
        testnet3PoolMax: 9,
        testnet3PoolLoadBalancing: 'least_connections',
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

    it('swallows database reload failures for an existing pool', async () => {
      const configured = await initializeElectrumPool({
        enabled: false,
        minConnections: 1,
        maxConnections: 1,
      });
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 1,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [
          {
            id: 'reload-failure',
            label: 'Reload Failure',
            host: 'reload-failure.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
            network: 'mainnet',
            supportsVerbose: null,
          },
        ],
      });
      const setServersSpy = vi.spyOn(configured, 'setServers')
        .mockImplementationOnce(() => {
          throw new Error('set servers failed');
        });

      await expect(configured.reloadServers()).resolves.toBeUndefined();

      expect(setServersSpy).toHaveBeenCalledTimes(1);
      setServersSpy.mockRestore();
    });

    it('reloads a selected network pool without resetting other network pools', async () => {
      const testnetPool = await getElectrumPoolForNetwork('testnet3');
      const signetPool = await getElectrumPoolForNetwork('signet');
      const testnetShutdown = vi.spyOn(testnetPool, 'shutdown').mockResolvedValue(undefined);
      const signetShutdown = vi.spyOn(signetPool, 'shutdown').mockResolvedValue(undefined);

      await reloadElectrumServers('testnet3');

      expect(testnetShutdown).toHaveBeenCalledTimes(1);
      expect(signetShutdown).not.toHaveBeenCalled();
      testnetShutdown.mockRestore();
      signetShutdown.mockRestore();
    });

    it('clears the legacy singleton when resetting the mainnet network pool', async () => {
      await getElectrumPoolForNetwork('mainnet');
      expect(getPoolConfig()).not.toBeNull();

      await resetElectrumPoolForNetwork('mainnet');

      expect(getPoolConfig()).toBeNull();
    });

    it('keeps a replaced network pool entry during shutdown cleanup', async () => {
      await getElectrumPoolForNetwork('signet');
      const replacementPool = new ElectrumPool({
        enabled: true,
        minConnections: 1,
        maxConnections: 1,
      });
      const originalGet = Map.prototype.get;
      const getSpy = vi.spyOn(Map.prototype, 'get')
        .mockImplementation(function(this: Map<any, any>, key: any) {
          if (key === 'signet') {
            return replacementPool as any;
          }
          return originalGet.call(this, key);
        });

      try {
        await shutdownElectrumPool();
      } finally {
        getSpy.mockRestore();
        await resetElectrumPoolForNetwork('signet');
      }
    });

    it('reloads each initialized network pool when no specific network is supplied', async () => {
      const testnetPool = await getElectrumPoolForNetwork('testnet3');
      const signetPool = await getElectrumPoolForNetwork('signet');
      const testnetShutdown = vi.spyOn(testnetPool, 'shutdown').mockResolvedValue(undefined);
      const signetShutdown = vi.spyOn(signetPool, 'shutdown').mockResolvedValue(undefined);

      await reloadElectrumServers();

      expect(testnetShutdown).toHaveBeenCalledTimes(1);
      expect(signetShutdown).toHaveBeenCalledTimes(1);
      testnetShutdown.mockRestore();
      signetShutdown.mockRestore();
    });

    it('logs and swallows pool shutdown failures during reset', async () => {
      const pool = await getElectrumPoolForNetwork('testnet3');
      const shutdownSpy = vi.spyOn(pool, 'shutdown')
        .mockRejectedValueOnce(new Error('shutdown failed'));

      await expect(reloadElectrumServers('testnet3')).resolves.toBeUndefined();

      expect(shutdownSpy).toHaveBeenCalledTimes(1);
      shutdownSpy.mockRestore();
    });

    it('logs and removes feature-scoped pools even when shutdown rejects', async () => {
      const freshCapabilityCheck = new Date();
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [
          {
            id: 'sp-1',
            label: 'Frigate',
            host: 'frigate.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'silent_payments',
            supportsVerbose: true,
            supportsSilentPaymentsV0: true,
            silentPaymentVersions: [0],
            lastCapabilityCheck: freshCapabilityCheck,
            lastCapabilityError: null,
          },
        ],
      });
      const featurePool = await getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );
      const shutdownSpy = vi.spyOn(featurePool, 'shutdown')
        .mockRejectedValueOnce(new Error('feature shutdown failed'));

      await expect(resetElectrumPoolForNetwork('mainnet')).resolves.toBeUndefined();

      expect(shutdownSpy).toHaveBeenCalledTimes(1);
      shutdownSpy.mockRestore();
    });

    it('keeps a replaced feature-scoped pool entry during shutdown cleanup', async () => {
      const freshCapabilityCheck = new Date();
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [
          {
            id: 'sp-replaced',
            label: 'Frigate Replaced',
            host: 'frigate-replaced.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'silent_payments',
            supportsVerbose: true,
            supportsSilentPaymentsV0: true,
            silentPaymentVersions: [0],
            lastCapabilityCheck: freshCapabilityCheck,
            lastCapabilityError: null,
          },
        ],
      });
      await getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );
      const replacementPool = new ElectrumPool({
        enabled: true,
        minConnections: 1,
        maxConnections: 1,
      });
      const originalGet = Map.prototype.get;
      const getSpy = vi.spyOn(Map.prototype, 'get')
        .mockImplementation(function(this: Map<any, any>, key: any) {
          if (typeof key === 'string' && key.includes('silent_payments_v0')) {
            return replacementPool as any;
          }
          return originalGet.call(this, key);
        });

      try {
        await resetElectrumPoolForNetwork('mainnet');
      } finally {
        getSpy.mockRestore();
        await resetElectrumPoolForNetwork('mainnet');
      }
    });

    it('returns subscription connections from feature-scoped pools', async () => {
      const fakeClient = { isConnected: vi.fn().mockReturnValue(true) } as any;
      const subscriptionSpy = vi.spyOn(ElectrumPool.prototype, 'getSubscriptionConnection')
        .mockResolvedValueOnce(fakeClient);

      await expect(getSubscriptionConnectionForFeatures(
        'mainnet',
        ['base_electrum'],
      )).resolves.toBe(fakeClient);

      expect(subscriptionSpy).toHaveBeenCalledTimes(1);
      subscriptionSpy.mockRestore();
    });

    it('routes empty feature requirements to the general network pool', async () => {
      const networkPool = await getElectrumPoolForNetwork('testnet3');

      await expect(getElectrumPoolForNetworkAndFeatures(
        'testnet3',
        [],
      )).resolves.toBe(networkPool);
    });

    it('reuses existing feature-scoped pools for repeated requests', async () => {
      const freshCapabilityCheck = new Date();
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 2,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [
          {
            id: 'sp-existing',
            label: 'Frigate Existing',
            host: 'frigate-existing.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
            network: 'mainnet',
            serverUsage: 'silent_payments',
            supportsVerbose: true,
            supportsSilentPaymentsV0: true,
            silentPaymentVersions: [0],
            lastCapabilityCheck: freshCapabilityCheck,
            lastCapabilityError: null,
          },
        ],
      });

      const first = await getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );
      const second = await getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );

      expect(second).toBe(first);
    });

    it('reuses in-flight feature-scoped pool initialization for concurrent callers', async () => {
      let resolveConfig: (value: unknown) => void = () => undefined;
      const delayedConfig = new Promise((resolve) => {
        resolveConfig = resolve;
      });
      (prisma as any).nodeConfig.findFirst.mockReturnValueOnce(delayedConfig);

      const first = getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );
      const second = getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );
      resolveConfig({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 1,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [],
      });

      const [firstPool, secondPool] = await Promise.all([first, second]);

      expect(secondPool).toBe(firstPool);
    });

    it('returns a feature pool that appears during the inner initialization guard', async () => {
      const fallbackPool = new ElectrumPool({
        enabled: true,
        minConnections: 1,
        maxConnections: 1,
      });
      const originalGet = Map.prototype.get;
      let featureKeyLookupCount = 0;
      const getSpy = vi.spyOn(Map.prototype, 'get')
        .mockImplementation(function(this: Map<any, any>, key: any) {
          if (typeof key === 'string' && key.includes('silent_payments_v0')) {
            featureKeyLookupCount += 1;
            if (featureKeyLookupCount === 3) {
              return fallbackPool as any;
            }
          }
          return originalGet.call(this, key);
        });

      try {
        const loaded = await getElectrumPoolForNetworkAndFeatures(
          'mainnet',
          ['silent_payments_v0'],
        );

        expect(loaded).toBe(fallbackPool);
      } finally {
        getSpy.mockRestore();
      }
    });

    it('evicts oldest feature-scoped pools when the feature registry exceeds its limit', async () => {
      (prisma as any).nodeConfig.findFirst.mockResolvedValue({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 1,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [],
      });
      const shutdownSpy = vi.spyOn(ElectrumPool.prototype, 'shutdown')
        .mockResolvedValue(undefined);

      try {
        for (let staleAfterMs = 1; staleAfterMs <= 17; staleAfterMs += 1) {
          await getElectrumPoolForNetworkAndFeatures(
            'mainnet',
            ['silent_payments_v0'],
            { capabilityStaleAfterMs: staleAfterMs },
          );
        }

        expect(shutdownSpy).toHaveBeenCalled();
      } finally {
        shutdownSpy.mockRestore();
      }
    });

    it('drops in-flight feature pool init keys during network reset', async () => {
      let resolveConfig: (value: unknown) => void = () => undefined;
      const delayedConfig = new Promise((resolve) => {
        resolveConfig = resolve;
      });
      (prisma as any).nodeConfig.findFirst.mockReturnValueOnce(delayedConfig);

      const pendingPool = getElectrumPoolForNetworkAndFeatures(
        'mainnet',
        ['silent_payments_v0'],
      );

      await resetElectrumPoolForNetwork('mainnet');
      resolveConfig({
        type: 'electrum',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 1,
        poolLoadBalancing: 'round_robin',
        proxyEnabled: false,
        proxyHost: null,
        proxyPort: null,
        servers: [],
      });
      const pool = await pendingPool;

      expect(pool).toBeInstanceOf(ElectrumPool);
    });

    it('loads servers and proxy settings from database during async bootstrap', async () => {
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
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
            network: 'mainnet',
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
      (prisma as any).nodeConfig.findFirst.mockRejectedValueOnce(new Error('db failure'));

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
}
