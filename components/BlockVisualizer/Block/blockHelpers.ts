import type { BlockProps, BlockViewModel } from './types';

export const getBlockViewModel = ({
  block,
  compact,
  isAnimating,
  animationDirection,
}: BlockProps): BlockViewModel => {
  const isPending = block.status === 'pending';

  return {
    isPending,
    fillPercentage: getFillPercentage(block.size),
    animationClass: getAnimationClass(isAnimating, animationDirection),
    formattedMedianFee: formatMedianFee(block.medianFee),
    formattedHeight: formatBlockHeight(block.height, compact, isPending),
    pendingTxLimit: getPendingTxLimit(compact),
  };
};

export const getPendingOverflowCount = (pendingTxCount: number, pendingTxLimit: number) => {
  return Math.max(pendingTxCount - pendingTxLimit, 0);
};

export const isPendingTxStuck = (feeRate: number, blockMinFee?: number) => {
  return blockMinFee !== undefined && feeRate < blockMinFee;
};

export const getBlockButtonLabel = (
  block: BlockProps['block'],
  viewModel: BlockViewModel
) => {
  const blockType = viewModel.isPending ? 'Pending block' : 'Confirmed block';
  const blockHeight = formatAccessibleBlockHeight(block.height);

  const parts = [
    `${blockType} ${blockHeight}`,
    `median fee ${viewModel.formattedMedianFee} sat/vB`,
  ];

  if (block.txCount === undefined) {
    parts.push('transaction count unavailable');
  } else {
    // Bring the accessible name to parity with the hover tooltip (which is
    // not reachable on touch): the tooltip shows txs, median, fee range and
    // fullness — median is already above, so add txs, range and fullness.
    parts.push(`${block.txCount.toLocaleString()} transactions`);
    parts.push(`fee range ${block.feeRange}`);
    parts.push(`${Math.round(viewModel.fillPercentage)}% full`);
  }

  return parts.join(', ');
};

const getFillPercentage = (size: number) => {
  return Math.min((size / 1.6) * 100, 100);
};

const getAnimationClass = (
  isAnimating: boolean,
  animationDirection: BlockProps['animationDirection']
) => {
  if (!isAnimating) return '';
  if (animationDirection === 'enter') return 'animate-block-enter animate-confirm-glow';
  if (animationDirection === 'exit') return 'animate-block-exit';
  return '';
};

const formatMedianFee = (medianFee: number) => {
  return medianFee < 1 ? medianFee.toFixed(1) : Math.round(medianFee);
};

const formatBlockHeight = (
  height: BlockProps['block']['height'],
  compact: boolean,
  isPending: boolean
) => {
  if (isPending) return `${compact ? '' : 'BLK '}${height}`;
  if (typeof height === 'number') return compact ? height : height.toLocaleString();
  return height;
};

const getPendingTxLimit = (compact: boolean) => {
  return compact ? 3 : 5;
};

const formatAccessibleBlockHeight = (height: BlockProps['block']['height']) => {
  return typeof height === 'number' ? height.toLocaleString() : height;
};
