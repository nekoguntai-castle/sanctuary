import React from 'react';
import {
  getDirectionBorderClass,
  getHighlightClass,
  TransactionAmountCell,
  TransactionBalanceCell,
  TransactionConfirmationsCell,
  TransactionDateCell,
  TransactionLabelsCell,
  TransactionTypeCell,
  TransactionWalletBadgeCell,
} from './TransactionRow/cells';
import type { TransactionRowProps } from './TransactionRow/types';

export const TransactionRow: React.FC<TransactionRowProps> = ({
  confirmationThreshold,
  deepConfirmationThreshold,
  isConsolidation,
  isHighlighted,
  isReceive,
  onTxClick,
  onWalletClick,
  showWalletBadge,
  tx,
  txWallet,
  walletBalance,
}) => {
  const highlightClass = getHighlightClass(isHighlighted);
  const directionBorderClass = getDirectionBorderClass(isConsolidation, isReceive);
  const cellProps = { highlightClass, onTxClick, tx };

  return (
    <>
      <TransactionDateCell {...cellProps} directionBorderClass={directionBorderClass} />
      <TransactionTypeCell {...cellProps} isConsolidation={isConsolidation} isReceive={isReceive} />
      <TransactionAmountCell {...cellProps} isConsolidation={isConsolidation} isReceive={isReceive} />
      <TransactionBalanceCell {...cellProps} walletBalance={walletBalance} />
      <TransactionConfirmationsCell
        {...cellProps}
        confirmationThreshold={confirmationThreshold}
        deepConfirmationThreshold={deepConfirmationThreshold}
      />
      <TransactionLabelsCell {...cellProps} />
      <TransactionWalletBadgeCell
        {...cellProps}
        onWalletClick={onWalletClick}
        showWalletBadge={showWalletBadge}
        txWallet={txWallet}
      />
    </>
  );
};
