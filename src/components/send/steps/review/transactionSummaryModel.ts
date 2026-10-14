import type { TransactionState } from '../../../../contexts/send/types';
import type { TransactionData } from '../../../../hooks/send/useSendTransactionActions';

type SummaryOutput = TransactionState['outputs'][number];

export function hasSendMaxOutput(outputs: SummaryOutput[]): boolean {
  return outputs.some((output) => output.sendMax);
}

export function getRecipientHeading(outputCount: number): string {
  return outputCount === 1 ? 'Recipient' : `Recipients (${outputCount})`;
}

/**
 * Change the built transaction actually pays back to the wallet: the primary
 * change output plus any decoy change outputs.
 */
export function getBuiltChangeSats(txData: TransactionData): number {
  return (txData.changeAmount ?? 0)
    + (txData.decoyOutputs ?? []).reduce((sum, decoy) => sum + decoy.amount, 0);
}

/**
 * Amount shown on a recipient row. Once the transaction is built, the PSBT's
 * output amount wins over the typed amount (they differ under subtract-fees).
 */
export function getRecipientDisplayAmount(
  output: SummaryOutput,
  index: number,
  outputCount: number,
  txData?: TransactionData | null
): number | 'MAX' {
  if (output.sendMax) return 'MAX';
  const built = txData?.outputs;
  if (built?.length === outputCount && built[index]?.address === output.address) {
    return built[index].amount;
  }
  return parseInt(output.amount, 10) || 0;
}

export function getPayjoinSummaryLabel(payjoinStatus: string): string {
  if (payjoinStatus === 'success') return 'Payjoin active';
  if (payjoinStatus === 'failed') return 'Payjoin (fallback)';
  return 'Payjoin enabled';
}

export function getTotalSendingSats(
  outputs: SummaryOutput[],
  selectedTotal: number,
  estimatedFee: number,
  totalOutputAmount: number,
  txData?: TransactionData | null
): number {
  if (txData) {
    const built = txData.outputs;
    // Built output amounts are authoritative; a MAX output may be stored as 0 (resumed drafts).
    if (built?.length && !built.some((output) => output.sendMax)) {
      return built.reduce((sum, output) => sum + output.amount, 0);
    }
    // Once built, the real fee and change are known; the pre-build estimate assumes 68-vB inputs.
    if (hasSendMaxOutput(outputs)) return txData.totalInput - txData.fee - getBuiltChangeSats(txData);
    return totalOutputAmount;
  }
  if (!hasSendMaxOutput(outputs)) return totalOutputAmount;
  return selectedTotal - estimatedFee;
}

export function getNetworkFeeSats(txData: TransactionData | null | undefined, estimatedFee: number): number {
  return txData?.fee || estimatedFee;
}

export function getTotalIncludingFeeSats(
  outputs: SummaryOutput[],
  selectedTotal: number,
  totalOutputAmount: number,
  networkFee: number,
  txData?: TransactionData | null
): number {
  if (txData) return getTotalSendingSats(outputs, selectedTotal, 0, totalOutputAmount, txData) + networkFee;
  if (!hasSendMaxOutput(outputs)) return totalOutputAmount + networkFee;
  return selectedTotal;
}

export function getCoinControlLabel(count: number): string {
  return `${count} UTXO${count !== 1 ? 's' : ''} selected`;
}
