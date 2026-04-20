import type { UTXO } from '../../../../../types';

export const getUtxoId = (utxo: Pick<UTXO, 'txid' | 'vout'>): string => `${utxo.txid}:${utxo.vout}`;
