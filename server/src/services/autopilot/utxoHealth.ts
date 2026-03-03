/**
 * UTXO Health Analysis
 *
 * Analyzes UTXO distribution for a wallet to determine
 * if consolidation would be beneficial.
 */

import { findUnspent } from '../../repositories/utxoRepository';
import type { UtxoHealthProfile } from './types';

/**
 * Build a health profile for a wallet's UTXO set.
 * Pure analysis — no side effects.
 */
export async function getUtxoHealthProfile(
  walletId: string,
  dustThreshold: number
): Promise<UtxoHealthProfile> {
  const utxos = await findUnspent(walletId);

  if (utxos.length === 0) {
    return {
      totalUtxos: 0,
      dustCount: 0,
      dustValue: BigInt(0),
      totalValue: BigInt(0),
      avgUtxoSize: BigInt(0),
      smallestUtxo: BigInt(0),
      largestUtxo: BigInt(0),
    };
  }

  const dustThresholdBig = BigInt(dustThreshold);
  let totalValue = BigInt(0);
  let dustCount = 0;
  let dustValue = BigInt(0);
  let smallest = utxos[0].amount;
  let largest = utxos[0].amount;

  for (const utxo of utxos) {
    totalValue += utxo.amount;
    if (utxo.amount < dustThresholdBig) {
      dustCount++;
      dustValue += utxo.amount;
    }
    if (utxo.amount < smallest) smallest = utxo.amount;
    if (utxo.amount > largest) largest = utxo.amount;
  }

  return {
    totalUtxos: utxos.length,
    dustCount,
    dustValue,
    totalValue,
    avgUtxoSize: totalValue / BigInt(utxos.length),
    smallestUtxo: smallest,
    largestUtxo: largest,
  };
}
