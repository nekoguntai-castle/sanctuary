import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Transaction, Wallet, Label } from '../../types';
import { usePriceFreeFormatter } from '../../contexts/CurrencyContext';
import { useAIStatus } from '../../hooks/useAIStatus';
import { useTransactionList } from './hooks/useTransactionList';
import type { TransactionStats } from '../../api/transactions';
import { TransactionDetail } from './TransactionList/TransactionDetail';
import { TransactionDetailsBody } from './TransactionList/TransactionDetailsBody';
import { TransactionDetailsHeader } from './TransactionList/TransactionDetailsHeader';
import { SIDE_BY_SIDE_DETAIL_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { TransactionStatsGrid } from './TransactionList/TransactionStatsGrid';
import { TransactionTable } from './TransactionList/TransactionTable';
import type { TransactionDetailsContentProps } from './TransactionList/types';

// Stable empty arrays to prevent re-renders when props aren't provided
const EMPTY_WALLETS: Wallet[] = [];
const EMPTY_ADDRESSES: string[] = [];

interface TransactionListProps {
  transactions: Transaction[];
  walletId?: string;
  selectionTransactions?: Transaction[];
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
  /**
   * The request failed and returned nothing, so an empty list means "we could
   * not ask" rather than "there is nothing". Without this the table asserts
   * "No transactions found" under a header already saying it could not tell.
   */
  unavailable?: boolean;
  /**
   * `'comfortable'` (default) is the wallet-detail presentation: the seven-tile
   * statistics grid, and an empty state that reserves 300px so the viewport
   * doesn't collapse.
   *
   * `'compact'` is for previews that show a page of a larger set. It drops the
   * statistics — they would describe only the loaded page and read as totals for
   * everything — and lets the empty state size to its content.
   */
  density?: 'comfortable' | 'compact';
}

const EMPTY_LABELS: Label[] = [];

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  walletId,
  selectionTransactions,
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
  density = 'comfortable',
  unavailable = false,
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
    availableLabels,
    selectedLabelIds,
    savingLabels,
    labelMutationError,
    fullTxDetails,
    loadingDetails,
    selectionStatus,
    selectionError,
    retrySelection,
    filteredTransactions,
    virtuosoRef,
    txStats,
    getWallet,
    copyToClipboard,
    handleTxClick,
    handleEditLabels,
    handleSaveLabels,
    handleCancelEdit,
    handleToggleLabel,
    handleAISuggestion,
    getTxTypeInfo,
  } = useTransactionList({
    transactions,
    walletId,
    selectionTransactions,
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
    const container = tableContainerRef.current;
    /* v8 ignore next -- the ResizeObserver below can fire after unmount. */
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const bottomMargin = 32; // breathing room at bottom
    const available = window.innerHeight - rect.top - bottomMargin;
    const contentHeight = filteredTransactions.length * 52 + 48;
    // The comfortable floor keeps the wallet-detail viewport from collapsing. A
    // compact preview showing three rows should be three rows tall, so its floor
    // only has to clear the header row.
    const minHeight = density === 'comfortable' ? 300 : 100;
    setTableHeight(Math.max(minHeight, Math.min(contentHeight, available)));
  }, [filteredTransactions.length, density]);

  useEffect(() => {
    recalcHeight();
    window.addEventListener('resize', recalcHeight);

    // A window resize is not the only thing that invalidates this measurement.
    // Inside a collapsed disclosure the container measures zero, and revealing
    // it changes no window dimension and fires no resize event — so without an
    // element-level observer the table would keep the height it computed while
    // hidden until the user happened to resize.
    const resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(recalcHeight) : null;
    const container = tableContainerRef.current;
    /* v8 ignore next -- defensive guard; effects run only after the container ref has mounted. */
    if (container) resizeObserver?.observe(container);

    return () => {
      window.removeEventListener('resize', recalcHeight);
      resizeObserver?.disconnect();
    };
  }, [recalcHeight]);

  // Where the detail goes depends on how much room the table would have left. The
  // wallet route gives up 256px to the sidebar from `lg` and 64px to padding, so a
  // 448px pane leaves the table only 368px at 1024px and 496px at 1280px. Only at
  // 1536px does it clear 750px, which is where side-by-side is worth its width.
  //
  // Below that the detail expands inline beneath its own row instead, which uses the
  // full content width and reserves nothing while nothing is selected. Exactly one of
  // the two renders, so the details body stays in the DOM once.
  const canFitSideBySide = useMediaQuery(SIDE_BY_SIDE_DETAIL_QUERY);
  const showPane = ownsSelection && canFitSideBySide;
  const expandInline = ownsSelection && !canFitSideBySide;

  // Shared by the inline expansion and the side-by-side pane — both render the same
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
    labelMutationError,
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
    onCancelEdit: handleCancelEdit,
    onToggleLabel: handleToggleLabel,
    onAISuggestion: handleAISuggestion,
  };

  const renderExpandedDetail = () => selectedTx && (
    <>
      <TransactionDetailsHeader selectedTx={selectedTx} onClose={clearSelectedTx} />
      <TransactionDetailsBody selectedTx={selectedTx} {...detailProps} />
    </>
  );

  return (
    <>
      {density === 'comfortable' && <TransactionStatsGrid txStats={txStats} />}

      <div className={showPane ? 'flex gap-4 items-start' : undefined}>
        <div
          ref={tableContainerRef}
          className={showPane ? 'flex-1 min-w-0' : undefined}
        >
          {filteredTransactions.length === 0 ? (
            <div
              className={`flex items-center justify-center text-center ${
                density === 'comfortable' ? 'min-h-[300px] py-10' : 'py-6'
              }`}
            >
              <p className="text-sanctuary-400 dark:text-sanctuary-500" data-testid="transactions-empty-state">
                {unavailable ? 'Transactions unavailable.' : 'No transactions found.'}
              </p>
            </div>
          ) : (
            <TransactionTable
              expandedTxId={expandInline && selectedTx ? selectedTx.id : undefined}
              renderExpandedDetail={expandInline && selectedTx ? renderExpandedDetail : undefined}
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
          )}
        </div>

        {showPane && (
          <TransactionDetail
            selectedTx={selectedTx}
            tableHeight={tableHeight}
            selectionStatus={selectionStatus}
            selectionError={selectionError}
            onRetrySelection={retrySelection}
            {...detailProps}
          />
        )}
      </div>
    </>
  );
};
