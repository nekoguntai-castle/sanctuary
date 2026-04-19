import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockData, BlockVisualizerProps } from '../types';
import {
  clearAnimationTimeout,
  hasNewConfirmedBlock,
  openBlockInExplorer,
  splitDisplayBlocks,
  startNewBlockAnimation,
} from './blockVisualizerControllerHelpers';

interface UseBlockVisualizerControllerParams {
  blocks?: BlockData[];
  onBlockClick?: BlockVisualizerProps['onBlockClick'];
  explorerUrl: string;
}

export interface BlockVisualizerController {
  displayBlocks: BlockData[];
  pendingBlocks: BlockData[];
  confirmedBlocks: BlockData[];
  isAnimating: boolean;
  newBlockDetected: boolean;
  handleBlockClick: (block: BlockData, pendingIndex?: number) => void;
}

export function useBlockVisualizerController({
  blocks,
  onBlockClick,
  explorerUrl,
}: UseBlockVisualizerControllerParams): BlockVisualizerController {
  const [displayBlocks, setDisplayBlocks] = useState<BlockData[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [newBlockDetected, setNewBlockDetected] = useState(false);
  const previousBlocksRef = useRef<BlockData[]>([]);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => clearAnimationTimeout(animationTimeoutRef);
  }, []);

  useEffect(() => {
    if (!blocks || blocks.length === 0) {
      setDisplayBlocks([]);
      return;
    }

    if (hasNewConfirmedBlock(previousBlocksRef.current, blocks)) {
      startNewBlockAnimation({
        blocks,
        timeoutRef: animationTimeoutRef,
        setDisplayBlocks,
        setIsAnimating,
        setNewBlockDetected,
      });
      previousBlocksRef.current = blocks;
      return;
    }

    setDisplayBlocks(blocks);
    previousBlocksRef.current = blocks;
  }, [blocks]);

  const handleBlockClick = useCallback(
    (block: BlockData, pendingIndex?: number) => {
      if (onBlockClick) {
        onBlockClick(block.medianFee);
        return;
      }

      openBlockInExplorer(block, pendingIndex, explorerUrl);
    },
    [explorerUrl, onBlockClick]
  );

  const { pendingBlocks, confirmedBlocks } = useMemo(
    () => splitDisplayBlocks(displayBlocks),
    [displayBlocks]
  );

  return {
    displayBlocks,
    pendingBlocks,
    confirmedBlocks,
    isAnimating,
    newBlockDetected,
    handleBlockClick,
  };
}
