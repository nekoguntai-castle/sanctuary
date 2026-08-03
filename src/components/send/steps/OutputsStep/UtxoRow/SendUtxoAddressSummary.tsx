import type { UTXO } from '../../../../../types';
import { SendUtxoAgeLabel } from './SendUtxoAgeLabel';

interface SendUtxoAddressSummaryProps {
  utxo: UTXO;
  shortAddress: string;
}

export function SendUtxoAddressSummary({
  utxo,
  shortAddress,
}: SendUtxoAddressSummaryProps) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-xs text-sanctuary-900 dark:text-sanctuary-100 truncate">
        {shortAddress}
      </div>
      <div className="text-[10px] text-sanctuary-500 flex items-center gap-1.5">
        <SendUtxoAgeLabel utxo={utxo} />
      </div>
    </div>
  );
}
