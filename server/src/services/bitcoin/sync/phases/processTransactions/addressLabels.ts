/**
 * Address Label Auto-Application
 *
 * Automatically applies address labels to new transactions based on
 * labels already assigned to the transaction's associated address.
 */

import { db as prisma } from '../../../../../repositories/db';
import { createLogger } from '../../../../../utils/logger';
import type { TransactionCreateData } from '../../types';

const log = createLogger('SYNC-TX');

/**
 * Auto-apply address labels to new transactions
 */
export async function applyAddressLabels(
  walletId: string,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  try {
    const addressIds = [...new Set(newTransactions.map(tx => tx.addressId).filter(Boolean))] as string[];
    if (addressIds.length === 0) return;

    const addressLabels = await prisma.addressLabel.findMany({
      where: { addressId: { in: addressIds } },
    });

    if (addressLabels.length === 0) return;

    const labelsByAddress = new Map<string, string[]>();
    for (const al of addressLabels) {
      const labels = labelsByAddress.get(al.addressId) || [];
      labels.push(al.labelId);
      labelsByAddress.set(al.addressId, labels);
    }

    const createdTxs = await prisma.transaction.findMany({
      where: {
        walletId,
        txid: { in: newTransactions.map(tx => tx.txid) },
      },
      select: { id: true, txid: true, addressId: true },
    });

    const txLabelData: { transactionId: string; labelId: string }[] = [];
    for (const tx of createdTxs) {
      if (tx.addressId) {
        const labels = labelsByAddress.get(tx.addressId) || [];
        for (const labelId of labels) {
          txLabelData.push({ transactionId: tx.id, labelId });
        }
      }
    }

    if (txLabelData.length > 0) {
      await prisma.transactionLabel.createMany({
        data: txLabelData,
        skipDuplicates: true,
      });
    }
  } catch (labelError) {
    log.warn(`[SYNC] Failed to auto-apply address labels: ${labelError}`);
  }
}
