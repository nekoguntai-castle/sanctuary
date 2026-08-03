import type { TransactionData } from '../../../hooks/send/useSendTransactionActions';
import type { TransactionState } from '../../../contexts/send/types';
import type { UTXO } from '../../../types';
import type { DraftTransactionData } from './types';

interface DraftTransactionDataInput {
  draftTxData?: DraftTransactionData;
  state: TransactionState;
  utxos: UTXO[];
}

function findDraftUtxo(id: string, utxos: UTXO[]): TransactionData['utxos'][number] {
  const [txid, voutStr] = id.split(':');
  const vout = parseInt(voutStr, 10);
  const fullUtxo = utxos.find(utxo => utxo.txid === txid && utxo.vout === vout);

  return {
    txid,
    vout,
    address: fullUtxo?.address || '',
    amount: fullUtxo?.amount || 0,
  };
}

function createDraftOutputs(state: TransactionState): NonNullable<TransactionData['outputs']> {
  return state.outputs.map(output => ({
    address: output.address,
    amount: parseInt(output.amount, 10) || 0,
  }));
}

export function createDraftInitialTxData({
  draftTxData,
  state,
  utxos,
}: DraftTransactionDataInput): TransactionData | null {
  if (!state.isDraftMode || !draftTxData || !state.unsignedPsbt) {
    return null;
  }

  return {
    psbtBase64: state.unsignedPsbt,
    fee: draftTxData.fee,
    totalInput: draftTxData.totalInput,
    totalOutput: draftTxData.totalOutput,
    changeAmount: draftTxData.changeAmount,
    changeAddress: draftTxData.changeAddress,
    effectiveAmount: draftTxData.effectiveAmount,
    utxos: draftTxData.selectedUtxoIds.map(id => findDraftUtxo(id, utxos)),
    outputs: createDraftOutputs(state),
    inputPaths: draftTxData.inputPaths,
  };
}
