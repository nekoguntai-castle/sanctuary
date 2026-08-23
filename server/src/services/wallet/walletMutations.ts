/**
 * Wallet Mutations
 *
 * State-changing operations (update, delete) with cleanup side effects.
 */

import { walletRepository, utxoRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { hookRegistry, Operations } from '../hooks';
import { ForbiddenError, InvalidInputError } from '../../errors';
import type { WalletWithBalance } from './types';
import { checkWalletOwnerAccess } from '../accessControl';
import { assertWalletHardwareCapabilityById } from '../hardwareWalletCapabilities';

const log = createLogger('WALLET:SVC');

interface WalletMetadataUpdate {
  name: string;
}

function assertWalletMetadataUpdate(updates: WalletMetadataUpdate): void {
  const unsupportedFields = Object.keys(updates).filter(field => field !== 'name');
  if (unsupportedFields.length > 0) {
    throw new InvalidInputError(
      `Unsupported wallet update field${unsupportedFields.length === 1 ? '' : 's'}: ${unsupportedFields.join(', ')}`,
    );
  }
  if (typeof updates.name !== 'string' || updates.name.length === 0) {
    throw new InvalidInputError('Wallet name is required', 'name');
  }
}

/**
 * Update wallet
 */
export async function updateWallet(
  walletId: string,
  userId: string,
  updates: WalletMetadataUpdate
): Promise<WalletWithBalance> {
  // Check user has owner role
  const hasOwnerAccess = await checkWalletOwnerAccess(walletId, userId);

  if (!hasOwnerAccess) {
    throw new ForbiddenError('Only wallet owners can update wallet');
  }

  // Descriptor identity is immutable here: changing it without replacing every
  // derived address would silently corrupt wallet ownership and change tracking.
  assertWalletMetadataUpdate(updates);

  await walletRepository.update(walletId, { name: updates.name });

  // Re-fetch with includes
  const walletFull = await walletRepository.findByIdWithFullAccess(walletId, userId, {
    devices: true,
    addresses: true,
    group: { select: { name: true } },
    users: { select: { userId: true } },
  });

  /* v8 ignore next -- owner-access guard is covered at wallet route boundary */
  if (!walletFull) {
    throw new ForbiddenError('Only wallet owners can update wallet');
  }

  let responseWallet = walletFull;
  try {
    await assertWalletHardwareCapabilityById(walletId, 'display');
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    responseWallet = {
      ...walletFull,
      addresses: [],
      descriptor: null,
      fingerprint: null,
    };
  }

  // Use aggregate query for balance (efficient for wallets with many UTXOs)
  const balanceBigint = await utxoRepository.getUnspentBalance(walletId);
  const balance = Number(balanceBigint);

  // Determine if wallet is shared
  const userCount = walletFull.users.length;
  const hasGroup = !!walletFull.group;
  const isShared = hasGroup || userCount > 1;

  return {
    ...responseWallet,
    balance,
    deviceCount: walletFull.devices.length,
    addressCount: walletFull.addresses.length,
    isShared,
    sharedWith: isShared ? {
      groupName: walletFull.group?.name || null,
      userCount,
    } : undefined,
  };
}

/**
 * Delete wallet
 */
export async function deleteWallet(walletId: string, userId: string): Promise<void> {
  // Check user has owner role
  const hasOwnerAccess = await checkWalletOwnerAccess(walletId, userId);

  if (!hasOwnerAccess) {
    throw new ForbiddenError('Only wallet owners can delete wallet');
  }

  await walletRepository.deleteById(walletId);

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.WALLET_DELETE, { walletId }, {
    userId,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: getErrorMessage(err) }));
}
