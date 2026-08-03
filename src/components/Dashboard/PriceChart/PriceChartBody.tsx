import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import type { PriceChartPoint } from './types';

interface PriceChartBodyProps {
  chartReady: boolean;
  chartData: PriceChartPoint[];
}

const X_AXIS_TICK = { fontSize: 10, fill: '#a39e93' };

export function PriceChartBody({ chartReady, chartData }: PriceChartBodyProps) {
  return (
    <div className="h-32 min-w-[200px]">
      {chartReady && (
        <ResponsiveContainer width="99%" height={120}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorSats" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary-400)" stopOpacity={0.5} />
                <stop offset="60%" stopColor="var(--color-primary-400)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--color-primary-400)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={X_AXIS_TICK} />
            <YAxis hide />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: 'var(--color-primary-300)', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="sats"
              stroke="var(--color-primary-500)"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#colorSats)"
              animationDuration={1200}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
