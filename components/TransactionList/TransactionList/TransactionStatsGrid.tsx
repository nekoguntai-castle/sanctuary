import type React from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Amount } from '../../Amount';

export type TransactionListStats = {
  total: number;
  received: number;
  sent: number;
  consolidations: number;
  totalReceived: number;
  totalSent: number;
  totalFees: number;
};

export function TransactionStatsGrid({ txStats }: { txStats: TransactionListStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
      <StatTile label="Total" value={txStats.total} />
      <StatTile label="Received" value={txStats.received} icon={<ArrowDownLeft className="w-3 h-3 text-success-500" />} valueClassName="text-success-600 dark:text-success-400" />
      <StatTile label="Sent" value={txStats.sent} icon={<ArrowUpRight className="w-3 h-3 text-sanctuary-500" />} />
      <StatTile label="Consolidations" value={txStats.consolidations} icon={<RefreshCw className="w-3 h-3 text-primary-500" />} valueClassName="text-primary-600 dark:text-primary-400" />
      <AmountStatTile label="Total In" sats={txStats.totalReceived} labelClassName="text-success-500" valueClassName="text-success-600 dark:text-success-400" />
      <AmountStatTile label="Total Out" sats={txStats.totalSent} labelClassName="text-sanctuary-500" valueClassName="text-sanctuary-900 dark:text-sanctuary-100" />
      <AmountStatTile label="Fees Paid" sats={txStats.totalFees} labelClassName="text-warning-500" valueClassName="text-warning-600 dark:text-warning-400" />
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  valueClassName = 'text-sanctuary-900 dark:text-sanctuary-100',
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-center gap-1 text-xs text-sanctuary-500 uppercase">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-semibold ${valueClassName}`}>{value}</div>
    </div>
  );
}

function AmountStatTile({
  label,
  sats,
  labelClassName,
  valueClassName,
}: {
  label: string;
  sats: number;
  labelClassName: string;
  valueClassName: string;
}) {
  return (
    <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <div className={`text-xs uppercase ${labelClassName}`}>{label}</div>
      <div className={`text-sm font-semibold ${valueClassName}`}>
        <Amount sats={sats} size="sm" />
      </div>
    </div>
  );
}
