import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectionChangeCallbacks,
  eventCallbacks,
  mockGetState,
  mockIsConnected,
  mockOff,
  mockOn,
  mockOnConnectionChange,
  mockSubscribeBatch,
  mockUnsubscribeBatch,
} from './useWebSocketTestHarness';
import {
  useWalletEvents,
} from '../../../hooks/websocket';

const resetUseWalletEventsHarness = (): void => {
  vi.clearAllMocks();
  connectionChangeCallbacks.clear();
  eventCallbacks.clear();

  mockIsConnected.mockReturnValue(true);
  mockGetState.mockReturnValue('connected');

  mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
    connectionChangeCallbacks.add(callback);
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
};

const registerWalletEventSubscriptionTests = (): void => {
    it('should subscribe to wallet on mount', () => {
      const callbacks = {
        onTransaction: vi.fn(),
        onBalance: vi.fn(),
      };

      renderHook(() => useWalletEvents('wallet-123', callbacks));

      expect(mockSubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-123',
        'wallet:wallet-123:transaction',
        'wallet:wallet-123:balance',
        'wallet:wallet-123:confirmation',
        'wallet:wallet-123:sync',
      ]);
    });

    it('should unsubscribe from wallet on unmount', () => {
      const callbacks = {
        onTransaction: vi.fn(),
      };

      const { unmount } = renderHook(() => useWalletEvents('wallet-456', callbacks));

      unmount();

      expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-456',
        'wallet:wallet-456:transaction',
        'wallet:wallet-456:balance',
        'wallet:wallet-456:confirmation',
        'wallet:wallet-456:sync',
      ]);
    });

    it('should not subscribe when walletId is undefined', () => {
      const callbacks = {
        onTransaction: vi.fn(),
      };

      renderHook(() => useWalletEvents(undefined, callbacks));

      expect(mockSubscribeBatch).not.toHaveBeenCalled();
    });
};

const registerWalletEventCallbackTests = (): void => {
    it('should call onTransaction callback when transaction event is received', async () => {
      const onTransaction = vi.fn();
      const callbacks = { onTransaction };

      renderHook(() => useWalletEvents('wallet-789', callbacks));

      const transactionEvent = {
        event: 'transaction',
        data: { txid: 'tx123', amount: 1000 },
      };

      act(() => {
        eventCallbacks.get('transaction')?.forEach(cb => cb(transactionEvent));
      });

      await waitFor(() => {
        expect(onTransaction).toHaveBeenCalledWith(transactionEvent.data);
      });
    });

    it('should call onBalance callback when balance event is received', async () => {
      const onBalance = vi.fn();
      const callbacks = { onBalance };

      renderHook(() => useWalletEvents('wallet-abc', callbacks));

      const balanceEvent = {
        event: 'balance',
        data: { balance: 5000, confirmed: 5000 },
      };

      act(() => {
        eventCallbacks.get('balance')?.forEach(cb => cb(balanceEvent));
      });

      await waitFor(() => {
        expect(onBalance).toHaveBeenCalledWith(balanceEvent.data);
      });
    });

    it('should call onConfirmation callback when confirmation event is received', async () => {
      const onConfirmation = vi.fn();
      const callbacks = { onConfirmation };

      renderHook(() => useWalletEvents('wallet-def', callbacks));

      const confirmationEvent = {
        event: 'confirmation',
        data: { txid: 'tx456', confirmations: 3 },
      };

      act(() => {
        eventCallbacks.get('confirmation')?.forEach(cb => cb(confirmationEvent));
      });

      await waitFor(() => {
        expect(onConfirmation).toHaveBeenCalledWith(confirmationEvent.data);
      });
    });

    it('should call onSync callback when sync event is received', async () => {
      const onSync = vi.fn();
      const callbacks = { onSync };

      renderHook(() => useWalletEvents('wallet-ghi', callbacks));

      const syncEvent = {
        event: 'sync',
        data: { progress: 0.75, status: 'syncing' },
      };

      act(() => {
        eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
      });

      await waitFor(() => {
        expect(onSync).toHaveBeenCalledWith(syncEvent.data);
      });
    });

    it('should ignore sync events when onSync callback is missing', async () => {
      const onTransaction = vi.fn();
      const callbacks = { onTransaction };

      renderHook(() => useWalletEvents('wallet-no-sync', callbacks));

      const syncEvent = {
        event: 'sync',
        data: { progress: 0.25, status: 'syncing' },
      };

      act(() => {
        eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
      });

    await waitFor(() => {
      expect(onTransaction).not.toHaveBeenCalled();
    });
  });
};

const registerWalletEventUpdateTests = (): void => {
    it('should use latest callbacks without resubscribing', async () => {
      const onTransaction1 = vi.fn();
      const onTransaction2 = vi.fn();

      const { rerender } = renderHook(
        ({ callbacks }) => useWalletEvents('wallet-jkl', callbacks),
        { initialProps: { callbacks: { onTransaction: onTransaction1 } } }
      );

      // Clear subscribe calls from initial mount
      mockSubscribeBatch.mockClear();

      // Update callbacks
      rerender({ callbacks: { onTransaction: onTransaction2 } });

      // Should not resubscribe
      expect(mockSubscribeBatch).not.toHaveBeenCalled();

      const transactionEvent = {
        event: 'transaction',
        data: { txid: 'tx789' },
      };

      act(() => {
        eventCallbacks.get('transaction')?.forEach(cb => cb(transactionEvent));
      });

      // Should use new callback
      await waitFor(() => {
        expect(onTransaction1).not.toHaveBeenCalled();
        expect(onTransaction2).toHaveBeenCalledWith(transactionEvent.data);
      });
    });

    it('should resubscribe when walletId changes', () => {
      const callbacks = { onTransaction: vi.fn() };

      const { rerender } = renderHook(
        ({ walletId }) => useWalletEvents(walletId, callbacks),
        { initialProps: { walletId: 'wallet-old' } }
      );

      mockSubscribeBatch.mockClear();
      mockUnsubscribeBatch.mockClear();

      rerender({ walletId: 'wallet-new' });

      // Should unsubscribe from old wallet (batch)
      expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-old',
        'wallet:wallet-old:transaction',
        'wallet:wallet-old:balance',
        'wallet:wallet-old:confirmation',
        'wallet:wallet-old:sync',
      ]);

      // Should subscribe to new wallet (batch)
      expect(mockSubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-new',
        'wallet:wallet-new:transaction',
        'wallet:wallet-new:balance',
        'wallet:wallet-new:confirmation',
        'wallet:wallet-new:sync',
      ]);
    });
};

export function registerUseWalletEventsTests(): void {
  describe('useWalletEvents', () => {
    beforeEach(resetUseWalletEventsHarness);

    registerWalletEventSubscriptionTests();
    registerWalletEventCallbackTests();
    registerWalletEventUpdateTests();
  });
}
