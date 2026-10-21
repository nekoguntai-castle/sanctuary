/**
 * Transaction Helpers
 *
 * Small utility functions shared across transaction modules:
 * - Legacy script detection
 * - Unique constraint error checking
 * - Raw transaction fetching for legacy inputs
 */

import { getNodeClient } from '../nodeClient';
// Direct import, not ../advancedTx or ../advancedTx/shared: either would close a runtime import cycle.
import { fetchAuthenticatedTransaction } from '../nodeTransactionAuthentication';
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
 * Fetch raw transaction hex for nonWitnessUtxo (required for legacy inputs).
 * The node client returns a decoded transaction object; its bytes are
 * authenticated against the requested txid before the hex is returned.
 */
export async function getRawTransactionHex(txid: string, network: BitcoinNetwork): Promise<string> {
  const client = await getNodeClient(network);
  return (await fetchAuthenticatedTransaction(client, txid)).canonicalHex;
}
