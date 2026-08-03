import React from 'react';
import { Transaction, Wallet } from '../../types';
import { TransactionActions } from '../TransactionActions';
import { getTxExplorerUrl } from '../../utils/explorer';
import { isConsolidation } from '../../utils/transaction';
import { ExternalLink, Copy, Check } from 'lucide-react';

interface ActionMenuProps {
  selectedTx: Transaction;
  wallets: Wallet[];
  walletAddresses: string[];
  explorerUrl: string;
  copied: boolean;
  onCopyToClipboard: (text: string) => void;
  onClose: () => void;
  onLabelsChange?: () => void;
}

export const ActionMenu: React.FC<ActionMenuProps> = ({
  selectedTx,
  wallets,
  walletAddresses,
  explorerUrl,
  copied,
  onCopyToClipboard,
  onClose,
  onLabelsChange,
}) => {
  return (
    <div className="space-y-4">
      {/* Transaction ID */}
      <div className="surface-muted p-4 rounded-lg border border-sanctuary-100 dark:border-sanctuary-800">
        <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">Transaction ID</p>
        <div className="flex items-center justify-between">
          <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300 mr-4">
            {selectedTx.txid}
          </code>
          <button
            onClick={() => onCopyToClipboard(selectedTx.txid)}
            className={`p-2 rounded transition-colors ${copied ? 'bg-success-100 dark:bg-success-500/20 text-success-600 dark:text-success-400' : 'hover:bg-sanctuary-200 dark:hover:bg-sanctuary-800 text-sanctuary-500'}`}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? <Check className="w-4 h-4 text-success-500 animate-copy-bounce" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Explorer Link */}
      <a
        href={getTxExplorerUrl(selectedTx.txid, wallets.find(w => w.id === selectedTx.walletId)?.network || 'mainnet', explorerUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center w-full py-3 bg-sanctuary-800 dark:bg-sanctuary-700 text-sanctuary-50 dark:text-sanctuary-100 rounded-lg hover:bg-sanctuary-700 dark:hover:bg-sanctuary-600 transition-colors font-medium"
      >
        <ExternalLink className="w-4 h-4 mr-2" />
        View on Block Explorer
      </a>

      {/* Transaction Actions (RBF/CPFP) for pending transactions */}
      {selectedTx.confirmations === 0 && (() => {
        // Consolidations are sent BY the user (to themselves), so should show RBF not CPFP
        const isConsolidationTx = isConsolidation(selectedTx, walletAddresses);
        const isReceivedForActions = isConsolidationTx ? false : selectedTx.amount > 0;
        return (
          <TransactionActions
            txid={selectedTx.txid}
            walletId={selectedTx.walletId}
            confirmed={false}
            isReceived={isReceivedForActions}
            onActionComplete={() => {
              onClose();
              onLabelsChange?.();
            }}
          />
        );
      })()}
    </div>
  );
};
