import { useEffect, useRef } from 'react';
import { Wallet, Transaction } from '../../../types';
import { satsToBTC, formatBTC } from '@sanctuary/shared/utils/bitcoin';
import { useWalletEvents, useWebSocket } from '../../../hooks/websocket';
import { useNotifications } from '../../../contexts/NotificationContext';
import { createLogger } from '../../../utils/logger';
import type { SyncRetryInfo } from '../types';
import { useWalletRouteOwnership } from './useWalletRouteOwnership';
import {
  applyAuthoritativeSyncSnapshot,
  isApplicableSyncSnapshot,
  type SyncSnapshotEvent,
} from '../../../utils/walletSyncSnapshot';

const log = createLogger('WalletDetail:WebSocket');

interface UseWalletWebSocketOptions {
  walletId: string | undefined;
  ownershipKey?: string;
  wallet: Wallet | null;
  setWallet: React.Dispatch<React.SetStateAction<Wallet | null>>;
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setSyncRetryInfo: (info: SyncRetryInfo | null) => void;
  fetchData: (silent?: boolean) => void;
}

export function useWalletWebSocket({
  walletId,
  ownershipKey = walletId ?? '',
  wallet,
  setWallet,
  setTransactions,
  setSyncRetryInfo,
  fetchData,
}: UseWalletWebSocketOptions) {
  const { addNotification } = useNotifications();
  const { connected } = useWebSocket();
  const ownership = useWalletRouteOwnership(ownershipKey);
  const wasConnected = useRef(connected);
  const latestSyncVersion = useRef(wallet?.syncStateVersion);

  useEffect(() => {
    latestSyncVersion.current = wallet?.syncStateVersion;
  }, [wallet?.id, wallet?.syncStateVersion]);

  useEffect(() => {
    const reconnected = connected && !wasConnected.current;
    wasConnected.current = connected;
    if (reconnected && walletId) fetchData(true);
  }, [connected, fetchData, walletId]);

  const ownsEvent = (eventWalletId?: string) => (
    Boolean(walletId)
    && ownership.isRouteOwner(ownership.captureRoute(ownershipKey))
    && (eventWalletId === undefined || eventWalletId === walletId)
  );

  useWalletEvents(walletId, {
    onTransaction: (data) => {
      if (!ownsEvent(data.walletId)) return;
      log.debug('Real-time transaction received', { txid: data?.txid });

      // Determine title based on transaction type
      const title = data.type === 'received' ? 'Bitcoin Received'
        : data.type === 'consolidation' ? 'Consolidation'
        : 'Bitcoin Sent';
      const prefix = data.type === 'received' ? '+' : '-';

      // Show notification
      const amount = data.amount ?? 0;
      addNotification({
        type: 'transaction',
        title,
        message: `${prefix}${formatBTC(satsToBTC(Math.abs(amount)), 8, false)} BTC in ${wallet?.name || 'wallet'}`,
        duration: 10000,
        data,
      });

      // Refresh transaction list
      fetchData(true);
    },
    onBalance: (data) => {
      if (!ownsEvent(data.walletId)) return;
      log.debug('Real-time balance update', { balance: data?.confirmed });

      // Update wallet balance immediately
      const balance = data.balance;
      if (wallet && wallet.id === walletId && balance !== undefined) {
        setWallet(current => current?.id === walletId
          ? { ...current, balance }
          : current);
      }

      // Note: Balance notifications are handled globally in Dashboard.tsx
      // to avoid duplicate notifications when this page is open
    },
    onConfirmation: (data) => {
      if (!ownsEvent(data.walletId)) return;
      log.debug('Transaction confirmation', { txid: data?.txid, confirmations: data?.confirmations });

      // Update transaction confirmations
      const confirmations = data.confirmations ?? 0;
      setTransactions(prev =>
        prev.map(tx =>
          tx.txid === data.txid
            ? { ...tx, confirmations }
            : tx
        )
      );

      // Show notification for important milestones
      if ([1, 3, 6].includes(confirmations)) {
        addNotification({
          type: 'confirmation',
          title: 'Transaction Confirmed',
          message: `${confirmations} confirmation${confirmations > 1 ? 's' : ''} reached`,
          duration: 5000,
          data,
        });
      }
    },
    onSync: (data) => {
      if (!ownsEvent(data.walletId)) return;
      const snapshot = data as typeof data & SyncSnapshotEvent;
      if (!isApplicableSyncSnapshot(
        latestSyncVersion.current,
        snapshot.stateVersion,
      )) return;
      if (snapshot.stateVersion !== undefined) {
        latestSyncVersion.current = snapshot.stateVersion;
      }
      log.debug('Sync status update', { status: data?.status });

      // Update wallet sync status (use functional form to avoid stale closure)
      setWallet(prevWallet => {
        if (!prevWallet || prevWallet.id !== walletId) return prevWallet;
        return applyAuthoritativeSyncSnapshot(prevWallet, snapshot);
      });

      // Update retry info
      if (data.status === 'retrying' && data.retryCount !== undefined && data.maxRetries !== undefined) {
        setSyncRetryInfo({
          retryCount: data.retryCount,
          maxRetries: data.maxRetries,
          error: data.error ?? undefined,
        });
      } else if (data.status === 'success' || data.status === 'failed') {
        // Clear retry info on success or final failure
        setSyncRetryInfo(null);
      }

      // If sync completed successfully, refresh data
      if (data.inProgress === false && data.status === 'success') {
        fetchData(true);
      }
    },
  });
}
