import type { RBFCheckResult, RBFTransactionResponse } from '../../api/bitcoin';
import type { CreateDraftRequest } from '../../api/drafts';

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function cpfpSuccessMessage(effectiveFeeRate: number): string {
  return `CPFP transaction created! Effective fee rate: ${effectiveFeeRate.toFixed(2)} sat/vB`;
}

/**
 * Build the draft-creation request for an RBF replacement, plus the
 * structural `replacesTxid` linkage that the eventual broadcast request must
 * carry. `replacesTxid` is NOT part of `CreateDraftRequest` (the draft
 * creation schema is strict and has no such column); callers must strip it
 * before posting the draft and thread it separately through to broadcast.
 * The `memo` field stays purely descriptive — the server no longer inspects
 * it (rbf-memo-prefix-spoofs-transaction-replacement).
 */
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
}): CreateDraftRequest & { replacesTxid: string } {
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
    replacesTxid: txid,
    psbtBase64: result.psbtBase64,
    intentId: result.intentId,
    intentDigest: result.intentDigest,
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
