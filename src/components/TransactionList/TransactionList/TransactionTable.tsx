import type React from 'react';
import { forwardRef, useMemo, type ReactNode } from 'react';
import { TableVirtuoso, type TableVirtuosoHandle } from 'react-virtuoso';
import type { Transaction, Wallet } from '../../../types';
import { TransactionRow } from '../TransactionRow';
import { TransactionTableHeader } from './TransactionTableHeader';

type TransactionTableProps = {
  filteredTransactions: Transaction[];
  virtuosoRef: React.RefObject<TableVirtuosoHandle>;
  tableHeight: number;
  showWalletBadge: boolean;
  walletBalance?: number;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  highlightedTxId?: string;
  getWallet: (id: string) => Wallet | undefined;
  getTxTypeInfo: (tx: Transaction) => { isReceive: boolean; isConsolidation: boolean };
  onWalletClick?: (walletId: string) => void;
  onTxClick: (tx: Transaction) => void;
  /** Transaction whose detail is expanded inline, when the viewport has no room for a pane. */
  expandedTxId?: string;
  /** Renders the expanded detail. Called only for the expanded row, so it mounts once. */
  renderExpandedDetail?: () => ReactNode;
};

export function TransactionTable({
  filteredTransactions,
  virtuosoRef,
  tableHeight,
  showWalletBadge,
  walletBalance,
  confirmationThreshold,
  deepConfirmationThreshold,
  highlightedTxId,
  getWallet,
  getTxTypeInfo,
  onWalletClick,
  onTxClick,
  expandedTxId,
  renderExpandedDetail,
}: TransactionTableProps) {
  // Date, Type, Amount, Confs, Labels are always present; Balance and Wallet are optional.
  const columnCount = 5 + (walletBalance !== undefined ? 1 : 0) + (showWalletBadge ? 1 : 0);
  // Virtuoso remounts its scroller when `components` changes identity, which would reset
  // scroll position on every expand, so the map is memoised on what it actually closes over.
  const components = useMemo(
    () => buildTableComponents({ expandedTxId, renderExpandedDetail, columnCount }),
    [expandedTxId, renderExpandedDetail, columnCount],
  );
  return (
    <TableVirtuoso
      ref={virtuosoRef}
      style={{ height: tableHeight }}
      data={filteredTransactions}
      fixedHeaderContent={() => (
        <TransactionTableHeader
          showWalletBadge={showWalletBadge}
          showBalance={walletBalance !== undefined}
        />
      )}
      components={components}
      itemContent={(_index, tx) => (
        <TransactionTableRow
          tx={tx}
          showWalletBadge={showWalletBadge}
          walletBalance={walletBalance}
          confirmationThreshold={confirmationThreshold}
          deepConfirmationThreshold={deepConfirmationThreshold}
          highlightedTxId={highlightedTxId}
          getWallet={getWallet}
          getTxTypeInfo={getTxTypeInfo}
          onWalletClick={onWalletClick}
          onTxClick={onTxClick}
        />
      )}
    />
  );
}

function TransactionTableRow({
  tx,
  showWalletBadge,
  walletBalance,
  confirmationThreshold,
  deepConfirmationThreshold,
  highlightedTxId,
  getWallet,
  getTxTypeInfo,
  onWalletClick,
  onTxClick,
}: Omit<TransactionTableProps, 'filteredTransactions' | 'virtuosoRef' | 'tableHeight'> & { tx: Transaction }) {
  const { isReceive, isConsolidation } = getTxTypeInfo(tx);
  const isHighlighted = highlightedTxId === tx.id;
  const txWallet = getWallet(tx.walletId);

  return (
    <TransactionRow
      tx={tx}
      isReceive={isReceive}
      isConsolidation={isConsolidation}
      isHighlighted={isHighlighted}
      txWallet={txWallet}
      showWalletBadge={showWalletBadge}
      walletBalance={walletBalance}
      confirmationThreshold={confirmationThreshold}
      deepConfirmationThreshold={deepConfirmationThreshold}
      onWalletClick={onWalletClick}
      onTxClick={onTxClick}
    />
  );
}

function buildTableComponents({
  expandedTxId,
  renderExpandedDetail,
  columnCount,
}: {
  expandedTxId?: string;
  renderExpandedDetail?: () => ReactNode;
  columnCount: number;
}) {
  return {
    Table: ({ style, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
      <table {...props} style={style} className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
    ),
    TableBody: forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ style, ...props }, ref) => (
      <tbody {...props} ref={ref} style={style} className="divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
    )),
    TableRow: ({ item, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { item: Transaction }) => (
      <>
        <tr {...props} />
        {renderExpandedDetail && expandedTxId === item.id && (
          <tr data-testid="transaction-detail-expansion">
            <td colSpan={columnCount} className="p-0">
              {/* Bounded so the rows around it stay reachable: an unbounded expansion
                  would push the rest of the list off-screen for a transaction with many
                  inputs, which is exactly the scanning the split view exists to support. */}
              <div
                data-testid="transaction-detail-expansion-scroll"
                className="max-h-[60vh] overflow-y-auto border-t border-sanctuary-200 dark:border-sanctuary-800"
              >
                {renderExpandedDetail()}
              </div>
            </td>
          </tr>
        )}
      </>
    ),
  };
}
