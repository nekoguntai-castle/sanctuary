import { describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
  mockCallbacks,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { acquireLock } from '../../../../src/infrastructure';
import { getAddressSubscriptionKey } from '../../../../src/worker/electrumManager/types';

export function registerElectrumManagerEventContracts() {
  describe('event handling', () => {
    it('invokes callbacks for new blocks and address activity', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock', token: 'token', expiresAt: Date.now() + 30_000, isLocal: false,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet
        .set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });

      mockClient.emit('newBlock', { height: 123, hex: 'a'.repeat(80) });
      mockClient.emit('addressActivity', { scriptHash: 'hash', address: 'addr1', status: 'updated' });

      expect(mockCallbacks.onNewBlock).toHaveBeenCalledWith('mainnet', 123, 'a'.repeat(64));
      expect(mockCallbacks.onAddressActivity).toHaveBeenCalledWith('mainnet', 'wallet1', 'addr1');
    });
  });
}
