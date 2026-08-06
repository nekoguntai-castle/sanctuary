import React from 'react';
import { AnimatedFeeRate } from './AnimatedFeeRate';
import { TelemetryCard } from './TelemetryCard';

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
  { label: 'fast', key: 'fast' as const, dot: 'bg-success-500', time: '~10 min / ~1 block' },
  { label: 'normal', key: 'medium' as const, dot: 'bg-warning-500', time: '~30 min / ~3 blocks' },
  { label: 'slow', key: 'slow' as const, dot: 'bg-sanctuary-400', time: '~60 min / ~6 blocks' },
] as const;

const TYPICAL_VB = 140;

/**
 * The three tiers used to be three nested inset panels stacked vertically,
 * which made this the tallest card in the row and buried the numbers inside
 * chrome. They are one headline row now — the rates are what the reader came
 * for, and the tier names sit under them as the legend.
 */
export const FeeEstimationCard: React.FC<FeeEstimationCardProps> = ({ fees, formatFeeRate }) => (
  <TelemetryCard
    title="Fee Estimation"
    testId="telemetry-fees"
    titleAdornment={
      <span className="text-[10px] text-sanctuary-400 font-mono">sat/vB</span>
    }
    headline={
      <span className="flex items-baseline gap-2">
        {FEE_TIERS.map((tier, index) => (
          <React.Fragment key={tier.key}>
            {index > 0 && <span className="text-sanctuary-300 dark:text-sanctuary-600">·</span>}
            <span className="relative group/fee inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${tier.dot} shrink-0`} aria-hidden="true" />
              <AnimatedFeeRate value={formatFeeRate(fees?.[tier.key])} />
              {/* Tooltip styles live in src/index.html */}
              <span className="tooltip-popup bottom-full left-1/2 -translate-x-1/2 mb-2">
                <span className="tooltip-arrow -bottom-1 left-1/2 -translate-x-1/2 border-b border-r" />
                <span className="block">{tier.time}</span>
                {fees?.[tier.key] !== undefined && (
                  <span className="block text-sanctuary-400 dark:text-sanctuary-500 tabular-nums">
                    ~{Math.round(fees[tier.key] * TYPICAL_VB).toLocaleString()} sats for a typical tx
                  </span>
                )}
              </span>
            </span>
          </React.Fragment>
        ))}
      </span>
    }
    support={
      <span className="flex items-center gap-2 font-mono">
        {FEE_TIERS.map((tier, index) => (
          <React.Fragment key={tier.key}>
            {index > 0 && <span className="text-sanctuary-300 dark:text-sanctuary-600">·</span>}
            <span>{tier.label}</span>
          </React.Fragment>
        ))}
      </span>
    }
  />
);
