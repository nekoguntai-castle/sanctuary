import { Wallet, Transaction } from '../../../types';
import { satsToBTC, formatBTC } from '@shared/utils/bitcoin';
import { useWalletEvents } from '../../../hooks/websocket';
import { useNotifications } from '../../../contexts/NotificationContext';
import { createLogger } from '../../../utils/logger';
import type { SyncRetryInfo } from '../types';

const log = createLogger('WalletDetail:WebSocket');

interface UseWalletWebSocketOptions {
  walletId: string | undefined;
  wallet: Wallet | null;
  setWallet: React.Dispatch<React.SetStateAction<Wallet | null>>;
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setSyncing: (syncing: boolean) => void;
  setSyncRetryInfo: (info: SyncRetryInfo | null) => void;
  fetchData: (silent?: boolean) => void;
}

export function useWalletWebSocket({
  walletId,
  wallet,
  setWallet,
  setTransactions,
  setSyncing,
  setSyncRetryInfo,
  fetchData,
}: UseWalletWebSocketOptions) {
  const { addNotification } = useNotifications();

  useWalletEvents(walletId, {
    onTransaction: (data) => {
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
      log.debug('Real-time balance update', { balance: data?.confirmed });

      // Update wallet balance immediately
      if (wallet && data.balance !== undefined) {
        setWallet({ ...wallet, balance: data.balance });
      }

      // Note: Balance notifications are handled globally in Dashboard.tsx
      // to avoid duplicate notifications when this page is open
    },
    onConfirmation: (data) => {
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
      log.debug('Sync status update', { status: data?.status });

      // Update wallet sync status (use functional form to avoid stale closure)
      setWallet(prevWallet => {
        if (!prevWallet) return prevWallet;
        return {
          ...prevWallet,
          syncInProgress: data.inProgress,
          lastSyncStatus: data.status || prevWallet.lastSyncStatus,
          lastSyncedAt: data.lastSyncedAt ? new Date(data.lastSyncedAt).toISOString() : prevWallet.lastSyncedAt,
        };
      });

      // Update retry info
      if (data.status === 'retrying' && data.retryCount !== undefined && data.maxRetries !== undefined) {
        setSyncRetryInfo({
          retryCount: data.retryCount,
          maxRetries: data.maxRetries,
          error: data.error,
        });
      } else if (data.status === 'success' || data.status === 'failed') {
        // Clear retry info on success or final failure
        setSyncRetryInfo(null);
      }

      // If sync completed, clear local syncing state (don't wait for HTTP response)
      if (!data.inProgress) {
        setSyncing(false);
      }

      // If sync completed successfully, refresh data
      if (!data.inProgress && data.status === 'success') {
        fetchData(true);
      }
    },
  });
}
