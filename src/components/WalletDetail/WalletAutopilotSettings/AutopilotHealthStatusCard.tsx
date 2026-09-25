import { Activity } from 'lucide-react';
import type React from 'react';
import { usePriceFreeFormatter } from '../../../contexts/CurrencyContext';
import type { AutopilotStatus } from '../../../types';

/** A sats amount (serialized as a string) shown in the user's BTC/sats unit. */
function AmountHealthRow({ label, sats }: { label: string; sats: string }) {
  const { format } = usePriceFreeFormatter();
  return <HealthRow label={label} value={format(Number(sats))} mono />;
}

function HealthRow({
  label,
  value,
  mono = false,
  fullWidth = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700 ${fullWidth ? 'col-span-2' : ''}`}>
      <span className="text-sanctuary-500">{label}</span>
      <span className={`text-sanctuary-900 dark:text-sanctuary-100 ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  );
}

export function AutopilotHealthStatusCard({
  status,
  visible,
}: {
  status: AutopilotStatus | null;
  visible: boolean;
}) {
  if (!visible || !status) return null;

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Activity className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">UTXO Health</h3>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <HealthRow label="Total UTXOs" value={status.utxoHealth.totalUtxos} />
          <HealthRow label="Candidates" value={status.utxoHealth.consolidationCandidates} />
          <HealthRow label="Dust UTXOs" value={status.utxoHealth.dustCount} />
          <AmountHealthRow label="Dust value" sats={status.utxoHealth.dustValue} />
          <AmountHealthRow label="Smallest" sats={status.utxoHealth.smallestUtxo} />
          <AmountHealthRow label="Largest" sats={status.utxoHealth.largestUtxo} />
          {status.feeSnapshot && (
            <HealthRow label="Economy fee" value={`${status.feeSnapshot.economy} sat/vB`} fullWidth />
          )}
        </div>
      </div>
    </div>
  );
}
