/**
 * Address Label Auto-Application
 *
 * Automatically applies address labels to new transactions based on
 * labels already assigned to the transaction's associated address.
 */

import { transactionRepository } from '../../../../../repositories';
import { createLogger } from '../../../../../utils/logger';
import type { TransactionCreateData } from '../../types';
import type { PrismaTxClient } from '../../../../../models/prisma';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

/**
 * Auto-apply address labels to new transactions. Canonical callers supply a
 * dedicated fenced transaction; compatibility callers retain best-effort
 * behavior outside the canonical worker.
 */
export async function applyAddressLabels(
  walletId: string,
  newTransactions: TransactionCreateData[],
  tx?: PrismaTxClient,
): Promise<void> {
  if (tx) {
    await applyAddressLabelsUnchecked(walletId, newTransactions, tx);
    return;
  }
  try {
    await applyAddressLabelsUnchecked(walletId, newTransactions);
  } catch (labelError) {
    log.warn(`[SYNC] Failed to auto-apply address labels: ${labelError}`);
  }
}

async function applyAddressLabelsUnchecked(
  walletId: string,
  newTransactions: TransactionCreateData[],
  tx?: PrismaTxClient,
): Promise<void> {
  const addressIds = [...new Set(newTransactions.map(transaction => transaction.addressId)
    .filter(Boolean))] as string[];
  if (addressIds.length === 0) return;
  const addressLabels = await transactionRepository.findAddressLabelsByAddressIds(addressIds, tx);
  if (addressLabels.length === 0) return;

  const labelsByAddress = new Map<string, string[]>();
  for (const addressLabel of addressLabels) {
    const labels = labelsByAddress.get(addressLabel.addressId) || [];
    labels.push(addressLabel.labelId);
    labelsByAddress.set(addressLabel.addressId, labels);
  }
  const createdTransactions = await transactionRepository.findByWalletIdAndTxids(
    walletId,
    newTransactions.map(transaction => transaction.txid),
    { id: true, txid: true, addressId: true },
    tx,
  );
  const labelRows: { transactionId: string; labelId: string }[] = [];
  for (const transaction of createdTransactions) {
    if (!transaction.addressId) continue;
    for (const labelId of labelsByAddress.get(transaction.addressId) || []) {
      labelRows.push({ transactionId: transaction.id, labelId });
    }
  }
  if (labelRows.length > 0) {
    await transactionRepository.createManyTransactionLabels(
      labelRows,
      { skipDuplicates: true },
      tx,
    );
  }
}
