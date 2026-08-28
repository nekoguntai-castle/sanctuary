import { describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
  mockCallbacks,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { acquireLock } from '../../../../src/infrastructure';
import { getAddressSubscriptionKey } from '../../../../src/worker/electrumManager/types';
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
      vi.mocked(mockCallbacks.onHeaderObservation).mockClear();

      expect(() => mockClient.emit('newBlock', { height: 404, hex: 'not-a-header' }))
        .not.toThrow();

      expect(mockCallbacks.onHeaderObservation).not.toHaveBeenCalled();
      expect(setCachedBlockHeight).not.toHaveBeenCalled();

      // The connection stays usable: a well-formed header still lands.
      mockClient.emit('newBlock', { height: 405, hex: BLOCK_HEADER });
      expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledWith(
        'mainnet',
        { height: 405, hex: BLOCK_HEADER },
        expect.any(Function),
      );
    });

    it('invokes callbacks for new blocks and address activity', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock', token: 'token', expiresAt: Date.now() + 30_000, isLocal: false,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();
      vi.mocked(mockCallbacks.onHeaderObservation).mockClear();

      (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet
        .set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });

      mockClient.emit('newBlock', { height: 123, hex: BLOCK_HEADER });
      mockClient.emit('newBlock', { height: 123, hex: SAME_PARENT_REPLACEMENT_HEADER });
      mockClient.emit('addressActivity', { scriptHash: 'hash', address: 'addr1', status: 'updated' });
      await vi.waitFor(() => expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledTimes(2));

      expect(mockCallbacks.onHeaderObservation).toHaveBeenNthCalledWith(
        1,
        'mainnet',
        { height: 123, hex: BLOCK_HEADER },
        expect.any(Function),
      );
      expect(mockCallbacks.onHeaderObservation).toHaveBeenNthCalledWith(
        2,
        'mainnet',
        { height: 123, hex: SAME_PARENT_REPLACEMENT_HEADER },
        expect.any(Function),
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
      mockClient.emit('subscriptionResponse', { address: 'ignored', sequence: 1 });

      expect(state.lastBlockHeight).toBe(100);
      expect(setCachedBlockHeight).not.toHaveBeenCalled();
      expect(mockCallbacks.onHeaderObservation).not.toHaveBeenCalled();
      expect(mockCallbacks.onAddressActivity).not.toHaveBeenCalled();
    });

    it('does not advance the live tip when ownership is lost during reconciliation', async () => {
      let active = true;
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
      vi.mocked(mockCallbacks.onHeaderObservation).mockImplementationOnce(async (_network, _header, fetch) => {
        await fetch(101, 1);
        active = false;
      });
      setupEventHandlers(state, new Map(), mockCallbacks, () => active, vi.fn());

      mockClient.emit('newBlock', { height: 101, hex: BLOCK_HEADER });
      await vi.waitFor(() => expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledOnce());

      expect(state.lastBlockHeight).toBe(100);
    });

    it('reconnects after a rejected live-header ingress so the tip is replayed', async () => {
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
      const scheduleReconnect = vi.fn();
      vi.mocked(mockCallbacks.onHeaderObservation).mockRejectedValueOnce(new Error('write failed'));
      setupEventHandlers(state, new Map(), mockCallbacks, () => true, scheduleReconnect);

      mockClient.emit('newBlock', { height: 101, hex: BLOCK_HEADER });
      await vi.waitFor(() => expect(state.connected).toBe(false));

      expect(state.lastBlockHeight).toBe(100);
      expect(state.subscribedToHeaders).toBe(false);
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(scheduleReconnect).toHaveBeenCalledWith('mainnet');
    });

    it('does not schedule replay after a live-header rejection caused by ownership loss', async () => {
      let active = true;
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
      const scheduleReconnect = vi.fn();
      vi.mocked(mockCallbacks.onHeaderObservation).mockImplementationOnce(async () => {
        active = false;
        throw new Error('ownership lost');
      });
      setupEventHandlers(state, new Map(), mockCallbacks, () => active, scheduleReconnect);

      mockClient.emit('newBlock', { height: 101, hex: BLOCK_HEADER });
      await vi.waitFor(() => expect(state.connected).toBe(false));

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(scheduleReconnect).not.toHaveBeenCalled();
    });

    it('replaces stale handlers when a cached client is connected again', async () => {
      const oldObservation = vi.fn().mockResolvedValue(undefined);
      const oldState = {
        network: 'mainnet' as const,
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 100,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      const currentState = { ...oldState, subscribedAddresses: new Set<string>() };
      setupEventHandlers(oldState, new Map(), {
        onHeaderObservation: oldObservation,
        onAddressActivity: vi.fn(),
      }, () => true, vi.fn());
      setupEventHandlers(currentState, new Map(), mockCallbacks, () => true, vi.fn());

      mockClient.emit('newBlock', { height: 101, hex: BLOCK_HEADER });
      await vi.waitFor(() => expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledOnce());

      expect(oldObservation).not.toHaveBeenCalled();
      expect(mockClient.listenerCount('newBlock')).toBe(1);
      expect(mockClient.listenerCount('close')).toBe(1);
    });

    it('does not let a detached in-flight handler tear down its replacement connection', async () => {
      let rejectOld!: (error: Error) => void;
      const oldObservation = vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectOld = reject;
      }));
      const oldState = {
        network: 'mainnet' as const,
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 100,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      const currentState = { ...oldState, subscribedAddresses: new Set<string>() };
      setupEventHandlers(oldState, new Map(), {
        onHeaderObservation: oldObservation,
        onAddressActivity: vi.fn(),
      }, () => true, vi.fn());
      mockClient.emit('newBlock', { height: 101, hex: BLOCK_HEADER });
      await vi.waitFor(() => expect(oldObservation).toHaveBeenCalledOnce());

      setupEventHandlers(currentState, new Map(), mockCallbacks, () => true, vi.fn());
      rejectOld(new Error('stale write failed'));
      await Promise.resolve();
      await Promise.resolve();

      expect(currentState.connected).toBe(true);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
      expect(mockClient.listenerCount('newBlock')).toBe(1);
      mockClient.emit('newBlock', { height: 102, hex: BLOCK_HEADER });
      await vi.waitFor(() => expect(mockCallbacks.onHeaderObservation).toHaveBeenCalledOnce());
    });
  });
}
