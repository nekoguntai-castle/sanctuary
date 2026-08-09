/**
 * Wallet Events Hook
 *
 * Subscribe to wallet-specific WebSocket events (transactions, balance, confirmations, sync).
 * Uses refs for callbacks to avoid re-subscribing when callbacks change.
 */

import { useEffect, useRef } from 'react';
import { WebSocketChannels } from '@sanctuary/shared/types/websocket';
import { websocketClient, WebSocketEvent } from '../../services/websocket';
import { useWebSocket } from './useWebSocket';
import type {
  WebSocketTransactionData,
  WebSocketBalanceData,
  WebSocketConfirmationData,
  WebSocketSyncData,
} from '../../types';

function isOwnedWalletEvent(event: WebSocketEvent, walletId: string): boolean {
  // Wallet events are broadcast through the client emitter, so the exact
  // server envelope channel is the resource identity boundary.
  if (event.event === 'transaction') {
    return event.channel === WebSocketChannels.walletEvent(walletId, 'transaction');
  }
  if (event.event === 'balance') {
    return event.channel === WebSocketChannels.walletEvent(walletId, 'balance');
  }
  if (event.event === 'confirmation') {
    return event.channel === WebSocketChannels.walletEvent(walletId, 'confirmation');
  }
  if (event.event === 'sync') {
    return event.channel === WebSocketChannels.walletEvent(walletId, 'sync');
  }
  return false;
}

export const useWalletEvents = (
  walletId: string | undefined,
  callbacks: {
    onTransaction?: (data: WebSocketTransactionData) => void;
    onBalance?: (data: WebSocketBalanceData) => void;
    onConfirmation?: (data: WebSocketConfirmationData) => void;
    onSync?: (data: WebSocketSyncData) => void;
  }
) => {
  const { subscribeWallet, unsubscribeWallet } = useWebSocket();

  // Use refs to store callbacks to avoid re-subscribing when callbacks change
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    if (!walletId) return;

    // Subscribe to wallet
    subscribeWallet(walletId);

    // Setup event handlers - use ref to get latest callbacks
    const handleEvent = (event: WebSocketEvent) => {
      if (!isOwnedWalletEvent(event, walletId)) return;
      const cbs = callbacksRef.current;
      if (event.event === 'transaction' && cbs.onTransaction) {
        cbs.onTransaction(event.data as WebSocketTransactionData);
      } else if (event.event === 'balance' && cbs.onBalance) {
        cbs.onBalance(event.data as WebSocketBalanceData);
      } else if (event.event === 'confirmation' && cbs.onConfirmation) {
        cbs.onConfirmation(event.data as WebSocketConfirmationData);
      } else if (event.event === 'sync' && cbs.onSync) {
        cbs.onSync(event.data as WebSocketSyncData);
      }
    };

    websocketClient.on('transaction', handleEvent);
    websocketClient.on('balance', handleEvent);
    websocketClient.on('confirmation', handleEvent);
    websocketClient.on('sync', handleEvent);

    return () => {
      unsubscribeWallet(walletId);
      websocketClient.off('transaction', handleEvent);
      websocketClient.off('balance', handleEvent);
      websocketClient.off('confirmation', handleEvent);
      websocketClient.off('sync', handleEvent);
    };
  }, [walletId, subscribeWallet, unsubscribeWallet]);
};
