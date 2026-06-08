import React, { memo } from 'react';
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

const TransactionRowImpl: React.FC<TransactionRowProps> = ({
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
TransactionRowImpl.displayName = 'TransactionRow';

// memo'd so virtualized lists don't re-render every row when the parent
// re-renders for unrelated state (e.g. price-feed updates). Default shallow
// prop comparison is sufficient when the parent passes stable callbacks via
// useCallback and a stable tx object reference; see TransactionList.tsx.
export const TransactionRow = memo(TransactionRowImpl);
