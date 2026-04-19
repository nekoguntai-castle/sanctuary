import type { MouseEventHandler } from 'react';
import type { PendingTransaction } from '../../../src/types';

export interface PendingTxDotProps {
  tx: PendingTransaction;
  explorerUrl: string;
  compact: boolean;
  isStuck?: boolean;
}

export interface PendingTxDotViewModel {
  isSent: boolean;
  dotColor: string;
  title: string;
  directionLabel: string;
  eta: string;
  waitingTime: string;
  recipientPreview: string | null;
}

export interface PendingTxDotViewProps {
  tx: PendingTransaction;
  compact: boolean;
  showTooltip: boolean;
  viewModel: PendingTxDotViewModel;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}
