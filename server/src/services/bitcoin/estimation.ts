/**
 * Transaction Estimation Module
 *
 * Fee and transaction size estimation utilities.
 */

import { systemSettingRepository } from '../../repositories';
import { DEFAULT_DUST_THRESHOLD } from '../../constants';
import { getErrorMessage } from '../../utils/errors';
import { SystemSettingSchemas } from '../../utils/safeJson';
import { selectUTXOs, UTXOSelectionStrategy } from './utxoSelection';

/**
 * Get dust threshold from system settings
 */
export async function getDustThreshold(): Promise<number> {
  return systemSettingRepository.getParsed('dustThreshold', SystemSettingSchemas.number, DEFAULT_DUST_THRESHOLD);
}

/**
 * Transaction estimation result
 */
export interface TransactionEstimate {
  fee: number;
  totalCost: number;
  inputCount: number;
  outputCount: number;
  changeAmount: number;
  sufficient: boolean;
  error?: string;
}

/**
 * Estimate transaction details before creating
 *
 * @param walletId - The wallet to estimate for
 * @param recipient - Recipient address (for validation)
 * @param amount - Amount to send in satoshis
 * @param feeRate - Fee rate in sat/vB
 * @param selectedUtxoIds - Optional specific UTXOs to use
 * @returns Estimation result with fee, costs, and sufficiency
 */
export async function estimateTransaction(
  walletId: string,
  _recipient: string,
  amount: number,
  feeRate: number,
  selectedUtxoIds?: string[]
): Promise<TransactionEstimate> {
  try {
    const dustThreshold = await getDustThreshold();
    const selection = await selectUTXOs(
      walletId,
      amount,
      feeRate,
      UTXOSelectionStrategy.LARGEST_FIRST,
      selectedUtxoIds
    );

    const outputCount = selection.changeAmount >= dustThreshold ? 2 : 1;

    return {
      fee: selection.estimatedFee,
      totalCost: amount + selection.estimatedFee,
      inputCount: selection.utxos.length,
      outputCount,
      changeAmount: selection.changeAmount,
      sufficient: true,
    };
  } catch (error) {
    return {
      fee: 0,
      totalCost: amount,
      inputCount: 0,
      outputCount: 1,
      changeAmount: 0,
      sufficient: false,
      error: getErrorMessage(error),
    };
  }
}
