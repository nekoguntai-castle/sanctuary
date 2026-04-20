import type { UTXO } from '../../../types';
import type { UtxoPrivacyInfo } from '../../../src/api/transactions';
import { isDustUtxo } from '../dustUtils';

export interface DustStats {
  count: number;
  total: number;
}

export const getUtxoId = (utxo: Pick<UTXO, 'txid' | 'vout'>): string => `${utxo.txid}:${utxo.vout}`;

export function createPrivacyMap(privacyData?: UtxoPrivacyInfo[]): Map<string, UtxoPrivacyInfo> {
  if (!privacyData) return new Map<string, UtxoPrivacyInfo>();

  return new Map(privacyData.map((privacyInfo) => [getUtxoId(privacyInfo), privacyInfo]));
}

export function getSelectedAmount(utxos: UTXO[], selectedUtxos: Set<string>): number {
  return utxos
    .filter((utxo) => selectedUtxos.has(getUtxoId(utxo)))
    .reduce((total, utxo) => total + utxo.amount, 0);
}

export function getDustStats(utxos: UTXO[], currentFeeRate: number): DustStats {
  const dustUtxos = utxos.filter(
    (utxo) => !utxo.frozen && !utxo.lockedByDraftId && isDustUtxo(utxo, currentFeeRate)
  );

  return {
    count: dustUtxos.length,
    total: dustUtxos.reduce((total, utxo) => total + utxo.amount, 0),
  };
}
