/**
 * Address Discovery and Gap Limit Management
 *
 * Handles BIP-44 gap limit expansion to ensure there are always
 * sufficient unused addresses at the end of both receive and change chains.
 */

import { walletRepository, addressRepository } from "../../../repositories";
import { createLogger } from "../../../utils/logger";
import { getErrorMessage } from "../../../utils/errors";
import { walletLog } from "../../../websocket/notifications";
import { ADDRESS_GAP_LIMIT } from "../../../constants";
import * as addressDerivation from "../addressDerivation";
import { parseAddressDerivationPath } from "../../../../../shared/utils/bitcoin";

const log = createLogger("BITCOIN:SVC_ADDR_DISCOVERY");

interface DiscoveredAddressRecord {
  derivationPath: string | null;
  index: number;
  used: boolean;
}

interface ChainGapAddress {
  index: number;
  used: boolean;
}

interface ChainGapGroups {
  receive: ChainGapAddress[];
  change: ChainGapAddress[];
  skipped: number;
}

function groupAddressesByChain(
  addresses: DiscoveredAddressRecord[],
): ChainGapGroups {
  const groups: ChainGapGroups = { receive: [], change: [], skipped: 0 };

  for (const address of addresses) {
    const parsed = parseAddressDerivationPath(address.derivationPath);
    if (!parsed) {
      groups.skipped++;
      continue;
    }
    groups[parsed.chain].push({
      index: parsed.addressIndex,
      used: address.used,
    });
  }

  return groups;
}

function logSkippedAddressPaths(walletId: string, skipped: number): void {
  if (skipped === 0) return;
  log.warn(
    "Skipped addresses with unparseable derivation paths during gap limit check",
    {
      walletId,
      skipped,
    },
  );
}

function toAddressCreateRecord(
  walletId: string,
  address: { address: string; derivationPath: string },
) {
  const parsed = parseAddressDerivationPath(address.derivationPath);
  if (!parsed) {
    log.warn("Skipping generated address with unparseable derivation path", {
      walletId,
      derivationPath: address.derivationPath,
    });
    return null;
  }

  return {
    walletId,
    address: address.address,
    derivationPath: address.derivationPath,
    index: parsed.addressIndex,
    used: false,
  };
}

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
export async function ensureGapLimit(
  walletId: string,
): Promise<Array<{ address: string; derivationPath: string }>> {
  const wallet = await walletRepository.findByIdWithSelect(walletId, {
    id: true,
    descriptor: true,
    network: true,
  });

  if (!wallet?.descriptor) {
    log.debug(`Wallet ${walletId} has no descriptor, skipping gap limit check`);
    return [];
  }

  // Get all addresses with their used status
  const addresses = await addressRepository.findByWalletId(walletId);

  const chainGroups = groupAddressesByChain(addresses);
  logSkippedAddressPaths(walletId, chainGroups.skipped);
  const receiveAddrs = chainGroups.receive;
  const changeAddrs = chainGroups.change;

  const newAddresses: Array<{ address: string; derivationPath: string }> = [];

  // Check receive addresses gap limit
  const receiveGap = countUnusedGap(receiveAddrs);
  if (receiveGap < ADDRESS_GAP_LIMIT) {
    const maxReceiveIndex = Math.max(-1, ...receiveAddrs.map((a) => a.index));
    const toGenerate = ADDRESS_GAP_LIMIT - receiveGap;

    walletLog(
      walletId,
      "info",
      "ADDRESS",
      `Expanding receive addresses (gap: ${receiveGap}/${ADDRESS_GAP_LIMIT})`,
      {
        currentMax: maxReceiveIndex,
        generating: toGenerate,
      },
    );

    for (let i = maxReceiveIndex + 1; i <= maxReceiveIndex + toGenerate; i++) {
      try {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(wallet.descriptor, i, {
            network: wallet.network as "mainnet" | "testnet" | "regtest",
            change: false,
          });
        newAddresses.push({ address, derivationPath });
      } catch (err) {
        log.error(`Failed to derive receive address ${i}`, {
          error: getErrorMessage(err),
        });
      }
    }
  }

  // Check change addresses gap limit
  const changeGap = countUnusedGap(changeAddrs);
  if (changeGap < ADDRESS_GAP_LIMIT) {
    const maxChangeIndex = Math.max(-1, ...changeAddrs.map((a) => a.index));
    const toGenerate = ADDRESS_GAP_LIMIT - changeGap;

    walletLog(
      walletId,
      "info",
      "ADDRESS",
      `Expanding change addresses (gap: ${changeGap}/${ADDRESS_GAP_LIMIT})`,
      {
        currentMax: maxChangeIndex,
        generating: toGenerate,
      },
    );

    for (let i = maxChangeIndex + 1; i <= maxChangeIndex + toGenerate; i++) {
      try {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(wallet.descriptor, i, {
            network: wallet.network as "mainnet" | "testnet" | "regtest",
            change: true,
          });
        newAddresses.push({ address, derivationPath });
      } catch (err) {
        log.error(`Failed to derive change address ${i}`, {
          error: getErrorMessage(err),
        });
      }
    }
  }

  // Bulk insert new addresses
  let addressesToScan = newAddresses;
  if (newAddresses.length > 0) {
    const addressesToCreate = newAddresses.flatMap((address) => {
      const record = toAddressCreateRecord(walletId, address);
      return record ? [record] : [];
    });

    if (addressesToCreate.length > 0) {
      await addressRepository.createMany(addressesToCreate, {
        skipDuplicates: true,
      });
    }

    addressesToScan = addressesToCreate.map(({ address, derivationPath }) => ({
      address,
      derivationPath,
    }));
    walletLog(
      walletId,
      "info",
      "ADDRESS",
      `Generated ${addressesToCreate.length} new addresses to maintain gap limit`,
    );
  }

  return addressesToScan;
}

/**
 * Count consecutive unused addresses at the end of an address list
 */
function countUnusedGap(
  addresses: Array<{ index: number; used: boolean }>,
): number {
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
