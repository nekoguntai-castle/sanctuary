import { describe, expect, it, vi } from 'vitest';
import {
  MockElectrumClient,
  manager,
  mockClient,
  mockConfigChangeUnsubscribe,
  mockDistributedEventBus,
  mockLog,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { acquireLock } from '../../../../src/infrastructure';
import { getElectrumClientForNetwork } from '../../../../src/services/bitcoin/electrum';
import { resetNodeClient } from '../../../../src/services/bitcoin/nodeClient';
import { reloadElectrumServers } from '../../../../src/services/bitcoin/electrumPool';
import { walletRepository } from '../../../../src/repositories';
import { RECONNECT_BASE_DELAY_MS } from '../../../../src/worker/electrumManager/types';

function configChangeHandler(): (change: unknown) => Promise<void> {
  const handler = vi.mocked(mockDistributedEventBus.on).mock.calls
    .find(([event]) => event === 'system:electrumConfig.changed')?.[1];
  if (!handler) throw new Error('Electrum config change handler was not registered');
  return handler;
}

function connectedNetworks(): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(manager.getHealthMetrics().networks).map(([network, metrics]) => [network, metrics.connected]),
  );
}

async function startAsSubscriptionOwner(networks: string[] = ['mainnet']) {
  vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
  vi.mocked(walletRepository.findRepresentedNetworks).mockResolvedValueOnce(networks as any);
  vi.mocked(prisma.address.findMany).mockResolvedValue([]);
  await manager.start();
}

async function startWithoutSubscriptionOwnership() {
  vi.mocked(acquireLock).mockResolvedValueOnce(null);
  await manager.start();
}

