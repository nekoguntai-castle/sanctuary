import type { ChartTooltipProps } from './types';

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="surface-elevated font-sans rounded-lg px-3 py-2 shadow-lg border border-sanctuary-200 dark:border-sanctuary-700">
      <p className="text-[10px] uppercase tracking-wider text-sanctuary-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold font-mono tabular-nums text-primary-600">
        {Number(payload[0].value).toLocaleString()} sats
      </p>
    </div>
  );
}
