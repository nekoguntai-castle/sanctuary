/**
 * Transaction Helpers
 *
 * Small utility functions shared across transaction modules:
 * - Legacy script detection
 * - Unique constraint error checking
 * - Raw transaction fetching for legacy inputs
 */

import { Prisma } from '@prisma/client';
import { getNodeClient } from '../nodeClient';

/**
 * Check if a script type is legacy (requires nonWitnessUtxo)
 * Legacy P2PKH wallets use full previous transactions instead of witnessUtxo
 */
export function isLegacyScriptType(scriptType: string | null): boolean {
  return scriptType === 'legacy' || scriptType === 'p2pkh' || scriptType === 'P2PKH';
}

/**
 * Check if an error is a Prisma unique constraint violation
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  return String(error).includes('Unique constraint');
}

/**
 * Fetch raw transaction hex for nonWitnessUtxo (required for legacy inputs)
 */
export async function getRawTransactionHex(txid: string): Promise<string> {
  const client = await getNodeClient();
  // getTransaction with verbose=false returns raw hex
  const rawHex = await client.getTransaction(txid, false);
  return rawHex;
}
