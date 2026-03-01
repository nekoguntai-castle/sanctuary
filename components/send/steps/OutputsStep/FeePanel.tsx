import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';
import { FeeSelector } from '../../FeeSelector';
import type { FeeEstimate } from '../../../../types';
import type { BlockData, QueuedBlocksSummary } from '../../../../src/api/bitcoin';

interface FeePanelProps {
  expanded: boolean;
  feeRate: number;
  estimatedFee: number;
  fees: FeeEstimate | null;
  mempoolBlocks: BlockData[];
  queuedBlocksSummary: QueuedBlocksSummary | null;
  onToggle: () => void;
  onSetFeeRate: (rate: number) => void;
  format: (amount: number) => string;
}

export const FeePanel: React.FC<FeePanelProps> = ({
  expanded,
  feeRate,
  estimatedFee,
  fees,
  mempoolBlocks,
  queuedBlocksSummary,
  onToggle,
  onSetFeeRate,
  format,
}) => (
  <div className="surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full px-4 py-3 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-sanctuary-500" />
        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Network Fee
        </span>
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
          {feeRate} sat/vB • {format(estimatedFee)}
        </span>
      </div>
      {expanded ? (
        <ChevronUp className="w-4 h-4 text-sanctuary-400" />
      ) : (
        <ChevronDown className="w-4 h-4 text-sanctuary-400" />
      )}
    </button>

    {expanded && (
      <div className="px-4 pb-4 border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
        <FeeSelector
          feeRate={feeRate}
          setFeeRate={onSetFeeRate}
          fees={fees}
          mempoolBlocks={mempoolBlocks}
          queuedBlocksSummary={queuedBlocksSummary}
        />
      </div>
    )}
  </div>
);
