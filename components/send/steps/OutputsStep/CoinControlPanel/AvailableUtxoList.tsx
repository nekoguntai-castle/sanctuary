import type { UTXO } from '../../../../../types';
import type { UtxoPrivacyInfo } from '../../../../../src/api/transactions';
import { UtxoRow } from '../UtxoRow';
import { getUtxoId } from './coinControlModel';

interface AvailableUtxoListProps {
  available: UTXO[];
  selectedUTXOs: Set<string>;
  utxoPrivacyMap: Map<string, UtxoPrivacyInfo>;
  onToggleUtxo: (utxoId: string) => void;
  format: (amount: number) => string;
  formatFiat: (amount: number) => string | null;
}

export function AvailableUtxoList({
  available,
  selectedUTXOs,
  utxoPrivacyMap,
  onToggleUtxo,
  format,
  formatFiat,
}: AvailableUtxoListProps) {
  if (available.length === 0) {
    return (
      <div className="text-center py-4 text-sanctuary-500 text-sm">
        No spendable UTXOs
      </div>
    );
  }

  return (
    <>
      {available.map((utxo) => {
        const utxoId = getUtxoId(utxo);

        return (
          <UtxoRow
            key={utxoId}
            utxo={utxo}
            selectable={true}
            selected={selectedUTXOs.has(utxoId)}
            privacyInfo={utxoPrivacyMap.get(utxoId)}
            onToggle={onToggleUtxo}
            format={format}
            formatFiat={formatFiat}
          />
        );
      })}
    </>
  );
}
