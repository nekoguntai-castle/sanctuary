import { afterEach, describe, expect, it, vi } from 'vitest';
import './electrumPoolConnectionsTestHarness';
import {
  ElectrumPool,
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
} from '../../../../../src/services/bitcoin/electrumPool';
import prisma from '../../../../../src/models/prisma';

export function registerElectrumPoolModuleHelperTests(): void {
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
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
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
            network: 'testnet',
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

    it('falls back to global pool settings when per-network settings are missing and omits null proxy credentials', async () => {
      (prisma as any).nodeConfig.findFirst.mockResolvedValueOnce({
        type: 'electrum',
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
            network: 'testnet',
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
