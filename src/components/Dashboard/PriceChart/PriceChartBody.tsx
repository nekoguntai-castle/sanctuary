import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import type { PriceChartPoint } from './types';
import type { TrendDirection } from './balanceTrendModel';

interface PriceChartBodyProps {
  chartReady: boolean;
  chartData: PriceChartPoint[];
  direction?: TrendDirection;
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
 * Only shades the theme actually emits. The themed palettes are `bg`,
 * `mainnet`, `primary`, `sent`, `shared`, `signet`, `success`, `testnet` and
 * `warning` — and `success`/`sent` skip 300 and 400 entirely, so those shades
 * would resolve to nothing. There is no `--color-rose-*` or
 * `--color-sanctuary-*`: those exist as Tailwind utility classes only, which is
 * why the annotation text can use them and this cannot.
 *
 * `sent` is the established outgoing/negative palette (see the pending totals
 * row); `warning-*` means multisig/caution elsewhere and is not a loss colour.
 *
 * Flat reuses the neutral already hardcoded for the axis ticks below.
 */
const NEUTRAL = '#a39e93';

const X_AXIS_TICK = { fontSize: 10, fill: NEUTRAL };

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
    stroke: NEUTRAL,
    fill: NEUTRAL,
    cursor: NEUTRAL,
  },
};

export function PriceChartBody({ chartReady, chartData, direction = 'flat' }: PriceChartBodyProps) {
  const colors = DIRECTION_COLORS[direction];
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
            <YAxis hide />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: colors.cursor, strokeWidth: 1, strokeDasharray: '4 4' }}
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
