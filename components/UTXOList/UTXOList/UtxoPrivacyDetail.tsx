import type { UTXO } from '../../../types';
import type { UtxoPrivacyInfo } from '../../../src/api/transactions';
import { PrivacyDetailPanel } from '../../PrivacyDetailPanel';
import { getUtxoId } from './utxoListModel';

interface UtxoPrivacyDetailProps {
  selectedUtxoId: string | null;
  utxos: UTXO[];
  privacyMap: Map<string, UtxoPrivacyInfo>;
  onClose: () => void;
}

export function UtxoPrivacyDetail({
  selectedUtxoId,
  utxos,
  privacyMap,
  onClose,
}: UtxoPrivacyDetailProps) {
  if (!selectedUtxoId) return null;

  const privacyInfo = privacyMap.get(selectedUtxoId);
  const utxo = utxos.find((candidate) => getUtxoId(candidate) === selectedUtxoId);

  if (!privacyInfo || !utxo) return null;

  return (
    <PrivacyDetailPanel
      utxo={{
        txid: utxo.txid,
        vout: utxo.vout,
        amount: utxo.amount,
        address: utxo.address,
      }}
      privacyInfo={privacyInfo}
      onClose={onClose}
    />
  );
}
