import type { PendingTransaction } from '../../../src/types';
import type { BlockData } from '../types';

export interface BlockProps {
  block: BlockData;
  index: number;
  onClick: () => void;
  compact: boolean;
  isAnimating: boolean;
  animationDirection: 'enter' | 'exit' | 'none';
  pendingTxs?: PendingTransaction[];
  explorerUrl: string;
  blockMinFee?: number;
}

export interface BlockViewModel {
  isPending: boolean;
  fillPercentage: number;
  animationClass: string;
  formattedMedianFee: string | number;
  formattedHeight: string | number;
  pendingTxLimit: number;
}
