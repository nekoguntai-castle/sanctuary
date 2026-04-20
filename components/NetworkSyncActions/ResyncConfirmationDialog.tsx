import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ResyncConfirmationDialogProps {
  networkLabel: string;
  walletCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ResyncConfirmationDialog: React.FC<ResyncConfirmationDialogProps> = ({
  networkLabel,
  walletCount,
  onCancel,
  onConfirm,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-white dark:bg-sanctuary-900 rounded-xl p-6 max-w-md mx-4 shadow-2xl border border-sanctuary-200 dark:border-sanctuary-700">
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
          type="button"
          onClick={onCancel}
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
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-sanctuary-100 dark:bg-sanctuary-800 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors"
        >
          Resync All Wallets
        </button>
      </div>
    </div>
  </div>
);
