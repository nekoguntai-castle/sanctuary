import type { MutableRefObject } from 'react';
import type { BlockData } from '../types';

interface AnimationUpdateParams {
  blocks: BlockData[];
  timeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setDisplayBlocks: (blocks: BlockData[]) => void;
  setIsAnimating: (isAnimating: boolean) => void;
  setNewBlockDetected: (newBlockDetected: boolean) => void;
}

export const splitDisplayBlocks = (blocks: BlockData[]) => ({
  pendingBlocks: blocks.filter((block) => block.status === 'pending'),
  confirmedBlocks: blocks.filter((block) => block.status === 'confirmed'),
});

export const hasNewConfirmedBlock = (previousBlocks: BlockData[], nextBlocks: BlockData[]) => {
  const previousHeight = getFirstConfirmedHeight(previousBlocks);
  const nextHeight = getFirstConfirmedHeight(nextBlocks);
  return previousHeight !== undefined && nextHeight !== undefined && previousHeight !== nextHeight;
};

export const clearAnimationTimeout = (
  timeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
) => {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
  }
};

export const startNewBlockAnimation = ({
  blocks,
  timeoutRef,
  setDisplayBlocks,
  setIsAnimating,
  setNewBlockDetected,
}: AnimationUpdateParams) => {
  setNewBlockDetected(true);
  setIsAnimating(true);
  clearAnimationTimeout(timeoutRef);
  timeoutRef.current = setTimeout(() => {
    setDisplayBlocks(blocks);
    setIsAnimating(false);
    setNewBlockDetected(false);
  }, 600);
};

export const openBlockInExplorer = (
  block: BlockData,
  pendingIndex: number | undefined,
  explorerUrl: string
) => {
  if (block.status === 'confirmed' && typeof block.height === 'number') {
    window.open(`${explorerUrl}/block/${block.height}`, '_blank');
    return;
  }

  if (block.status === 'pending' && pendingIndex !== undefined) {
    window.open(`${explorerUrl}/mempool-block/${pendingIndex}`, '_blank');
  }
};

export const getMempoolBlockIndex = (pendingBlockCount: number, index: number) => {
  return pendingBlockCount - 1 - index;
};

const getFirstConfirmedHeight = (blocks: BlockData[]) => {
  const firstConfirmed = blocks.find((block) => block.status === 'confirmed');
  return typeof firstConfirmed?.height === 'number' ? firstConfirmed.height : undefined;
};
