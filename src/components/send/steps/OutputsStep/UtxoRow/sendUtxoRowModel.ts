import type { UTXO } from '../../../../../types';

interface CreateSendUtxoRowModelArgs {
  utxo: UTXO;
  selectable: boolean;
  selected: boolean;
}

export interface SendUtxoRowModel {
  utxoId: string;
  rowClassName: string;
  selectionClassName: string;
  shortAddress: string;
}

export function getUtxoId(utxo: Pick<UTXO, 'txid' | 'vout'>): string {
  return `${utxo.txid}:${utxo.vout}`;
}

export function createSendUtxoRowModel({
  utxo,
  selectable,
  selected,
}: CreateSendUtxoRowModelArgs): SendUtxoRowModel {
  const interactionClass = selectable
    ? 'cursor-pointer hover:shadow-sm'
    : 'cursor-not-allowed opacity-50';
  const selectedClass = selected
    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
    : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300';
  const selectionClassName = selected
    ? 'border-primary-500 bg-primary-500'
    : 'border-sanctuary-300 dark:border-sanctuary-600';

  return {
    utxoId: getUtxoId(utxo),
    rowClassName: `p-3 rounded-lg border transition-all ${interactionClass} ${selectedClass}`,
    selectionClassName,
    shortAddress: `${utxo.address.slice(0, 8)}...${utxo.address.slice(-6)}`,
  };
}
