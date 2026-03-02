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

import { useEffect } from 'react';
import { websocketClient, WebSocketEvent } from '../../services/websocket';
import { getQueryClient } from '../../providers/QueryProvider';
import { useWebSocket } from './useWebSocket';

export const useWebSocketQueryInvalidation = () => {
  const { connected, subscribeBatch, unsubscribeBatch } = useWebSocket();

  useEffect(() => {
    if (!connected) return;

    // Subscribe to global channels (batch for efficiency)
    const globalChannels = ['blocks', 'sync:all', 'transactions:all', 'logs:all'];
    subscribeBatch(globalChannels);

    const handleTransactionEvent = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;

      // Invalidate pending transactions when any transaction event occurs
      if (event.event === 'transaction' || event.event === 'confirmation') {
        // Invalidate pending transactions query (Dashboard block visualization)
        queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
        // Also invalidate recent transactions query
        queryClient.invalidateQueries({ queryKey: ['recentTransactions'] });
      }

      // Invalidate wallet balance when balance changes
      if (event.event === 'balance') {
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
      }
    };

    // Handle new block events - immediately refresh confirmations
    const handleNewBlock = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;
      if (event.event !== 'newBlock') return;

      // Invalidate pending transactions to show updated confirmations
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['recentTransactions'] });
      // Also refresh wallets since UTXOs may have new confirmations
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
    };

    // Handle sync events - directly update wallet cache for immediate UI response
    // This ensures all pages (Dashboard, WalletList, WalletDetail) see sync status changes
    const handleSyncEvent = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;
      if (event.event !== 'sync') return;

      const { walletId, inProgress, status } = event.data as {
        walletId: string;
        inProgress: boolean;
        status?: string;
      };

      if (!walletId) return;

      // Directly update wallet list cache
      queryClient.setQueryData(['wallets', 'list'], (oldData: any[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((wallet: any) =>
          wallet.id === walletId
            ? {
                ...wallet,
                syncInProgress: inProgress,
                ...(status && { lastSyncStatus: status }),
                ...(!inProgress && { lastSyncedAt: new Date().toISOString() }),
              }
            : wallet
        );
      });

      // Also update individual wallet cache if it exists
      queryClient.setQueryData(['wallets', 'detail', walletId], (oldData: any | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          syncInProgress: inProgress,
          ...(status && { lastSyncStatus: status }),
          ...(!inProgress && { lastSyncedAt: new Date().toISOString() }),
        };
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
