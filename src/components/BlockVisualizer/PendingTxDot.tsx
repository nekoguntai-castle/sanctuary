import { useState } from 'react';
import type { MouseEvent } from 'react';
import { PendingTxDotView } from './PendingTxDot/PendingTxDotView';
import { getPendingTxDotViewModel } from './PendingTxDot/pendingTxDotHelpers';
import type { PendingTxDotProps } from './PendingTxDot/types';

export function PendingTxDot({
  tx,
  explorerUrl,
  compact,
  isStuck = false,
}: PendingTxDotProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const viewModel = getPendingTxDotViewModel(tx, isStuck);

  const handleClick = (event: MouseEvent) => {
    event.stopPropagation();
    window.open(`${explorerUrl}/tx/${tx.txid}`, '_blank');
  };

  return (
    <PendingTxDotView
      tx={tx}
      compact={compact}
      showTooltip={showTooltip}
      viewModel={viewModel}
      onClick={handleClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    />
  );
}
