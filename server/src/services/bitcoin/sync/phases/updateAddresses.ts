/**
 * Update Addresses Phase
 *
 * Marks addresses as "used" if they have transaction history.
 * This enables proper gap limit tracking for BIP-44 wallets.
 */

import { addressRepository } from '../../../../repositories';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';
import { runWalletSyncMutation } from '../mutationBoundary';

const log = createLogger('BITCOIN:SVC_SYNC_ADDRESSES');

/**
 * Execute update addresses phase
 *
 * After fetching histories, this phase marks all addresses that
 * have at least one transaction as "used".
 */
export async function updateAddressesPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, historyResults } = ctx;

  walletLog(walletId, 'debug', 'SYNC', 'Updating address states...');

  // Collect addresses with transaction history
  const usedAddresses = new Set<string>();
  for (const [addressStr, history] of historyResults) {
    if (history.length > 0) {
      usedAddresses.add(addressStr);
    }
  }

  if (usedAddresses.size > 0) {
    await runWalletSyncMutation(ctx, 'address_usage', async (tx, deferPostCommit) => {
      const count = await addressRepository.markManyAsUsedByAddress(
        walletId,
        Array.from(usedAddresses),
        tx,
      );
      if (count > 0) {
        deferPostCommit(() => {
          ctx.stats.addressesUpdated = count;
          log.debug(`[SYNC] Marked ${count} addresses as used`);
        });
      }
    });
  }

  return ctx;
}
