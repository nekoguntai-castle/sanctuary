import { ArrowDownLeft, ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Amount } from '../Amount';
import { AnimatedPrice } from './PriceChart/AnimatedPrice';
import { PriceChartBody } from './PriceChart/PriceChartBody';
import type { PriceChartProps, PendingTotals } from './PriceChart/types';
import { buildBalanceTrend, formatBalanceTrend } from './PriceChart/balanceTrendModel';
import type { BalanceTrend } from './PriceChart/balanceTrendModel';
import { Card } from '../ui/Card';

/**
 * Incoming and outgoing are shown separately, never netted — a pending +100k
 * receive against a -100k send is not "nothing pending".
 *
 * Icons and colours follow the existing pending vocabulary
 * (WalletList/WalletGridCardBalance + walletGridCardStyles.pendingNetClass):
 * ArrowDownLeft/success for incoming, ArrowUpRight/sent for outgoing. `sent-*`
 * rather than `warning-*`, which means "multisig/caution" elsewhere.
 */
function PendingTotalsRow({
  pendingTotals,
  unavailable = false,
}: { pendingTotals: PendingTotals; unavailable?: boolean }) {
  const { incoming, outgoing } = pendingTotals;

  // Zero totals render nothing, which reads as "nothing pending". When the
  // request failed we have not established that, and an unconfirmed send the
  // reader cannot see is exactly what they would want flagged.
  if (unavailable && incoming === 0 && outgoing === 0) {
    return (
      <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400" data-testid="pending-unavailable">
        Pending transactions unavailable
      </p>
    );
  }

  if (incoming === 0 && outgoing === 0) {
    return null;
  }

  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs">
      {incoming > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowDownLeft className="w-3.5 h-3.5 text-success-500 shrink-0" />
          <Amount sats={incoming} size="sm" inline className="text-success-600" />
        </span>
      )}
      {outgoing > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowUpRight className="w-3.5 h-3.5 text-sent-500 shrink-0" />
          <Amount sats={outgoing} size="sm" inline className="text-sent-600" />
        </span>
      )}
      <span className="text-sanctuary-400">pending</span>
    </div>
  );
}

/**
 * Direction is carried by three independent signals — an icon, a written sign,
 * and colour — so the colour is the last of them, never the only one.
 *
 * This describes the BTC balance over the period, not fiat performance: a
 * balance can fall while its market value rises.
 */
const TREND_PRESENTATION: Record<
  BalanceTrend['direction'],
  { icon: typeof TrendingUp; className: string }
> = {
  gain: { icon: TrendingUp, className: 'text-success-600' },
  loss: { icon: TrendingDown, className: 'text-rose-600 dark:text-rose-400' },
  flat: { icon: Minus, className: 'text-sanctuary-500 dark:text-sanctuary-400' },
};

function BalanceTrendRow({ trend }: { trend: BalanceTrend }) {
  const { icon: Icon, className } = TREND_PRESENTATION[trend.direction];

  return (
    <p
      data-testid="balance-trend"
      data-direction={trend.direction}
      className={`flex items-center gap-1 text-xs font-medium ${className}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {formatBalanceTrend(trend)}
    </p>
  );
}

export function PriceChart({
  totalBalance,
  chartReady,
  timeframe,
  chartData,
  pendingTotals,
  walletCount,
  historyUnavailable = false,
  pendingUnavailable = false,
}: PriceChartProps) {
  // Same point set the chart draws, so the annotation and the line can never
  // disagree about which way the period went.
  const trend = buildBalanceTrend(chartData, timeframe);

  return (
    <Card>
      {/* The period selector moved to the page header: it scopes the activity
          summary as well as this chart, so a control living inside one card
          understated what it governed. */}
      <p className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em] mb-1">
        Total Balance
      </p>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* The left column was two lines against a ~170px chart; the pending
            delta and wallet count fill that dead space with the numbers that
            previously had nowhere to live. */}
        <div className="flex-shrink-0 space-y-1">
          <Amount
            sats={totalBalance}
            size="xl"
            className="font-bold text-sanctuary-900 dark:text-sanctuary-50"
          />
          <BalanceTrendRow trend={trend} />
          {/* Pending is unconfirmed exposure, deliberately kept apart from the
              confirmed period change above it. */}
          <PendingTotalsRow pendingTotals={pendingTotals} unavailable={pendingUnavailable} />
          <p className="text-xs text-sanctuary-400">
            across {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
          </p>
        </div>
        <div className="flex-1 lg:w-2/3 min-w-[200px]">
          {/* Fed the same trend the annotation is written from, so the
              reference line and the stated change can never disagree about
              where the period opened. */}
          {historyUnavailable ? (
            // The fallback series is flat from `totalBalance` to
            // `totalBalance`. Drawn for a failed request it states that the
            // balance held steady all period — which nobody established.
            <div
              className="flex h-full min-h-[120px] items-center justify-center text-center"
              data-testid="balance-history-unavailable"
              role="status"
            >
              <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400 max-w-xs">
                Balance history unavailable. The total above is current; the
                chart cannot show how it changed.
              </p>
            </div>
          ) : (
            <PriceChartBody
              chartReady={chartReady}
              chartData={chartData}
              direction={trend.direction}
              openingSats={trend.openingSats}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

export { AnimatedPrice };
export type { PriceChartProps };
