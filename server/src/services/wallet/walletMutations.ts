/**
 * Wallet Mutations
 *
 * State-changing operations (update, delete) with cleanup side effects.
 */

import { walletRepository, utxoRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { hookRegistry, Operations } from '../hooks';
import { ForbiddenError } from '../../errors';
import type { WalletWithBalance } from './types';

const log = createLogger('WALLET:SVC');

/**
 * Update wallet
 */
export async function updateWallet(
  walletId: string,
  userId: string,
  updates: Partial<{ name: string; descriptor: string }>
): Promise<WalletWithBalance> {
  // Check user has owner role
  const hasEditAccess = await walletRepository.findByIdWithEditAccess(walletId, userId);

  if (!hasEditAccess) {
    throw new ForbiddenError('Only wallet owners can update wallet');
  }

  const wallet = await walletRepository.update(walletId, updates);

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

  // Use aggregate query for balance (efficient for wallets with many UTXOs)
  const balanceBigint = await utxoRepository.getUnspentBalance(walletId);
  const balance = Number(balanceBigint);

  // Determine if wallet is shared
  const userCount = walletFull.users.length;
  const hasGroup = !!walletFull.group;
  const isShared = hasGroup || userCount > 1;

  return {
    ...walletFull,
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
  const hasEditAccess = await walletRepository.findByIdWithEditAccess(walletId, userId);

  if (!hasEditAccess) {
    throw new ForbiddenError('Only wallet owners can delete wallet');
  }

  // Unsubscribe from address notifications to prevent memory leak
  const { getSyncService } = await import('../syncService');
  const syncService = getSyncService();
  await syncService.unsubscribeWalletAddresses(walletId);

  // Also clean up notification service subscriptions
  const { notificationService } = await import('../../websocket/notifications');
  await notificationService.unsubscribeWalletAddresses(walletId);

  await walletRepository.deleteById(walletId);

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.WALLET_DELETE, { walletId }, {
    userId,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: getErrorMessage(err) }));
}
