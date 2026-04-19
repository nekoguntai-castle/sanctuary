import type { PendingTransaction } from '../../../src/types';
import { formatTimeInQueue } from '../blockUtils';
import type { PendingTxDotViewModel } from './types';

export const getPendingTxDotViewModel = (
  tx: PendingTransaction,
  isStuck: boolean
): PendingTxDotViewModel => {
  const isSent = tx.type === 'sent';
  const directionLabel = isSent ? 'Sending' : 'Receiving';

  return {
    isSent,
    dotColor: getDotColor(isStuck, isSent),
    title: `${directionLabel} ${tx.feeRate} sat/vB`,
    directionLabel,
    eta: estimateEta(tx.feeRate, isStuck),
    waitingTime: formatTimeInQueue(tx.timeInQueue),
    recipientPreview: formatRecipient(tx.recipient),
  };
};

const getDotColor = (isStuck: boolean, isSent: boolean) => {
  if (isStuck) return 'bg-amber-500 dark:bg-amber-400 animate-pulse';
  if (isSent) return 'bg-rose-500 dark:bg-rose-400';
  return 'bg-red-400/80 dark:bg-red-400/70';
};

const estimateEta = (feeRate: number, isStuck: boolean): string => {
  if (isStuck) return 'Stuck - fee too low';
  if (feeRate >= 20) return '~10 min';
  if (feeRate >= 10) return '~30 min';
  if (feeRate >= 5) return '~1 hour';
  return '~2+ hours';
};

const formatRecipient = (recipient?: string) => {
  if (!recipient) return null;
  return `${recipient.slice(0, 8)}...${recipient.slice(-4)}`;
};
