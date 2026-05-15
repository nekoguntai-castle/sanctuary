/**
 * Transaction Helpers
 *
 * Small utility functions shared across transaction modules:
 * - Legacy script detection
 * - Unique constraint error checking
 * - Raw transaction fetching for legacy inputs
 */

import { getNodeClient } from '../nodeClient';
import type { BitcoinNetwork } from '../networks';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
export { isUniqueConstraintError } from '../../../utils/errors';

/**
 * Check if a script type is legacy (requires nonWitnessUtxo)
 * Legacy P2PKH wallets use full previous transactions instead of witnessUtxo
 */
export function isLegacyScriptType(scriptType: string | null): boolean {
  return scriptType === WalletScriptType.LEGACY || scriptType === 'p2pkh' || scriptType === 'P2PKH';
}

/**
 * Fetch raw transaction hex for nonWitnessUtxo (required for legacy inputs)
 */
export async function getRawTransactionHex(txid: string, network: BitcoinNetwork): Promise<string> {
  const client = await getNodeClient(network);
  // getTransaction with verbose=false returns raw hex
  const rawHex = await client.getTransaction(txid, false);
  return rawHex;
}
