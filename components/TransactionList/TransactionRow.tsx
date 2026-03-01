import React from 'react';
import { Transaction, Wallet, isMultisigType } from '../../types';
import { Amount } from '../Amount';
import { LabelBadges } from '../LabelSelector';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Clock, Tag, CheckCircle2, ShieldCheck } from 'lucide-react';

interface TransactionRowProps {
  tx: Transaction;
  isReceive: boolean;
  isConsolidation: boolean;
  isHighlighted: boolean;
  txWallet: Wallet | undefined;
  showWalletBadge: boolean;
  walletBalance: number | undefined;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  onWalletClick?: (walletId: string) => void;
  onTxClick: (tx: Transaction) => void;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({
  tx,
  isReceive,
  isConsolidation,
  isHighlighted,
  txWallet,
  showWalletBadge,
  walletBalance,
  confirmationThreshold,
  deepConfirmationThreshold,
  onWalletClick,
  onTxClick,
}) => {
  const isMultisig = isMultisigType(txWallet?.type);

  const badgeClass = isMultisig
    ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
    : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

  const highlightClass = isHighlighted
    ? 'bg-warning-50 dark:bg-warning-950/20'
    : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50';

  return (
    <>
      {/* Date */}
      <td
        className={`px-4 py-3 whitespace-nowrap text-sm text-sanctuary-700 dark:text-sanctuary-300 font-medium cursor-pointer transition-colors ${highlightClass}`}
        onClick={() => onTxClick(tx)}
      >
        {tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : 'Pending'}
      </td>

      {/* Type */}
      <td
        className={`px-4 py-3 whitespace-nowrap cursor-pointer transition-colors ${highlightClass}`}
        onClick={() => onTxClick(tx)}
      >
        <div className="flex items-center space-x-2">
          <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${
            isConsolidation
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
              : isReceive
              ? 'bg-success-100 text-success-600 dark:bg-success-500/10 dark:text-success-400'
              : 'bg-sanctuary-200 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400'
          }`}>
            {isConsolidation ? <RefreshCw className="h-3.5 w-3.5" /> : isReceive ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
          </span>
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {isConsolidation ? 'Consolidation' : isReceive ? 'Received' : 'Sent'}
          </span>
        </div>
      </td>

      {/* Amount */}
      <td
        className={`px-4 py-3 whitespace-nowrap text-right cursor-pointer transition-colors ${highlightClass}`}
        onClick={() => onTxClick(tx)}
      >
        <span className={`text-sm font-semibold ${
          isConsolidation
            ? 'text-primary-600 dark:text-primary-400'
            : isReceive
            ? 'text-success-600 dark:text-success-400'
            : 'text-sanctuary-900 dark:text-sanctuary-100'
        }`}>
          <Amount
            sats={tx.amount}
            showSign={isReceive}
            size="sm"
            className="justify-end"
          />
        </span>
      </td>

      {/* Balance (after this transaction) */}
      {walletBalance !== undefined && (
        <td
          className={`px-4 py-3 whitespace-nowrap text-right cursor-pointer transition-colors ${highlightClass}`}
          onClick={() => onTxClick(tx)}
        >
          <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
            <Amount
              sats={tx.balanceAfter ?? 0}
              size="sm"
              className="justify-end"
            />
          </span>
        </td>
      )}

      {/* Confirmations */}
      <td
        className={`px-4 py-3 whitespace-nowrap text-center cursor-pointer transition-colors ${highlightClass}`}
        onClick={() => onTxClick(tx)}
      >
        <span
          className="inline-flex items-center text-sm font-medium"
          title={tx.confirmations > 0 ? `${tx.confirmations.toLocaleString()} confirmation${tx.confirmations !== 1 ? 's' : ''}` : 'Pending confirmation'}
        >
          {tx.confirmations >= deepConfirmationThreshold ? (
            <>
              <ShieldCheck className="w-3.5 h-3.5 mr-1 text-indigo-500" />
              <span className="text-indigo-600 dark:text-indigo-400">{tx.confirmations?.toLocaleString() || ''}</span>
            </>
          ) : tx.confirmations >= confirmationThreshold ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-success-500" />
              <span className="text-sanctuary-700 dark:text-sanctuary-300">{tx.confirmations}/{deepConfirmationThreshold}</span>
            </>
          ) : tx.confirmations > 0 ? (
            <span className="inline-flex items-center text-primary-600 dark:text-primary-400">
              <Clock className="w-3.5 h-3.5 mr-1" />
              {tx.confirmations}/{deepConfirmationThreshold}
            </span>
          ) : (
            <span className="inline-flex items-center text-warning-600 dark:text-warning-400">
              <Clock className="w-3.5 h-3.5 mr-1" />
              Pending
            </span>
          )}
        </span>
      </td>

      {/* Labels */}
      <td
        className={`px-4 py-3 cursor-pointer transition-colors ${highlightClass}`}
        onClick={() => onTxClick(tx)}
      >
        {(tx.labels && tx.labels.length > 0) ? (
          <LabelBadges labels={tx.labels} maxDisplay={2} size="sm" />
        ) : tx.label ? (
          <span className="inline-flex items-center surface-secondary px-1.5 py-0.5 rounded text-xs text-sanctuary-600 dark:text-sanctuary-300">
            <Tag className="w-2.5 h-2.5 mr-1" />
            {tx.label}
          </span>
        ) : (
          <span className="text-sanctuary-300 dark:text-sanctuary-600">-</span>
        )}
      </td>

      {/* Wallet Badge (optional) */}
      {showWalletBadge && (
        <td
          className={`px-4 py-3 whitespace-nowrap cursor-pointer transition-colors ${highlightClass}`}
          onClick={() => onTxClick(tx)}
        >
          {txWallet && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${badgeClass} ${onWalletClick ? 'cursor-pointer hover:opacity-80' : ''}`}
              onClick={(e) => {
                if (onWalletClick) {
                  e.stopPropagation();
                  onWalletClick(tx.walletId);
                }
              }}
            >
              {txWallet.name}
            </span>
          )}
        </td>
      )}
    </>
  );
};
