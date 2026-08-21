/**
 * WebSocket Query Invalidation Hook
 *
 * Invalidate React Query cache when WebSocket events are received.
 * This ensures that Dashboard pending transactions update immediately
 * when a transaction is confirmed, received, or when a new block arrives.
 *
 * BLOCK CONFIRMATION SPEED:
 * Previously, confirmations only updated when the backend finished processing
 * all wallets and sent individual 'confirmation' events. This was slow compared
 * to Sparrow Wallet which updates immediately on new blocks.
 *
 * Now we subscribe to 'blocks' channel and listen for 'newBlock' events,
 * which are broadcast immediately when Electrum notifies of a new block.
 * This triggers an immediate cache invalidation, making the UI react
 * as fast as Sparrow does.
 */

import { useEffect, useRef } from 'react';
import { WebSocketChannels } from '@sanctuary/shared/types/websocket';
import { websocketClient, WebSocketEvent } from '../../services/websocket';
import { getQueryClient } from '../../providers/QueryProvider';
import { walletActivityKeys, walletKeys } from '../queries/useWallets';
import { useWebSocket } from './useWebSocket';
import {
  applyAuthoritativeSyncSnapshot,
  type SyncSnapshotEvent,
} from '../../utils/walletSyncSnapshot';

export const useWebSocketQueryInvalidation = () => {
  const { connected, subscribeBatch, unsubscribeBatch } = useWebSocket();
  const wasConnected = useRef(connected);

  useEffect(() => {
    const reconnected = connected && !wasConnected.current;
    wasConnected.current = connected;
    if (!reconnected) return;

    // The socket is replaceable delivery, not the source of truth. Refetch the
    // persisted snapshot after every reconnect to recover missed transitions.
    getQueryClient()?.invalidateQueries({ queryKey: walletKeys.all });
  }, [connected]);

  useEffect(() => {
    if (!connected) return;

    // Subscribe to global channels (batch for efficiency)
    const globalChannels = WebSocketChannels.allGlobal();
    subscribeBatch(globalChannels);

    const handleTransactionEvent = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;

      // Invalidate pending transactions when any transaction event occurs
      if (event.event === 'transaction' || event.event === 'confirmation') {
        // Invalidate pending transactions query (Dashboard block visualization)
        queryClient.invalidateQueries({ queryKey: walletActivityKeys.pendingTransactions.all });
        // Also invalidate recent transactions query
        queryClient.invalidateQueries({ queryKey: walletActivityKeys.recentTransactions.all });
        // ...and the period totals shown above that list, or a new transaction
        // would appear in the list under a summary still reporting the old
        // count for as long as the dashboard stayed open.
        queryClient.invalidateQueries({ queryKey: walletActivityKeys.activitySummary.all });
      }

      // Invalidate wallet balance when balance changes
      if (event.event === 'balance') {
        queryClient.invalidateQueries({ queryKey: walletKeys.all });
      }
    };

    // Handle new block events - immediately refresh confirmations
    const handleNewBlock = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;
      if (event.event !== 'newBlock') return;

      // Invalidate pending transactions to show updated confirmations
      queryClient.invalidateQueries({ queryKey: walletActivityKeys.pendingTransactions.all });
      queryClient.invalidateQueries({ queryKey: walletActivityKeys.recentTransactions.all });
      // A new block confirms transactions, which changes the confirmed-only
      // period totals.
      queryClient.invalidateQueries({ queryKey: walletActivityKeys.activitySummary.all });
      // Also refresh wallets since UTXOs may have new confirmations
      queryClient.invalidateQueries({ queryKey: walletKeys.all });
    };

    // Handle sync events - directly update wallet cache for immediate UI response
    // This ensures all pages (Dashboard, WalletList, WalletDetail) see sync status changes
    const handleSyncEvent = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;
      if (event.event !== 'sync') return;

      const { walletId, ...snapshot } = event.data as SyncSnapshotEvent & {
        walletId?: string;
      };

      if (!walletId) return;

      // Directly update wallet list cache
      queryClient.setQueryData(walletKeys.lists(), (oldData: Record<string, unknown>[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((wallet) =>
          wallet.id === walletId
            ? applyAuthoritativeSyncSnapshot(wallet, snapshot)
            : wallet
        );
      });

      // Also update individual wallet cache if it exists
      queryClient.setQueryData(walletKeys.detail(walletId), (oldData: Record<string, unknown> | undefined) => {
        if (!oldData) return oldData;
        return applyAuthoritativeSyncSnapshot(oldData, snapshot);
      });
    };

    websocketClient.on('transaction', handleTransactionEvent);
    websocketClient.on('confirmation', handleTransactionEvent);
    websocketClient.on('balance', handleTransactionEvent);
    websocketClient.on('newBlock', handleNewBlock);
    websocketClient.on('sync', handleSyncEvent);

    return () => {
      unsubscribeBatch(globalChannels);
      websocketClient.off('transaction', handleTransactionEvent);
      websocketClient.off('confirmation', handleTransactionEvent);
      websocketClient.off('balance', handleTransactionEvent);
      websocketClient.off('newBlock', handleNewBlock);
      websocketClient.off('sync', handleSyncEvent);
    };
  }, [connected, subscribeBatch, unsubscribeBatch]);
};
