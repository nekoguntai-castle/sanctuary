import { useMemo } from 'react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { usePriceFreeFormatter } from '../../../contexts/CurrencyContext';
import { buildBalanceAxis, buildTickFormatter } from './balanceAxisModel';
import type { PriceChartPoint } from './types';
import type { TrendDirection } from './balanceTrendModel';

interface PriceChartBodyProps {
  chartReady: boolean;
  chartData: PriceChartPoint[];
  direction?: TrendDirection;
  /**
   * Balance at the start of the period, marked with a reference line.
   *
   * Required, not defaulted: a missing value would fold 0 into the domain and
   * re-anchor the axis at zero — silently restoring the flat-line defect this
   * component exists to fix.
   */
  openingSats: number;
}

/**
 * Stroke, gradient and cursor all come from the same direction the annotation
 * above the chart states in words. The colour is reinforcement, never the only
 * carrier of the information — see BalanceTrendRow.
 *
 * Flat stays on the neutral Sanctuary palette rather than borrowing the primary
 * accent, so "no change" does not read as a highlighted state.
 */
/**
 * Series colours use only shades the theme actually emits. The themed palettes
 * are `bg`, `mainnet`, `primary`, `sent`, `shared`, `signet`, `success`,
 * `testnet` and `warning` — and `success`/`sent` skip 300 and 400 entirely, so
 * those shades would resolve to nothing. There is no `--color-rose-*`, which is
 * why the annotation text can use it and this cannot.
 *
 * `sent` is the established outgoing/negative palette (see the pending totals
 * row); `warning-*` means multisig/caution elsewhere and is not a loss colour.
 *
 * Axis ink is `--color-chart-axis`, the token both other recharts consumers in
 * the repo already use (WalletList/BalanceChart, WalletStats/WalletStatsCharts).
 * It resolves to `--color-bg-400`, which several themes invert between light
 * and dark and which the contrast setting adjusts — a hardcoded hex would do
 * neither. `flat` reuses it so "no change" sits on the same neutral as the axis.
 */
const AXIS_INK = 'var(--color-chart-axis)';

const X_AXIS_TICK = { fontSize: 10, fill: AXIS_INK };
const Y_AXIS_TICK = { fontSize: 10, fill: AXIS_INK };
const OPEN_LABEL = { value: 'open', position: 'insideBottomLeft' as const, fontSize: 9, fill: AXIS_INK };

/**
 * Fits the widest label this axis can produce — `1000.0000M`, or a BTC figure
 * at the eight-decimal cap. At the `min-w-[200px]` floor that is a little over
 * a quarter of the width, which is the deliberate trade for a readable scale;
 * above that breakpoint the chart column is far wider and the cost is minor.
 */
const Y_AXIS_WIDTH = 56;

const DIRECTION_COLORS: Record<TrendDirection, { stroke: string; fill: string; cursor: string }> = {
  gain: {
    stroke: 'var(--color-success-600)',
    fill: 'var(--color-success-500)',
    cursor: 'var(--color-success-500)',
  },
  loss: {
    stroke: 'var(--color-sent-600)',
    fill: 'var(--color-sent-500)',
    cursor: 'var(--color-sent-500)',
  },
  flat: {
    stroke: AXIS_INK,
    fill: AXIS_INK,
    cursor: AXIS_INK,
  },
};

export function PriceChartBody({
  chartReady,
  chartData,
  direction = 'flat',
  openingSats,
}: PriceChartBodyProps) {
  const colors = DIRECTION_COLORS[direction];
  const { format, unit } = usePriceFreeFormatter();

  // Memoised because this subtree now subscribes to the currency preferences
  // context, which republishes on any preference change — including the async
  // provider-list load that lands mid-way through the Area's entry animation.
  // Fresh `domain`/`ticks` array identities on each of those renders would
  // churn the axis for no reason.
  const axis = useMemo(() => buildBalanceAxis(chartData, openingSats), [chartData, openingSats]);
  const formatTick = useMemo(() => buildTickFormatter(axis, unit), [axis, unit]);

  // Distinct per direction: a single shared id would let one chart's gradient
  // definition win for another rendered on the same page.
  const gradientId = `colorSats-${direction}`;

  return (
    <div className="h-32 min-w-[200px]" data-testid="price-chart-body" data-direction={direction}>
      {chartReady && (
        <ResponsiveContainer width="99%" height={120}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.fill} stopOpacity={0.5} />
                <stop offset="60%" stopColor={colors.fill} stopOpacity={0.15} />
                <stop offset="100%" stopColor={colors.fill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={X_AXIS_TICK} />
            {/* Fitted rather than zero-based, and labelled so the reader can
                see where the scale starts — a truncated axis with no numbers
                would overstate every movement. */}
            <YAxis
              domain={axis.domain}
              ticks={axis.ticks}
              tickFormatter={formatTick}
              width={Y_AXIS_WIDTH}
              axisLine={false}
              tickLine={false}
              tick={Y_AXIS_TICK}
            />
            <Tooltip
              content={<ChartTooltip format={format} />}
              cursor={{ stroke: colors.cursor, strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            {/* The period's opening balance. Turns the shaded area between it
                and the line into the gain or loss the annotation states above,
                which is the thing a fitted axis alone still leaves implicit. */}
            <ReferenceLine
              y={openingSats}
              stroke={AXIS_INK}
              strokeDasharray="4 4"
              strokeWidth={1}
              label={OPEN_LABEL}
            />
            <Area
              type="monotone"
              dataKey="sats"
              stroke={colors.stroke}
              strokeWidth={2.5}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              animationDuration={1200}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
