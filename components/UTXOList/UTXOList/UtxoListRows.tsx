import type { UTXO } from '../../../types';
import type { UtxoPrivacyInfo } from '../../../src/api/transactions';
import { UTXORow } from '../UTXORow';
import { getUtxoId } from './utxoListModel';

interface UtxoListRowsProps {
  utxos: UTXO[];
  selectedUtxos: Set<string>;
  selectable: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleFreeze: (txid: string, vout: number) => void;
  onShowPrivacyDetail: (utxoId: string) => void;
  privacyMap: Map<string, UtxoPrivacyInfo>;
  showPrivacy: boolean;
  currentFeeRate: number;
  network: string;
  explorerUrl: string;
  format: (sats: number) => string;
}

export function UtxoListRows({
  utxos,
  selectedUtxos,
  selectable,
  onToggleSelect,
  onToggleFreeze,
  onShowPrivacyDetail,
  privacyMap,
  showPrivacy,
  currentFeeRate,
  network,
  explorerUrl,
  format,
}: UtxoListRowsProps) {
  return (
    <div className="grid gap-3">
      {utxos.map((utxo) => {
        const id = getUtxoId(utxo);

        return (
          <UTXORow
            key={id}
            utxo={utxo}
            isSelected={selectedUtxos.has(id)}
            selectable={selectable}
            onToggleSelect={onToggleSelect}
            onToggleFreeze={onToggleFreeze}
            onShowPrivacyDetail={onShowPrivacyDetail}
            privacyInfo={privacyMap.get(id)}
            showPrivacy={showPrivacy}
            currentFeeRate={currentFeeRate}
            network={network}
            explorerUrl={explorerUrl}
            format={format}
          />
        );
      })}
    </div>
  );
}
