import React, { useState } from 'react';
import { RefreshCw, AlertTriangle, X } from 'lucide-react';
import { TabNetwork } from './NetworkTabs';
import * as syncApi from '../src/api/sync';
import { extractErrorMessage } from '../utils/errorHandler';

interface NetworkSyncActionsProps {
  network: TabNetwork;
  walletCount: number;
  className?: string;
  compact?: boolean; // Icon-only mode for header
  onSyncStarted?: () => void;
}

export const NetworkSyncActions: React.FC<NetworkSyncActionsProps> = ({
  network,
  walletCount,
  className = '',
  compact = false,
  onSyncStarted,
}) => {
  const [syncing, setSyncing] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [showResyncDialog, setShowResyncDialog] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const networkLabel = network.charAt(0).toUpperCase() + network.slice(1);

  const handleSyncAll = async () => {
    setSyncing(true);
    setResult(null);

    try {
      const response = await syncApi.syncNetworkWallets(network);
      setResult({
        type: 'success',
        message: `Queued ${response.queued} wallet${response.queued !== 1 ? 's' : ''} for sync`,
      });
      onSyncStarted?.();
    } catch (error) {
      setResult({
        type: 'error',
        message: extractErrorMessage(error, 'Failed to queue wallets for sync'),
      });
    } finally {
      setSyncing(false);
      // Clear result after 5 seconds
      setTimeout(() => setResult(null), 5000);
    }
  };

  const handleResyncAll = async () => {
    setShowResyncDialog(false);
    setResyncing(true);
    setResult(null);

    try {
      const response = await syncApi.resyncNetworkWallets(network);
      setResult({
        type: 'success',
        message: `Cleared ${response.deletedTransactions} transactions. Queued ${response.queued} wallet${response.queued !== 1 ? 's' : ''} for resync.`,
      });
      onSyncStarted?.();
    } catch (error) {
      setResult({
        type: 'error',
        message: extractErrorMessage(error, 'Failed to resync wallets'),
      });
    } finally {
      setResyncing(false);
      // Clear result after 8 seconds
      setTimeout(() => setResult(null), 8000);
    }
  };

  const isDisabled = walletCount === 0;

  // Compact mode - icon-only buttons for header
  if (compact) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <button
          onClick={handleSyncAll}
          disabled={isDisabled || syncing || resyncing}
          title={syncing ? 'Syncing...' : `Sync all ${networkLabel} wallets`}
          className={`
            p-2 rounded-lg transition-all
            ${isDisabled
              ? 'text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
              : syncing
                ? 'text-primary-600 dark:text-primary-400 bg-primary-100 dark:bg-primary-900/30'
                : 'text-sanctuary-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
            }
          `}
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => setShowResyncDialog(true)}
          disabled={isDisabled || syncing || resyncing}
          title={resyncing ? 'Resyncing...' : `Full resync all ${networkLabel} wallets`}
          className={`
            p-2 rounded-lg transition-all
            ${isDisabled
              ? 'text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
              : resyncing
                ? 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30'
                : 'text-sanctuary-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
            }
          `}
        >
          <AlertTriangle className={`w-4 h-4 ${resyncing ? 'animate-pulse' : ''}`} />
        </button>

        {/* Resync Confirmation Dialog */}
        {showResyncDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-sanctuary-900 rounded-2xl p-6 max-w-md mx-4 shadow-2xl border border-sanctuary-200 dark:border-sanctuary-700">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg mr-3">
                    <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                    Full Resync All {networkLabel} Wallets
                  </h3>
                </div>
                <button
                  onClick={() => setShowResyncDialog(false)}
                  className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mb-6 text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-2">
                <p>This will:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Clear all transaction history for {walletCount} wallet{walletCount !== 1 ? 's' : ''}</li>
                  <li>Clear all UTXO data</li>
                  <li>Reset address derivation tracking</li>
                  <li>Re-sync everything from the blockchain</li>
                </ul>
                <p className="mt-3 text-amber-600 dark:text-amber-400 font-medium">
                  This may take several minutes.
                </p>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowResyncDialog(false)}
                  className="px-4 py-2 text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-sanctuary-100 dark:bg-sanctuary-800 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResyncAll}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors"
                >
                  Resync All Wallets
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full mode - text buttons
  return (
    <div className={`${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        {/* Sync All Button */}
        <button
          onClick={handleSyncAll}
          disabled={isDisabled || syncing || resyncing}
          className={`
            inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${isDisabled
              ? 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
              : syncing
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                : 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 border border-primary-200 dark:border-primary-800'
            }
          `}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : `Sync All ${networkLabel}`}
        </button>

        {/* Full Resync Button */}
        <button
          onClick={() => setShowResyncDialog(true)}
          disabled={isDisabled || syncing || resyncing}
          className={`
            inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${isDisabled
              ? 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
              : resyncing
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800'
            }
          `}
        >
          <AlertTriangle className={`w-4 h-4 mr-2 ${resyncing ? 'animate-pulse' : ''}`} />
          {resyncing ? 'Resyncing...' : `Full Resync All ${networkLabel}`}
        </button>

        {/* Result message */}
        {result && (
          <span className={`text-sm ${
            result.type === 'success'
              ? 'text-success-600 dark:text-success-400'
              : 'text-rose-600 dark:text-rose-400'
          }`}>
            {result.message}
          </span>
        )}
      </div>

      {/* Resync Confirmation Dialog */}
      {showResyncDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-sanctuary-900 rounded-2xl p-6 max-w-md mx-4 shadow-2xl border border-sanctuary-200 dark:border-sanctuary-700">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg mr-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                  Full Resync All {networkLabel} Wallets
                </h3>
              </div>
              <button
                onClick={() => setShowResyncDialog(false)}
                className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6 text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-2">
              <p>This will:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Clear all transaction history for {walletCount} wallet{walletCount !== 1 ? 's' : ''}</li>
                <li>Clear all UTXO data</li>
                <li>Reset address derivation tracking</li>
                <li>Re-sync everything from the blockchain</li>
              </ul>
              <p className="mt-3 text-amber-600 dark:text-amber-400 font-medium">
                This may take several minutes.
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowResyncDialog(false)}
                className="px-4 py-2 text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-sanctuary-100 dark:bg-sanctuary-800 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResyncAll}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors"
              >
                Resync All Wallets
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkSyncActions;
