import type { TransactionData } from '../../../hooks/send/useSendTransactionActions';
import type { TransactionState } from '../../../contexts/send/types';
import type { UTXO } from '../../../types';
import type { DraftTransactionData } from './types';
import { parsePositiveSatoshiAmount } from '../../../utils/sendAmount';

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

function createDraftOutputs(state: TransactionState): NonNullable<TransactionData['outputs']> | null {
  const outputs: NonNullable<TransactionData['outputs']> = [];
  for (const output of state.outputs) {
    if (output.sendMax) {
      outputs.push({ address: output.address, amount: 0, sendMax: true });
      continue;
    }
    const amount = parsePositiveSatoshiAmount(output.amount);
    if (amount === null) return null;
    outputs.push({ address: output.address, amount, sendMax: false });
  }
  return outputs;
}

export function createDraftInitialTxData({
  draftTxData,
  state,
  utxos,
}: DraftTransactionDataInput): TransactionData | null {
  if (!state.isDraftMode || !draftTxData || !state.unsignedPsbt
    || !draftTxData.intentId || !draftTxData.intentDigest) {
    return null;
  }

  const outputs = createDraftOutputs(state);
  if (!outputs) return null;
  const effectiveAmount = draftTxData.effectiveAmount;
  if (
    effectiveAmount !== undefined
    && parsePositiveSatoshiAmount(effectiveAmount.toString()) === null
  ) return null;

  return {
    psbtBase64: state.unsignedPsbt,
    intentId: draftTxData.intentId,
    intentDigest: draftTxData.intentDigest,
    fee: draftTxData.fee,
    totalInput: draftTxData.totalInput,
    totalOutput: draftTxData.totalOutput,
    changeAmount: draftTxData.changeAmount,
    changeAddress: draftTxData.changeAddress,
    effectiveAmount,
    utxos: draftTxData.selectedUtxoIds.map(id => findDraftUtxo(id, utxos)),
    outputs,
    inputPaths: draftTxData.inputPaths,
  };
}
