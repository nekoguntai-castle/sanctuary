import React from 'react';
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AccumulationPoint, UtxoAgeBucket } from './walletStatsData';

type SatsFormatter = (sats: number) => string;

interface WalletStatsChartsProps {
  accumulationData: AccumulationPoint[];
  ageData: UtxoAgeBucket[];
  chartReady: boolean;
  format: SatsFormatter;
}

interface ChartPanelProps {
  children: React.ReactNode;
  title: string;
}

const TOOLTIP_STYLE = {
  backgroundColor: '#1c1917',
  border: 'none',
  borderRadius: '8px',
  color: '#fff',
};

const AGE_BUCKET_COLORS = ['#d4b483', '#84a98c', '#57534e', '#a8a29e'];

function ChartPanel({ children, title }: ChartPanelProps) {
  return (
    <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
      <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-6">{title}</h3>
      <div className="h-64 min-w-[200px]">{children}</div>
    </div>
  );
}

function AccumulationHistoryChart({
  chartReady,
  data,
  format,
}: {
  chartReady: boolean;
  data: AccumulationPoint[];
  format: SatsFormatter;
}) {
  return (
    <ChartPanel title="Accumulation History">
      {chartReady && (
        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#d4b483" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#d4b483" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#a8a29e' }} />
            <YAxis hide domain={[0, 'dataMax']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value) => [format(value as number), 'Balance']}
            />
            <Area type="monotone" dataKey="amount" stroke="#d4b483" strokeWidth={2} fillOpacity={1} fill="url(#colorAmount)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

function UtxoAgeDistributionChart({
  chartReady,
  data,
  format,
}: {
  chartReady: boolean;
  data: UtxoAgeBucket[];
  format: SatsFormatter;
}) {
  return (
    <ChartPanel title="UTXO Age Distribution">
      {chartReady && (
        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
          <BarChart data={data}>
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#a8a29e' }} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: 'transparent' }}
              contentStyle={TOOLTIP_STYLE}
              formatter={(value) => [format(value as number), 'Amount']}
            />
            <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={AGE_BUCKET_COLORS[index % AGE_BUCKET_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

export const WalletStatsCharts: React.FC<WalletStatsChartsProps> = ({
  accumulationData,
  ageData,
  chartReady,
  format,
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    <AccumulationHistoryChart chartReady={chartReady} data={accumulationData} format={format} />
    <UtxoAgeDistributionChart chartReady={chartReady} data={ageData} format={format} />
  </div>
);
