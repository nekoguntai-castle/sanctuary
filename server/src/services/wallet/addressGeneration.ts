/**
 * Address Generation
 *
 * Address derivation and gap limit management for wallets.
 */

import { db as prisma } from '../../repositories/db';
import * as addressDerivation from '../bitcoin/addressDerivation';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { INITIAL_ADDRESS_COUNT } from '../../constants';
import { hookRegistry, Operations } from '../hooks';
import { InvalidInputError, WalletNotFoundError } from '../../errors';

const log = createLogger('WALLET:SVC_ADDRESS');

/**
 * Generate initial receive and change addresses for a wallet descriptor.
 * Returns address records ready for bulk insert.
 */
export function generateInitialAddresses(
  walletId: string,
  descriptor: string,
  network: 'mainnet' | 'testnet' | 'regtest'
): Array<{ walletId: string; address: string; derivationPath: string; index: number; used: boolean }> {
  const addresses = [];
  for (const change of [false, true]) {
    for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
      const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
        descriptor,
        i,
        { network, change }
      );
      addresses.push({ walletId, address, derivationPath, index: i, used: false });
    }
  }
  return addresses;
}

/**
 * Generate new receiving address for wallet
 */
export async function generateAddress(
  walletId: string,
  userId: string
): Promise<string> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: { some: { userId } },
    },
    include: {
      addresses: {
        orderBy: { index: 'desc' },
        take: 1,
      },
    },
  });

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  // Get next index
  const nextIndex = wallet.addresses.length > 0 ? wallet.addresses[0].index + 1 : 0;

  // Check if wallet has descriptor or xpub
  if (!wallet.descriptor) {
    throw new InvalidInputError(
      'Wallet does not have a descriptor. Cannot derive addresses. ' +
      'Please import wallet with xpub or descriptor.'
    );
  }

  // Derive address from descriptor
  const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
    wallet.descriptor,
    nextIndex,
    {
      network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
      change: false, // External/receive address
    }
  );

  // Save to database
  await prisma.address.create({
    data: {
      walletId,
      address,
      derivationPath,
      index: nextIndex,
      used: false,
    },
  });

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.ADDRESS_GENERATE, { walletId }, {
    userId,
    result: address,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: getErrorMessage(err) }));

  return address;
}