export function registerElectrumManagerConfigChangeContracts() {
  describe('Electrum config changes', () => {
    it('listens for Electrum config changes from start even without subscription ownership', async () => {
      await startWithoutSubscriptionOwnership();

      expect(mockDistributedEventBus.on).toHaveBeenCalledTimes(1);
      expect(mockDistributedEventBus.on).toHaveBeenCalledWith('system:electrumConfig.changed', expect.any(Function));
    });

    it('resets every node client and reconnects owned subscriptions on a node-config change', async () => {
      vi.useFakeTimers();
      try {
        await startAsSubscriptionOwner();
        const connectsBefore = mockClient.connect.mock.calls.length;
        const resolvesBefore = vi.mocked(getElectrumClientForNetwork).mock.calls.length;
        await configChangeHandler()({ scope: 'node-config', network: null });

        expect(resetNodeClient).toHaveBeenCalledTimes(1);
        expect(resetNodeClient).toHaveBeenCalledWith(undefined);
        expect(reloadElectrumServers).not.toHaveBeenCalled();
        expect(mockClient.disconnect).toHaveBeenCalled();
        expect(manager.isConnected()).toBe(false);

        await vi.advanceTimersByTimeAsync(RECONNECT_BASE_DELAY_MS);

        expect(mockClient.connect).toHaveBeenCalledTimes(connectsBefore + 1);
        expect(getElectrumClientForNetwork).toHaveBeenCalledTimes(resolvesBefore + 1);
        expect(manager.isConnected()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reloads only the named pool and keeps subscriptions on an electrum-servers change', async () => {
      await startAsSubscriptionOwner();
      await configChangeHandler()({ scope: 'electrum-servers', network: 'testnet4' });

      expect(reloadElectrumServers).toHaveBeenCalledWith('testnet4');
      expect(resetNodeClient).not.toHaveBeenCalled();
      expect(mockClient.disconnect).not.toHaveBeenCalled();
      expect(manager.isConnected()).toBe(true);
    });

    it.each([null, 'bogusnet'])(
      'reloads every pool when an electrum-servers change names no supported network (%s)',
      async (network) => {
        await startAsSubscriptionOwner();
        await configChangeHandler()({ scope: 'electrum-servers', network });

        expect(reloadElectrumServers).toHaveBeenCalledTimes(1);
        expect(reloadElectrumServers).toHaveBeenCalledWith(undefined);
      },
    );

    it('resets node clients without touching subscriptions when this worker is not the owner', async () => {
      await startWithoutSubscriptionOwnership();
      await configChangeHandler()({ scope: 'node-config', network: null });

      expect(resetNodeClient).toHaveBeenCalledTimes(1);
      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('applies overlapping config changes in arrival order', async () => {
      await startWithoutSubscriptionOwnership();
      let releaseReset!: () => void;
      vi.mocked(resetNodeClient).mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseReset = resolve;
      }));
      const handler = configChangeHandler();

      const first = handler({ scope: 'node-config', network: null });
      const second = handler({ scope: 'electrum-servers', network: 'mainnet' });
      await Promise.resolve();
      await Promise.resolve();

      expect(resetNodeClient).toHaveBeenCalledTimes(1);
      expect(reloadElectrumServers).not.toHaveBeenCalled();

      releaseReset();
      await Promise.all([first, second]);

      expect(reloadElectrumServers).toHaveBeenCalledWith('mainnet');
    });

    it('logs a failed config change and still applies the next one', async () => {
      await startWithoutSubscriptionOwnership();
      vi.mocked(resetNodeClient).mockRejectedValueOnce(new Error('reset failed'));
      const handler = configChangeHandler();

      await expect(handler({ scope: 'node-config', network: null })).resolves.toBeUndefined();
      await expect(handler({ scope: 'electrum-servers', network: 'mainnet' })).resolves.toBeUndefined();

      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to apply Electrum config change',
        expect.objectContaining({ scope: 'node-config', error: 'reset failed' }),
      );
      expect(reloadElectrumServers).toHaveBeenCalledWith('mainnet');
    });

    it('resets and reconnects only the named network on a network-scoped node-config change', async () => {
      vi.useFakeTimers();
      try {
        const clients = { mainnet: new MockElectrumClient(), testnet4: new MockElectrumClient() };
        vi.mocked(getElectrumClientForNetwork).mockImplementation(
          (network) => clients[network as keyof typeof clients] as unknown as any,
        );
        await startAsSubscriptionOwner(['mainnet', 'testnet4']);
        const testnet4Connects = clients.testnet4.connect.mock.calls.length;

        await configChangeHandler()({ scope: 'node-config', network: 'testnet4' });

        expect(resetNodeClient).toHaveBeenCalledTimes(1);
        expect(resetNodeClient).toHaveBeenCalledWith('testnet4');
        expect(clients.testnet4.disconnect).toHaveBeenCalledTimes(1);
        expect(clients.mainnet.disconnect).not.toHaveBeenCalled();
        expect(connectedNetworks().mainnet).toBe(true);
        expect(connectedNetworks().testnet4).toBe(false);

        await vi.advanceTimersByTimeAsync(RECONNECT_BASE_DELAY_MS);

        expect(clients.testnet4.connect).toHaveBeenCalledTimes(testnet4Connects + 1);
        expect(clients.mainnet.connect).toHaveBeenCalledTimes(1);
        expect(connectedNetworks().testnet4).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['null', null, undefined],
      ['a string', 'node-config', undefined],
      ['an object without a scope', { network: 'mainnet' }, undefined],
      ['an object with an unknown scope', { scope: 'bogus', network: null }, 'bogus'],
    ])('drops %s payload and still applies the next valid change', async (_label, payload, loggedScope) => {
      await startWithoutSubscriptionOwnership();
      const handler = configChangeHandler();

      await expect(handler(payload)).resolves.toBeUndefined();
      await expect(handler({ scope: 'node-config', network: null })).resolves.toBeUndefined();

      expect(mockLog.warn).toHaveBeenCalledWith('Ignoring malformed Electrum config change', { scope: loggedScope });
      expect(mockLog.error).not.toHaveBeenCalled();
      expect(resetNodeClient).toHaveBeenCalledTimes(1);
    });

    it('stops listening when stopped and registers once per start', async () => {
      vi.mocked(acquireLock).mockResolvedValue(null);
      try {
        await manager.start();
        await manager.start();
        expect(mockDistributedEventBus.on).toHaveBeenCalledTimes(1);

        await manager.stop();
        await manager.start();
        await manager.stop();

        expect(mockDistributedEventBus.on).toHaveBeenCalledTimes(2);
        expect(mockConfigChangeUnsubscribe).toHaveBeenCalledTimes(2);
      } finally {
        vi.mocked(acquireLock).mockReset();
      }
    });
  });
}
