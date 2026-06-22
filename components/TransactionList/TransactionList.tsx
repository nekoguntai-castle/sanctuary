import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Transaction, Wallet, Label } from '../../types';
import { usePriceFreeFormatter } from '../../contexts/CurrencyContext';
import { useAIStatus } from '../../hooks/useAIStatus';
import { useTransactionList } from './hooks/useTransactionList';
import type { TransactionStats } from '../../src/api/transactions';
import { TransactionDetail } from './TransactionList/TransactionDetail';
import { TransactionStatsGrid } from './TransactionList/TransactionStatsGrid';
import { TransactionTable } from './TransactionList/TransactionTable';
import type { TransactionDetailsContentProps } from './TransactionList/types';

// Stable empty arrays to prevent re-renders when props aren't provided
const EMPTY_WALLETS: Wallet[] = [];
const EMPTY_ADDRESSES: string[] = [];

interface TransactionListProps {
  transactions: Transaction[];
  showWalletBadge?: boolean;
  wallets?: Wallet[];
  walletAddresses?: string[]; // All addresses belonging to this wallet for consolidation detection
  onWalletClick?: (walletId: string) => void;
  onTransactionClick?: (transaction: Transaction) => void;
  highlightedTxId?: string;
  onLabelsChange?: () => void;
  canEdit?: boolean; // Whether user can edit labels. Defaults closed when omitted.
  confirmationThreshold?: number; // Number of confirmations required (from system settings)
  deepConfirmationThreshold?: number; // Number of confirmations for "deeply confirmed" status
  walletBalance?: number; // Current wallet balance in sats for showing running balance column
  transactionStats?: TransactionStats; // Pre-computed stats from API (for all transactions, not just displayed)
  walletLabels?: Label[];
}

const EMPTY_LABELS: Label[] = [];

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  showWalletBadge = false,
  wallets = EMPTY_WALLETS,
  walletAddresses = EMPTY_ADDRESSES,
  walletLabels = EMPTY_LABELS,
  onWalletClick,
  onTransactionClick,
  highlightedTxId,
  onLabelsChange,
  canEdit = false,
  confirmationThreshold = 1,
  deepConfirmationThreshold = 3,
  walletBalance,
  transactionStats,
}) => {
  const { format } = usePriceFreeFormatter();
  const { enabled: aiEnabled } = useAIStatus();

  const {
    selectedTx,
    clearSelectedTx,
    ownsSelection,
    explorerUrl,
    copied,
    editingLabels,
    setEditingLabels,
    availableLabels,
    selectedLabelIds,
    savingLabels,
    fullTxDetails,
    loadingDetails,
    filteredTransactions,
    virtuosoRef,
    txStats,
    getWallet,
    copyToClipboard,
    handleTxClick,
    handleEditLabels,
    handleSaveLabels,
    handleToggleLabel,
    handleAISuggestion,
    getTxTypeInfo,
  } = useTransactionList({
    transactions,
    wallets,
    walletAddresses,
    walletLabels,
    onTransactionClick,
    onLabelsChange,
    highlightedTxId,
    transactionStats,
  });

  // Dynamic height: fill remaining viewport space instead of fixed 600px cap
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [tableHeight, setTableHeight] = useState(600);

  const recalcHeight = useCallback(() => {
    if (tableContainerRef.current) {
      const rect = tableContainerRef.current.getBoundingClientRect();
      const bottomMargin = 32; // breathing room at bottom
      const available = window.innerHeight - rect.top - bottomMargin;
      const contentHeight = filteredTransactions.length * 52 + 48;
      setTableHeight(Math.max(300, Math.min(contentHeight, available)));
    }
  }, [filteredTransactions.length]);

  useEffect(() => {
    recalcHeight();
    window.addEventListener('resize', recalcHeight);
    return () => window.removeEventListener('resize', recalcHeight);
  }, [recalcHeight]);

  // Early return AFTER all hooks have been called
  if (filteredTransactions.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sanctuary-400 dark:text-sanctuary-500">No transactions found.</p>
      </div>
    );
  }

  // Shared by the phone modal and the tablet+ split pane — both render the same
  // TransactionDetailsBody, so the detail props are assembled once here.
  const detailProps: Omit<TransactionDetailsContentProps, 'selectedTx'> = {
    wallets,
    walletAddresses,
    explorerUrl,
    copied,
    fullTxDetails,
    loadingDetails,
    editingLabels,
    availableLabels,
    selectedLabelIds,
    savingLabels,
    canEdit,
    aiEnabled,
    confirmationThreshold,
    deepConfirmationThreshold,
    format,
    onClose: clearSelectedTx,
    onLabelsChange,
    onCopyToClipboard: copyToClipboard,
    onEditLabels: handleEditLabels,
    onSaveLabels: handleSaveLabels,
    onCancelEdit: () => setEditingLabels(false),
    onToggleLabel: handleToggleLabel,
    onAISuggestion: handleAISuggestion,
  };

  return (
    <>
      <TransactionStatsGrid txStats={txStats} />

      <div className={ownsSelection ? 'tablet:flex tablet:gap-4 tablet:items-start' : undefined}>
        <div
          ref={tableContainerRef}
          className={ownsSelection ? 'tablet:flex-1 tablet:min-w-0' : undefined}
        >
          <TransactionTable
            filteredTransactions={filteredTransactions}
            virtuosoRef={virtuosoRef}
            tableHeight={tableHeight}
            showWalletBadge={showWalletBadge}
            walletBalance={walletBalance}
            confirmationThreshold={confirmationThreshold}
            deepConfirmationThreshold={deepConfirmationThreshold}
            highlightedTxId={highlightedTxId}
            getWallet={getWallet}
            getTxTypeInfo={getTxTypeInfo}
            onWalletClick={onWalletClick}
            onTxClick={handleTxClick}
          />
        </div>

        {ownsSelection && (
          <TransactionDetail selectedTx={selectedTx} tableHeight={tableHeight} {...detailProps} />
        )}
      </div>
    </>
  );
};
