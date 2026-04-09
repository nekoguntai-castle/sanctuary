import React from 'react';
import { Zap } from 'lucide-react';
import { AnimatedFeeRate } from './AnimatedFeeRate';

interface FeeEstimate {
  fast: number;
  medium: number;
  slow: number;
}

interface FeeEstimationCardProps {
  fees: FeeEstimate | null;
  formatFeeRate: (rate: number | undefined) => string;
}

const FEE_TIERS = [
  { label: 'Fast', key: 'fast' as const, dot: 'bg-success-500', time: '~10 min / ~1 block' },
  { label: 'Normal', key: 'medium' as const, dot: 'bg-warning-500', time: '~30 min / ~3 blocks' },
  { label: 'Slow', key: 'slow' as const, dot: 'bg-sanctuary-400', time: '~60 min / ~6 blocks' },
] as const;

const TYPICAL_VB = 140;

export const FeeEstimationCard: React.FC<FeeEstimationCardProps> = ({ fees, formatFeeRate }) => (
  <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive animate-fade-in-up-2">
    <div className="flex items-center justify-between mb-4">
      <h4 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">Fee Estimation</h4>
      <Zap className="w-4 h-4 text-warning-500" />
    </div>
    <div className="space-y-2">
      {FEE_TIERS.map((tier) => {
        const rate = fees?.[tier.key];
        const estSats = rate !== undefined ? Math.round(rate * TYPICAL_VB) : undefined;
        return (
          <div key={tier.label} className="relative group/fee flex justify-between items-center p-2.5 surface-secondary rounded-lg">
            <div className="flex items-center">
              <div className={`w-2 h-2 rounded-full ${tier.dot} mr-2`}></div>
              <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">{tier.label}</span>
            </div>
            <span className="font-bold text-sm font-mono tabular-nums text-sanctuary-900 dark:text-sanctuary-100">
              <AnimatedFeeRate value={formatFeeRate(rate)} />
            </span>
            {/* Fee tooltip */}
            <div className="tooltip-popup bottom-full left-1/2 -translate-x-1/2 mb-2">
              <div className="tooltip-arrow -bottom-1 left-1/2 -translate-x-1/2 border-b border-r" />
              <div>{tier.time}</div>
              {estSats !== undefined && (
                <div className="text-sanctuary-400 dark:text-sanctuary-500 tabular-nums">
                  ~{estSats.toLocaleString()} sats for typical tx (~{TYPICAL_VB} vB)
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
