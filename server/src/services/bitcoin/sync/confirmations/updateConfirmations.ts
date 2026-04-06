/**
 * Transaction Confirmation Updates
 *
 * Updates confirmation counts for pending transactions using the current
 * block height. Returns detailed info about which transactions changed,
 * for milestone notifications.
 */

import { db as prisma } from '../../../../repositories/db';
import { systemSettingRepository } from '../../../../repositories';
import { DEFAULT_DEEP_CONFIRMATION_THRESHOLD } from '../../../../constants';
import { getBlockHeight } from '../../utils/blockHeight';
import { SystemSettingSchemas } from '../../../../utils/safeJson';
import { executeInChunks } from './batchUpdates';
import type { ConfirmationUpdate } from './types';

/**
 * Update confirmations for pending transactions - OPTIMIZED with batch updates
 * Returns detailed info about which transactions changed, for milestone notifications
 */
export async function updateTransactionConfirmations(walletId: string): Promise<ConfirmationUpdate[]> {
  // Get wallet to determine network for correct block height
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { network: true },
  });
  if (!wallet) return [];

  const network = (wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';

  // Get deep confirmation threshold from settings
  const deepConfirmationThreshold = await systemSettingRepository.getParsed('deepConfirmationThreshold', SystemSettingSchemas.number, DEFAULT_DEEP_CONFIRMATION_THRESHOLD);

  const transactions = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: deepConfirmationThreshold }, // Only update transactions below deep confirmation threshold
      blockHeight: { not: null },
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });

  if (transactions.length === 0) return [];

  const currentHeight = await getBlockHeight(network);

  // Calculate new confirmations and collect updates
  const updates: Array<{ id: string; txid: string; oldConfirmations: number; newConfirmations: number }> = [];

  for (const tx of transactions) {
    if (tx.blockHeight) {
      const newConfirmations = Math.max(0, currentHeight - tx.blockHeight + 1);
      if (newConfirmations !== tx.confirmations) {
        updates.push({
          id: tx.id,
          txid: tx.txid,
          oldConfirmations: tx.confirmations,
          newConfirmations,
        });
      }
    }
  }

  // Batch update using chunked transactions to avoid long locks
  if (updates.length > 0) {
    await executeInChunks(updates, (u) =>
      prisma.transaction.update({
        where: { id: u.id },
        data: {
          confirmations: u.newConfirmations,
          // When a transaction transitions from 0 to confirmed, update rbfStatus
          // to 'confirmed' to prevent cleanup logic from incorrectly marking it as replaced
          ...(u.oldConfirmations === 0 && u.newConfirmations > 0 ? { rbfStatus: 'confirmed' } : {}),
        },
      }),
      walletId
    );
  }

  return updates.map(u => ({
    txid: u.txid,
    oldConfirmations: u.oldConfirmations,
    newConfirmations: u.newConfirmations,
  }));
}
