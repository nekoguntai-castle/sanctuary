import React from 'react';
import { AnimatedFeeRate } from './AnimatedFeeRate';
import { TELEMETRY_SUPPORT_CLASS, TelemetryCard } from './TelemetryCard';

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
 *
 * Each tier is a two-row grid rather than a rate in the headline and a name in
 * the `support` slot: two sibling rows size their own tracks independently, so
 * the names drifted left of the rates they name, further with every tier. One
 * grid per tier gives the rate and its name a shared track, and the dot sits in
 * a track of its own so the name centres on the number rather than on
 * dot-plus-number.
 */
export const FeeEstimationCard: React.FC<FeeEstimationCardProps> = ({ fees, formatFeeRate }) => (
  <TelemetryCard
    title="Fee Estimation"
    testId="telemetry-fees"
    titleAdornment={
      <span className="text-[10px] text-sanctuary-400 font-mono">sat/vB</span>
    }
    headline={
      // `items-start`, not `items-baseline`: each tier leads with a dot, which
      // has no text baseline, so a baseline-aligned row synthesises the tier's
      // baseline from the dot's border box and floats the separators above the
      // digits. Both the separators and the rates inherit the same `text-2xl
      // leading-none`, so starting them together lines their line boxes up.
      <span className="flex items-start gap-2">
        {FEE_TIERS.map((tier, index) => (
          <React.Fragment key={tier.key}>
            {index > 0 && (
              <span
                className="text-sanctuary-300 dark:text-sanctuary-600"
                data-testid="fee-tier-separator"
              >
                ·
              </span>
            )}
            {/* `gap-y-2` stands in for the `mt-2` the support slot would have
                applied. Keep the two in step: it is what puts these names on
                the same baseline as the sibling cards' support lines. */}
            <span
              className="relative group/fee inline-grid grid-cols-[auto_auto] justify-items-center gap-x-1.5 gap-y-2"
              data-testid="fee-tier"
            >
              <span
                className={`self-center w-1.5 h-1.5 rounded-full ${tier.dot}`}
                aria-hidden="true"
              />
              <AnimatedFeeRate value={formatFeeRate(fees?.[tier.key])} />
              {/* The shell's support line is not mono — NodeStatusCard adds
                  `font-mono` to its own. This label declares it too rather than
                  borrowing the headline's. */}
              <span
                className={`row-start-2 col-start-2 font-mono font-normal ${TELEMETRY_SUPPORT_CLASS}`}
                data-testid="fee-tier-name"
              >
                {tier.label}
              </span>
              {/* Tooltip styles live in src/index.html. It must keep `auto` grid
                  placement — naming a track would make that track, rather than
                  the tier, the containing block its offsets resolve against. */}
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
  />
);
