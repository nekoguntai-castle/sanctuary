import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight } from 'lucide-react';
import type { BlockData, BlockVisualizerProps } from './types';
import { parseFeeRange, getTxsForBlock, getStuckTxs } from './blockUtils';
import { Block } from './Block';
import { QueuedSummaryBlock } from './QueuedSummaryBlock';
import { BlockAnimationStyles } from './BlockAnimationStyles';

export const BlockVisualizer: React.FC<BlockVisualizerProps> = ({
  blocks,
  queuedBlocksSummary,
  pendingTxs = [],
  onBlockClick,
  compact = false,
  explorerUrl = 'https://mempool.space',
  onRefresh
}) => {
  const [displayBlocks, setDisplayBlocks] = useState<BlockData[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [newBlockDetected, setNewBlockDetected] = useState(false);
  const prevBlocksRef = useRef<BlockData[]>([]);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup animation timeout on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  // Detect new blocks and trigger animation
  useEffect(() => {
    if (!blocks || blocks.length === 0) {
      setDisplayBlocks([]);
      return;
    }

    const prevBlocks = prevBlocksRef.current;
    const newBlocks = blocks;

    // Check if we have a new confirmed block (first confirmed block height changed)
    const prevConfirmed = prevBlocks.filter(b => b.status === 'confirmed');
    const newConfirmed = newBlocks.filter(b => b.status === 'confirmed');

    if (prevConfirmed.length > 0 && newConfirmed.length > 0) {
      const prevFirstHeight = prevConfirmed[0]?.height;
      const newFirstHeight = newConfirmed[0]?.height;

      if (prevFirstHeight !== newFirstHeight && typeof newFirstHeight === 'number') {
        // New block detected! Trigger animation
        setNewBlockDetected(true);
        setIsAnimating(true);

        // Clear any existing animation timeout
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }

        // After animation completes, update display
        animationTimeoutRef.current = setTimeout(() => {
          setDisplayBlocks(newBlocks);
          setIsAnimating(false);
          setNewBlockDetected(false);
        }, 600);

        prevBlocksRef.current = newBlocks;
        return;
      }
    }

    // No new block, just update
    setDisplayBlocks(newBlocks);
    prevBlocksRef.current = newBlocks;
  }, [blocks]);

  const handleBlockClick = useCallback((block: BlockData, pendingIndex?: number) => {
    // If onBlockClick is provided, use it for fee selection instead of opening explorer
    if (onBlockClick) {
      onBlockClick(block.medianFee);
      return;
    }
    // Otherwise open in explorer
    if (block.status === 'confirmed' && typeof block.height === 'number') {
      window.open(`${explorerUrl}/block/${block.height}`, '_blank');
    } else if (block.status === 'pending' && pendingIndex !== undefined) {
      // For pending blocks, link to mempool-block view (mempool.space compatible)
      window.open(`${explorerUrl}/mempool-block/${pendingIndex}`, '_blank');
    }
  }, [explorerUrl, onBlockClick]);

  // Separate pending and confirmed blocks
  const pendingBlocks = displayBlocks.filter(b => b.status === 'pending');
  const confirmedBlocks = displayBlocks.filter(b => b.status === 'confirmed');

  return (
    <div className="w-full overflow-hidden">
      {/* CSS for animations */}
      <BlockAnimationStyles />

      {/* Header labels */}
      <div className="flex items-center space-x-2 mb-2 px-2">
        <div className="flex-1 flex items-center justify-end">
          <div className="flex items-center text-xs font-medium text-warning-600 dark:text-warning-400 uppercase tracking-wider opacity-90">
            <span className="w-2 h-2 rounded-full bg-warning-500 animate-pulse mr-2" />
            <span>Mempool (Pending)</span>
          </div>
        </div>
        <div className="w-8 flex justify-center">
          <ArrowRight className="w-4 h-4 text-sanctuary-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center text-xs font-medium text-success-600 dark:text-success-400 uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-success-500 mr-2" />
            <span>Blockchain (Confirmed)</span>
          </div>
        </div>
      </div>

      {/* Blocks container */}
      <div className={`relative flex items-center justify-center ${compact ? 'space-x-1.5' : 'space-x-2 sm:space-x-3'} overflow-x-auto overflow-y-visible pb-6 px-4 scrollbar-hide`}>
        {/* Center divider line */}
        <div className="absolute left-1/2 top-0 bottom-4 w-px bg-gradient-to-b from-transparent via-sanctuary-300 to-transparent dark:via-sanctuary-700 -ml-0.5 z-0" />

        {displayBlocks.length === 0 ? (
          <div className="text-center text-sanctuary-500 dark:text-sanctuary-400 py-8">
            <div className="animate-pulse flex space-x-2 justify-center">
              {[...Array(compact ? 7 : 6)].map((_, i) => (
                <div
                  key={i}
                  className={`${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32'} rounded-lg bg-sanctuary-200 dark:bg-sanctuary-800`}
                />
              ))}
            </div>
            <p className="text-sm mt-4">Loading blockchain data...</p>
          </div>
        ) : (
          <>
            {/* Queued blocks summary (leftmost) - also shows stuck transactions */}
            {(() => {
              const stuckTxs = getStuckTxs(pendingTxs, pendingBlocks);
              // Show if there are queued blocks OR stuck transactions
              const showQueuedBlock = (queuedBlocksSummary && queuedBlocksSummary.blockCount > 0) || stuckTxs.length > 0;
              if (!showQueuedBlock) return null;

              // If no queuedBlocksSummary but we have stuck txs, create a minimal summary
              const summary = queuedBlocksSummary || {
                blockCount: 0,
                totalTransactions: 0,
                averageFee: 0,
                totalFees: 0,
              };

              return (
                <QueuedSummaryBlock
                  summary={summary}
                  compact={compact}
                  stuckTxs={stuckTxs}
                  explorerUrl={explorerUrl}
                />
              );
            })()}

            {/* Pending/Mempool blocks */}
            {pendingBlocks.map((block, idx) => {
              // Mempool-block index: rightmost (closest to confirmed) = 0, leftmost = highest
              const mempoolBlockIndex = pendingBlocks.length - 1 - idx;
              const [blockMinFee] = parseFeeRange(block.feeRange);
              return (
                <Block
                  key={`pending-${block.height}-${idx}`}
                  block={block}
                  index={idx}
                  onClick={() => handleBlockClick(block, mempoolBlockIndex)}
                  compact={compact}
                  isAnimating={isAnimating && newBlockDetected}
                  animationDirection="none"
                  pendingTxs={getTxsForBlock(block, pendingTxs, idx, pendingBlocks.length, pendingBlocks)}
                  explorerUrl={explorerUrl}
                  blockMinFee={blockMinFee}
                />
              );
            })}

            {/* Confirmed blocks */}
            {confirmedBlocks.map((block, idx) => (
              <Block
                key={`confirmed-${block.height}`}
                block={block}
                index={idx + pendingBlocks.length}
                onClick={() => handleBlockClick(block)}
                compact={compact}
                isAnimating={isAnimating && newBlockDetected && idx === 0}
                animationDirection={isAnimating && newBlockDetected && idx === 0 ? 'enter' : 'none'}
                explorerUrl={explorerUrl}
              />
            ))}
          </>
        )}
      </div>

      {/* Legend / Info bar - block fullness indicator */}
      <div className="flex items-center justify-center space-x-4 text-[10px] font-medium text-sanctuary-700 dark:text-sanctuary-400 mt-1">
        <span>Block Fullness:</span>
        <div className="flex items-center space-x-1">
          <div className="w-10 h-1.5 rounded-sm bg-sanctuary-300 dark:bg-sanctuary-800 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1/4 bg-sanctuary-500 dark:bg-sanctuary-500 rounded-sm" />
          </div>
          <span>25%</span>
        </div>
        <div className="flex items-center space-x-1">
          <div className="w-10 h-1.5 rounded-sm bg-sanctuary-300 dark:bg-sanctuary-800 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-full bg-sanctuary-500 dark:bg-sanctuary-500 rounded-sm" />
          </div>
          <span>100%</span>
        </div>
        <span className="text-sanctuary-500 dark:text-sanctuary-500 ml-2">• Hover for details</span>
      </div>
    </div>
  );
};
