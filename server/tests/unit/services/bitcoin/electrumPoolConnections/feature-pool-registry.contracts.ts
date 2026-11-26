import { expect, it, vi } from 'vitest';
import './electrumPoolConnectionsTestHarness';
import prisma from '../../../../../src/models/prisma';
import {
  ElectrumPool,
  getElectrumPoolForNetwork,
  getElectrumPoolForNetworkAndFeatures,
  getSubscriptionConnectionForFeatures,
  resetElectrumPoolForNetwork,
} from '../../../../../src/services/bitcoin/electrumPool';

export function registerFeaturePoolRegistryTests(): void {
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

  it('discards a candidate whose network resets while an older feature pool is being evicted', async () => {
    for (let ttl = 1; ttl <= 16; ttl++) {
      await getElectrumPoolForNetworkAndFeatures('mainnet', ['silent_payments_v0'], { capabilityStaleAfterMs: ttl });
    }
    let finishEviction!: () => void;
    const eviction = new Promise<void>(resolve => { finishEviction = resolve; });
    let started!: () => void;
    const evicting = new Promise<void>(resolve => { started = resolve; });
    const shutdown = vi.spyOn(ElectrumPool.prototype, 'shutdown').mockImplementationOnce(() => {
      started();
      return eviction;
    });
    try {
      const candidate = getElectrumPoolForNetworkAndFeatures('signet', ['silent_payments_v0']);
      await evicting;
      await resetElectrumPoolForNetwork('signet');
      finishEviction();
      await expect(candidate).rejects.toThrow(/invalidated/);
      expect(shutdown).toHaveBeenCalledTimes(2);
      await expect(getElectrumPoolForNetworkAndFeatures('signet', ['silent_payments_v0'])).resolves.toBeInstanceOf(ElectrumPool);
    } finally {
      finishEviction();
      shutdown.mockRestore();
    }
  });

  it('drops in-flight feature pool init keys during network reset and fences stale pool commit', async () => {
    let resolveConfig: (value: unknown) => void = () => undefined;
    const delayedConfig = new Promise((resolve) => {
      resolveConfig = resolve;
    });
    (prisma as any).nodeConfig.findFirst.mockReturnValueOnce(delayedConfig);
    const shutdownSpy = vi.spyOn(ElectrumPool.prototype, 'shutdown').mockResolvedValue(undefined);

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

    await expect(pendingPool).rejects.toThrow(/invalidated/i);
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    shutdownSpy.mockRestore();
  });
}
