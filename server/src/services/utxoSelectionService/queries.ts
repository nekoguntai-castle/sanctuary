/**
 * UTXO Selection Queries
 *
 * Database queries for fetching available UTXOs.
 */

import { db as prisma } from '../../repositories/db';
import type { SelectedUtxo } from './types';

/**
 * Get available UTXOs for selection
 */
export async function getAvailableUtxos(
  walletId: string,
  options: {
    excludeFrozen?: boolean;
    excludeUnconfirmed?: boolean;
    excludeUtxoIds?: string[];
  }
): Promise<SelectedUtxo[]> {
  const where: Record<string, unknown> = {
    walletId,
    spent: false,
  };

  if (options.excludeFrozen !== false) {
    where.frozen = false;
  }

  if (options.excludeUnconfirmed) {
    where.confirmations = { gt: 0 };
  }

  if (options.excludeUtxoIds?.length) {
    where.id = { notIn: options.excludeUtxoIds };
  }

  // Also exclude UTXOs locked by drafts
  where.draftLock = null;

  const utxos = await prisma.uTXO.findMany({
    where,
    select: {
      id: true,
      txid: true,
      vout: true,
      address: true,
      amount: true,
      confirmations: true,
      blockHeight: true,
    },
    orderBy: { amount: 'desc' },
  });

  return utxos.map(u => ({
    id: u.id,
    txid: u.txid,
    vout: u.vout,
    address: u.address,
    amount: u.amount,
    confirmations: u.confirmations,
    blockHeight: u.blockHeight ?? undefined,
  }));
}
