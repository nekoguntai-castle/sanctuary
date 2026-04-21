import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectionChangeCallbacks,
  eventCallbacks,
  flushPromises,
  mockGetState,
  mockInvalidateQueries,
  mockIsConnected,
  mockOff,
  mockOffConnectionChange,
  mockOn,
  mockOnConnectionChange,
  mockSetQueryData,
  mockSubscribeBatch,
  mockUnsubscribeBatch,
} from './useWebSocketTestHarness';
import {
  useWebSocketQueryInvalidation,
} from '../../../hooks/websocket';

function resetUseWebSocketQueryInvalidationHarness(): void {
  vi.clearAllMocks();
  connectionChangeCallbacks.clear();
  eventCallbacks.clear();

  mockIsConnected.mockReturnValue(true);
  mockGetState.mockReturnValue('connected');

  mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
    connectionChangeCallbacks.add(callback);
  });

  mockOffConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
    connectionChangeCallbacks.delete(callback);
  });

  mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
    if (!eventCallbacks.has(eventType)) {
      eventCallbacks.set(eventType, new Set());
    }
    eventCallbacks.get(eventType)!.add(callback);
  });

  mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
    const callbacks = eventCallbacks.get(eventType);
    if (callbacks) {
      callbacks.delete(callback);
    }
  });
}

function emitWebSocketEvent(eventType: string, event: unknown): void {
  act(() => {
    eventCallbacks.get(eventType)?.forEach(cb => cb(event));
  });
}

function registerGlobalChannelSubscriptionTests(): void {
  describe('Global Channel Subscriptions', () => {
    it('should subscribe to global channels when connected', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalledWith([
          'blocks',
          'sync:all',
          'transactions:all',
          'logs:all',
        ]);
      });
    });

    it('should not subscribe when disconnected', () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      renderHook(() => useWebSocketQueryInvalidation());

      expect(mockSubscribeBatch).not.toHaveBeenCalled();
    });

    it('should unsubscribe from global channels on unmount', async () => {
      mockIsConnected.mockReturnValue(true);

      const { unmount } = renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalledWith([
          'blocks',
          'sync:all',
          'transactions:all',
          'logs:all',
        ]);
      });

      unmount();

      expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
        'blocks',
        'sync:all',
        'transactions:all',
        'logs:all',
      ]);
    });

    it('should subscribe when connection is established', async () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      renderHook(() => useWebSocketQueryInvalidation());

      expect(mockSubscribeBatch).not.toHaveBeenCalled();

      // Simulate connection
      act(() => {
        mockIsConnected.mockReturnValue(true);
        mockGetState.mockReturnValue('connected');
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalledWith([
          'blocks',
          'sync:all',
          'transactions:all',
          'logs:all',
        ]);
      });
    });
  });
}

function registerTransactionEventHandlingTests(): void {
  describe('Transaction Event Handling', () => {
    it('should invalidate queries on transaction event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      // Wait for subscriptions and event listeners to be set up
      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
        expect(mockOn).toHaveBeenCalledWith('transaction', expect.any(Function));
      });

      const transactionEvent = {
        event: 'transaction',
        data: { txid: 'tx123', amount: 1000 },
      };

      emitWebSocketEvent('transaction', transactionEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['pendingTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['recentTransactions'] });
      });
    });

    it('should invalidate queries on confirmation event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const confirmationEvent = {
        event: 'confirmation',
        data: { txid: 'tx456', confirmations: 3 },
      };

      emitWebSocketEvent('confirmation', confirmationEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['pendingTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['recentTransactions'] });
      });
    });

    it('should invalidate wallets query on balance event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const balanceEvent = {
        event: 'balance',
        data: { balance: 5000, confirmed: 5000 },
      };

      emitWebSocketEvent('balance', balanceEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['wallets'] });
      });
    });
  });
}

