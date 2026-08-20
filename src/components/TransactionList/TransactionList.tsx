import React, { useId, useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Transaction, Wallet, Label } from '../../types';
import { usePriceFreeFormatter } from '../../contexts/CurrencyContext';
import { useAIStatus } from '../../hooks/useAIStatus';
import { useTransactionList } from './hooks/useTransactionList';
import type { TransactionStats } from '../../api/transactions';
import { TransactionStatsGrid } from './TransactionList/TransactionStatsGrid';
import { TransactionTable } from './TransactionList/TransactionTable';
import { TransactionDetailPanel } from './TransactionTabs/TransactionDetailPanel';
import { TransactionTabStrip } from './TransactionTabs/TransactionTabStrip';
import { LIST_TAB } from './hooks/transactionTabsState';
import { FloatingPanel } from '../ui/FloatingPanel';
import { FLOATING_PANEL_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { tabTitle } from './TransactionTabs/tabPresentation';
import { panelDomId, tabDomId } from './TransactionTabs/tabPresentation';
import type { TransactionPanelSharedProps } from './TransactionTabs/types';

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
    ownsSelection,
    explorerUrl,
    copied,
    activeTab,
    openTxids,
    activateTab,
    closeTab,
    detachTab,
    dockTab,
    floatingTxids,
    nudgeTab,
    reorderTab,
    findTransaction,
    selectionTransactions: panelTransactions,
    filteredTransactions,
    virtuosoRef,
    txStats,
    getWallet,
    copyToClipboard,
    handleTxClick,
    getTxTypeInfo,
  } = useTransactionList({
    transactions,
    selectionTransactions,
    wallets,
    walletAddresses,
    onTransactionClick,
    highlightedTxId,
    transactionStats,
  });
  // Two transaction lists can share a page (the dashboard preview and a wallet
  // route are different mounts, but a future page could hold both), so tab and
  // panel ids are scoped per instance.
  const instanceId = useId();

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

  // Every open tab keeps its panel mounted and hides the inactive ones, so
  // switching tabs preserves scroll position and any half-finished label edit
  // instead of remounting and re-fetching. The table is hidden the same way.
  // Below `tablet` a floating panel has nowhere useful to float: it would cover
  // the list it exists to sit beside. The affordance is hidden, and a panel that
  // survives a narrowing viewport is docked rather than left stranded.
  const canFloat = useMediaQuery(FLOATING_PANEL_QUERY);
  useEffect(() => {
    if (canFloat) return;
    for (const txid of floatingTxids) dockTab(txid);
  }, [canFloat, dockTab, floatingTxids]);

  // A floating panel dragged over the strip docks when dropped. The strip is the
  // drop target because that is where the tab would reappear, and hit-testing
  // its own box needs no drag library on either side of the gesture.
  const stripRef = useRef<HTMLDivElement>(null);
  const [dockCandidate, setDockCandidate] = useState<string | null>(null);
  const isOverStrip = useCallback((point: { x: number; y: number } | null) => {
    if (!point) return false;
    const rect = stripRef.current?.getBoundingClientRect();
    /* v8 ignore next -- the strip is always mounted while a panel floats. */
    if (!rect) return false;
    return point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom;
  }, []);

  const dockedTxids = useMemo(
    () => openTxids.filter((txid) => !floatingTxids.includes(txid)),
    [floatingTxids, openTxids],
  );
  const showList = activeTab === LIST_TAB;
  const sharedPanelProps: TransactionPanelSharedProps = {
    wallets,
    walletAddresses,
    walletLabels,
    selectionTransactions: panelTransactions,
    walletId,
    explorerUrl,
    copied,
    canEdit,
    aiEnabled,
    confirmationThreshold,
    deepConfirmationThreshold,
    format,
    onCopyToClipboard: copyToClipboard,
    onLabelsChange,
  };

  return (
    <>
      {density === 'comfortable' && <TransactionStatsGrid txStats={txStats} />}

      {ownsSelection && openTxids.length > 0 && (
        <TransactionTabStrip
          // Docked tabs only: a detached transaction is on screen in its own
          // panel, so leaving its tab in the strip would offer a second way to
          // "show" something already showing — and one that cannot be selected,
          // since a floating transaction is never the active tab.
          openTxids={dockedTxids}
          activeTab={activeTab}
          instanceId={instanceId}
          findTransaction={findTransaction}
          onActivate={activateTab}
          onClose={closeTab}
          onDetach={canFloat ? detachTab : undefined}
          onReorder={reorderTab}
          onNudge={nudgeTab}
          isDockTarget={dockCandidate !== null}
          ref={stripRef}
        />
      )}

      <div
        ref={tableContainerRef}
        // Only a tab panel when there are tabs to belong to; a lone table on the
        // dashboard is not part of a tablist and must not claim to be.
        {...(ownsSelection && openTxids.length > 0
          ? {
            role: 'tabpanel',
            id: panelDomId(instanceId, LIST_TAB),
            'aria-labelledby': tabDomId(instanceId, LIST_TAB),
          }
          : {})}
        hidden={!showList}
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

      {dockedTxids.map((txid) => (
        <TransactionDetailPanel
          key={txid}
          txid={txid}
          instanceId={instanceId}
          hidden={activeTab !== txid}
          onClose={closeTab}
          onUnresolvable={closeTab}
          {...sharedPanelProps}
        />
      ))}

      {floatingTxids.map((txid, index) => {
        const label = tabTitle(txid, findTransaction(txid));
        return (
          <FloatingPanel
            key={txid}
            storageId={txid}
            index={index}
            title={label}
            label={label}
            onDock={() => dockTab(txid)}
            onClose={() => closeTab(txid)}
            onDragMove={(point) => setDockCandidate(isOverStrip(point) ? txid : null)}
            onDragEnd={(point) => {
              if (!isOverStrip(point)) return false;
              dockTab(txid);
              return true;
            }}
          >
            <TransactionDetailPanel
              txid={txid}
              instanceId={instanceId}
              hidden={false}
              presentation="floating"
              onClose={closeTab}
              onUnresolvable={closeTab}
              {...sharedPanelProps}
            />
          </FloatingPanel>
        );
      })}
    </>
  );
};
