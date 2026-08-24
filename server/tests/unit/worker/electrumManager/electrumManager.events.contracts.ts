import { describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
  mockCallbacks,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { acquireLock } from '../../../../src/infrastructure';
import { getAddressSubscriptionKey } from '../../../../src/worker/electrumManager/types';
import { hashBlockHeader } from '../../../../src/services/bitcoin/networkIdentity';
import { setCachedBlockHeight } from '../../../../src/services/bitcoin/blockchain';
import { setupEventHandlers } from '../../../../src/worker/electrumManager/networkConnection';

const BLOCK_HEADER = 'a'.repeat(160);
const SAME_PARENT_REPLACEMENT_HEADER = `${'a'.repeat(64)}${'b'.repeat(96)}`;

export function registerElectrumManagerEventContracts() {
  describe('event handling', () => {
    // The Electrum layer validates header notifications before emitting, so a
    // malformed hex should never reach here. But this listener runs
    // synchronously from the socket 'data' handler in a 24/7 worker, where an
    // uncaught throw from hashBlockHeader would take the process down. Prove the
    // guard drops the block and leaves everything else untouched.
    it('discards a malformed block header without throwing or advancing the tip', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock', token: 'token', expiresAt: Date.now() + 30_000, isLocal: false,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();
      vi.mocked(setCachedBlockHeight).mockClear();
      vi.mocked(mockCallbacks.onNewBlock).mockClear();

      expect(() => mockClient.emit('newBlock', { height: 404, hex: 'not-a-header' }))
        .not.toThrow();

      expect(mockCallbacks.onNewBlock).not.toHaveBeenCalled();
      expect(setCachedBlockHeight).not.toHaveBeenCalled();

      // The connection stays usable: a well-formed header still lands.
      mockClient.emit('newBlock', { height: 405, hex: BLOCK_HEADER });
      expect(mockCallbacks.onNewBlock).toHaveBeenCalledWith(
        'mainnet',
        405,
        hashBlockHeader(BLOCK_HEADER),
      );
    });

    it('invokes callbacks for new blocks and address activity', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock', token: 'token', expiresAt: Date.now() + 30_000, isLocal: false,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet
        .set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });

      mockClient.emit('newBlock', { height: 123, hex: BLOCK_HEADER });
      mockClient.emit('newBlock', { height: 123, hex: SAME_PARENT_REPLACEMENT_HEADER });
      mockClient.emit('addressActivity', { scriptHash: 'hash', address: 'addr1', status: 'updated' });

      expect(mockCallbacks.onNewBlock).toHaveBeenNthCalledWith(
        1,
        'mainnet',
        123,
        hashBlockHeader(BLOCK_HEADER),
      );
      expect(mockCallbacks.onNewBlock).toHaveBeenNthCalledWith(
        2,
        'mainnet',
        123,
        hashBlockHeader(SAME_PARENT_REPLACEMENT_HEADER),
      );
      expect(hashBlockHeader(SAME_PARENT_REPLACEMENT_HEADER)).not.toBe(
        hashBlockHeader(BLOCK_HEADER),
      );
      expect(mockCallbacks.onAddressActivity).toHaveBeenCalledWith('mainnet', 'hash', 'updated');
    });

    it('ignores block and address events after the manager stops running', () => {
      const state = {
        network: 'mainnet' as const,
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 100,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      setupEventHandlers(state, new Map(), mockCallbacks, () => false, vi.fn());

      mockClient.emit('newBlock', { height: 101, hex: BLOCK_HEADER });
      mockClient.emit('addressActivity', { scriptHash: 'ignored', status: null });

      expect(state.lastBlockHeight).toBe(100);
      expect(setCachedBlockHeight).not.toHaveBeenCalled();
      expect(mockCallbacks.onNewBlock).not.toHaveBeenCalled();
      expect(mockCallbacks.onAddressActivity).not.toHaveBeenCalled();
    });
  });
}