function registerNewBlockEventHandlingTests(): void {
  describe('New Block Event Handling', () => {
    it('should invalidate all relevant queries on newBlock event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const newBlockEvent = {
        event: 'newBlock',
        data: { height: 800000 },
      };

      emitWebSocketEvent('newBlock', newBlockEvent);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['pendingTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['recentTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['wallets'] });
      });
    });

    it('should ignore non-newBlock events in newBlock handler', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const otherEvent = {
        event: 'transaction',
        data: { txid: 'tx789' },
      };

      // Clear previous calls
      mockInvalidateQueries.mockClear();

      emitWebSocketEvent('newBlock', otherEvent);

      // Should not invalidate from newBlock handler (wrong event type)
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['wallets'] });
    });
  });
}

function registerSyncEventHandlingTests(): void {
  describe('Sync Event Handling', () => {
    it('should update wallet list cache on sync event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const syncEvent = {
        event: 'sync',
        data: {
          walletId: 'wallet-123',
          inProgress: true,
          status: 'scanning',
        },
      };

      emitWebSocketEvent('sync', syncEvent);

      await waitFor(() => {
        expect(mockSetQueryData).toHaveBeenCalledWith(
          ['wallets', 'list'],
          expect.any(Function)
        );
        expect(mockSetQueryData).toHaveBeenCalledWith(
          ['wallets', 'detail', 'wallet-123'],
          expect.any(Function)
        );
      });
    });

    it('should ignore sync events without walletId', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const syncEvent = {
        event: 'sync',
        data: {
          inProgress: true,
          status: 'scanning',
        },
      };

      mockSetQueryData.mockClear();

      emitWebSocketEvent('sync', syncEvent);

      // Should not update cache without walletId
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });

    it('should ignore non-sync events in sync handler', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const otherEvent = {
        event: 'transaction',
        data: { walletId: 'wallet-456' },
      };

      mockSetQueryData.mockClear();

      emitWebSocketEvent('sync', otherEvent);

      // Should not update cache for wrong event type
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });

    it('should update wallet with sync complete status', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const syncEvent = {
        event: 'sync',
        data: {
          walletId: 'wallet-789',
          inProgress: false,
          status: 'complete',
        },
      };

      emitWebSocketEvent('sync', syncEvent);

      await waitFor(() => {
        expect(mockSetQueryData).toHaveBeenCalledWith(
          ['wallets', 'list'],
          expect.any(Function)
        );
      });

      // Test the updater function
      const listUpdater = mockSetQueryData.mock.calls.find(
        call => call[0][0] === 'wallets' && call[0][1] === 'list'
      )?.[1];

      const mockWallets = [
        { id: 'wallet-789', name: 'Test Wallet', syncInProgress: true },
        { id: 'wallet-other', name: 'Other Wallet', syncInProgress: false },
      ];

      const result = listUpdater(mockWallets);

      expect(result[0].syncInProgress).toBe(false);
      expect(result[0].lastSyncStatus).toBe('complete');
      expect(result[0].lastSyncedAt).toBeDefined();
      expect(result[1].syncInProgress).toBe(false); // Unchanged
    });
  });
}

function registerEventListenerCleanupTests(): void {
  describe('Event Listener Cleanup', () => {
    it('should remove all event listeners on unmount', async () => {
      mockIsConnected.mockReturnValue(true);

      const { unmount } = renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('transaction', expect.any(Function));
      });

      unmount();

      expect(mockOff).toHaveBeenCalledWith('transaction', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('confirmation', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('balance', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('newBlock', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('sync', expect.any(Function));
    });
  });
}

export function registerUseWebSocketQueryInvalidationTests(): void {
  describe('useWebSocketQueryInvalidation', () => {
    beforeEach(resetUseWebSocketQueryInvalidationHarness);

    registerGlobalChannelSubscriptionTests();
    registerTransactionEventHandlingTests();
    registerNewBlockEventHandlingTests();
    registerSyncEventHandlingTests();
    registerEventListenerCleanupTests();
  });
}
