import type { RBFCheckResult, RBFTransactionResponse } from '../../src/api/bitcoin';
import type { CreateDraftRequest } from '../../src/api/drafts';

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function cpfpSuccessMessage(effectiveFeeRate: number): string {
  return `CPFP transaction created! Effective fee rate: ${effectiveFeeRate.toFixed(2)} sat/vB`;
}

export function rbfDraftRequest({
  originalLabel,
  rbfStatus,
  result,
  txid,
}: {
  originalLabel: string | null | undefined;
  rbfStatus: RBFCheckResult;
  result: RBFTransactionResponse;
  txid: string;
}): CreateDraftRequest {
  const primaryOutput = result.outputs[0];
  const totalInput = result.inputs.reduce((sum, input) => sum + input.value, 0);
  const totalOutput = result.outputs.reduce((sum, output) => sum + output.value, 0);

  return {
    recipient: primaryOutput.address,
    amount: primaryOutput.value,
    feeRate: result.feeRate,
    selectedUtxoIds: result.inputs.map((input) => `${input.txid}:${input.vout}`),
    enableRBF: true,
    subtractFees: false,
    sendMax: false,
    isRBF: true,
    outputs: result.outputs.map((output) => ({ address: output.address, amount: output.value })),
    label: originalLabel || fallbackRbfLabel(rbfStatus, result),
    memo: `Replacing transaction ${txid}`,
    psbtBase64: result.psbtBase64,
    fee: result.fee,
    totalInput,
    totalOutput,
    changeAmount: 0,
    effectiveAmount: primaryOutput.value,
    inputPaths: [],
  };
}

function fallbackRbfLabel(rbfStatus: RBFCheckResult, result: RBFTransactionResponse): string {
  return `RBF: Fee bump from ${rbfStatus.currentFeeRate} to ${result.feeRate} sat/vB`;
}
