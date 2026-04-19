import type { Transaction } from '../../../types';

type TransactionWithInputs = Transaction & { inputs: NonNullable<Transaction['inputs']> };

export function getFlowInputs(fullTxDetails: TransactionWithInputs) {
  return fullTxDetails.inputs.map(input => ({
    txid: input.txid,
    vout: input.vout,
    address: input.address,
    amount: input.amount,
  }));
}

export function getFlowOutputs(fullTxDetails: TransactionWithInputs) {
  return getOutputs(fullTxDetails).map(output => ({
    address: output.address,
    amount: output.amount,
    isChange: output.outputType === 'change',
    label: output.outputType !== 'unknown' ? output.outputType : undefined,
  }));
}

export function getTotalInput(fullTxDetails: TransactionWithInputs): number {
  return fullTxDetails.inputs.reduce((sum, input) => sum + input.amount, 0);
}

export function getTotalOutput(fullTxDetails: TransactionWithInputs): number {
  return getOutputs(fullTxDetails).reduce((sum, output) => sum + output.amount, 0);
}

export function hasFlowInputs(fullTxDetails: Transaction | null): fullTxDetails is TransactionWithInputs {
  return Boolean(fullTxDetails?.inputs && fullTxDetails.inputs.length > 0);
}

function getOutputs(fullTxDetails: TransactionWithInputs) {
  return fullTxDetails.outputs || [];
}
