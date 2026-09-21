import { Prisma } from '../../generated/prisma/client';
import type { PrismaTxClient } from '../../models/prisma';

/**
 * Persist a repair request in the caller's transaction after a mutation changes
 * live-ledger membership. The database function from
 * 20260731220000_add_transaction_classification_version coalesces by wallet.
 */
export async function queueWalletBalanceRepair(
  walletId: string,
  client: PrismaTxClient,
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    SELECT "queue_wallet_balance_repair"(${walletId})
  `);
}
