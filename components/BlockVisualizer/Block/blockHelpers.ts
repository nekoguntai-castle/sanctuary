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
