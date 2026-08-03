import type { TransactionState } from '../../../../contexts/send/types';
import type { TransactionData } from '../../../../hooks/send/useSendTransactionActions';

type SummaryOutput = TransactionState['outputs'][number];

export function hasSendMaxOutput(outputs: SummaryOutput[]): boolean {
  return outputs.some((output) => output.sendMax);
}

export function getRecipientHeading(outputCount: number): string {
  return outputCount === 1 ? 'Recipient' : `Recipients (${outputCount})`;
}

export function getRecipientAmountText(
  output: SummaryOutput,
  format: (sats: number) => string
): string {
  return output.sendMax ? 'MAX' : format(parseInt(output.amount, 10) || 0);
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
  totalOutputAmount: number
): number {
  return hasSendMaxOutput(outputs) ? selectedTotal - estimatedFee : totalOutputAmount;
}

export function getNetworkFeeSats(txData: TransactionData | null | undefined, estimatedFee: number): number {
  return txData?.fee || estimatedFee;
}

export function getTotalIncludingFeeSats(
  outputs: SummaryOutput[],
  selectedTotal: number,
  totalOutputAmount: number,
  networkFee: number
): number {
  return hasSendMaxOutput(outputs) ? selectedTotal : totalOutputAmount + networkFee;
}

export function getCoinControlLabel(count: number): string {
  return `${count} UTXO${count !== 1 ? 's' : ''} selected`;
}
