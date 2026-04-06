/**
 * Address Discovery and Gap Limit Management
 *
 * Handles BIP-44 gap limit expansion to ensure there are always
 * sufficient unused addresses at the end of both receive and change chains.
 */

import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { walletLog } from '../../../websocket/notifications';
import { ADDRESS_GAP_LIMIT } from '../../../constants';
import * as addressDerivation from '../addressDerivation';

const log = createLogger('BITCOIN:SVC_ADDR_DISCOVERY');

/**
 * Check and expand addresses to maintain gap limit
 *
 * BIP-44 specifies a "gap limit" of 20 - the wallet should stop looking for
 * addresses after finding 20 consecutive unused addresses. Conversely, we need
 * to ensure there are always at least 20 unused addresses at the end of both
 * the receive and change chains.
 *
 * @returns Array of newly generated addresses that should be scanned
 */
export async function ensureGapLimit(walletId: string): Promise<Array<{ address: string; derivationPath: string }>> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, descriptor: true, network: true },
  });

  if (!wallet?.descriptor) {
    log.debug(`Wallet ${walletId} has no descriptor, skipping gap limit check`);
    return [];
  }

  // Get all addresses with their used status
  const addresses = await prisma.address.findMany({
    where: { walletId },
    select: { derivationPath: true, index: true, used: true },
    orderBy: { index: 'asc' },
  });

  // Separate into receive (/0/) and change (/1/) addresses
  const receiveAddrs = addresses.filter(a => a.derivationPath?.includes('/0/'));
  const changeAddrs = addresses.filter(a => a.derivationPath?.includes('/1/'));

  const newAddresses: Array<{ address: string; derivationPath: string }> = [];

  // Check receive addresses gap limit
  const receiveGap = countUnusedGap(receiveAddrs);
  if (receiveGap < ADDRESS_GAP_LIMIT) {
    const maxReceiveIndex = Math.max(-1, ...receiveAddrs.map(a => a.index));
    const toGenerate = ADDRESS_GAP_LIMIT - receiveGap;

    walletLog(walletId, 'info', 'ADDRESS', `Expanding receive addresses (gap: ${receiveGap}/${ADDRESS_GAP_LIMIT})`, {
      currentMax: maxReceiveIndex,
      generating: toGenerate,
    });

    for (let i = maxReceiveIndex + 1; i <= maxReceiveIndex + toGenerate; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          { network: wallet.network as 'mainnet' | 'testnet' | 'regtest', change: false }
        );
        newAddresses.push({ address, derivationPath });
      } catch (err) {
        log.error(`Failed to derive receive address ${i}`, { error: getErrorMessage(err) });
      }
    }
  }

  // Check change addresses gap limit
  const changeGap = countUnusedGap(changeAddrs);
  if (changeGap < ADDRESS_GAP_LIMIT) {
    const maxChangeIndex = Math.max(-1, ...changeAddrs.map(a => a.index));
    const toGenerate = ADDRESS_GAP_LIMIT - changeGap;

    walletLog(walletId, 'info', 'ADDRESS', `Expanding change addresses (gap: ${changeGap}/${ADDRESS_GAP_LIMIT})`, {
      currentMax: maxChangeIndex,
      generating: toGenerate,
    });

    for (let i = maxChangeIndex + 1; i <= maxChangeIndex + toGenerate; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          { network: wallet.network as 'mainnet' | 'testnet' | 'regtest', change: true }
        );
        newAddresses.push({ address, derivationPath });
      } catch (err) {
        log.error(`Failed to derive change address ${i}`, { error: getErrorMessage(err) });
      }
    }
  }

  // Bulk insert new addresses
  if (newAddresses.length > 0) {
    const addressesToCreate = newAddresses.map(a => ({
      walletId,
      address: a.address,
      derivationPath: a.derivationPath,
      index: parseInt(a.derivationPath.split('/').pop() || '0', 10),
      used: false,
    }));

    await prisma.address.createMany({
      data: addressesToCreate,
      skipDuplicates: true,
    });

    walletLog(walletId, 'info', 'ADDRESS', `Generated ${newAddresses.length} new addresses to maintain gap limit`);
  }

  return newAddresses;
}

/**
 * Count consecutive unused addresses at the end of an address list
 */
function countUnusedGap(addresses: Array<{ index: number; used: boolean }>): number {
  if (addresses.length === 0) return 0;

  // Sort by index descending to count from the end
  const sorted = [...addresses].sort((a, b) => b.index - a.index);

  let gap = 0;
  for (const addr of sorted) {
    if (!addr.used) {
      gap++;
    } else {
      break; // Stop counting when we hit a used address
    }
  }

  return gap;
}
