import type React from 'react';
import { forwardRef } from 'react';
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
}: TransactionTableProps) {
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
      components={VIRTUOSO_TABLE_COMPONENTS}
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

const VIRTUOSO_TABLE_COMPONENTS = {
  Table: ({ style, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <table {...props} style={style} className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
  ),
  TableBody: forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ style, ...props }, ref) => (
    <tbody {...props} ref={ref} style={style} className="divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
  )),
};
