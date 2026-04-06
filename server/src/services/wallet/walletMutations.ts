/**
 * Wallet Mutations
 *
 * State-changing operations (update, delete) with cleanup side effects.
 */

import { db as prisma } from '../../repositories/db';
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
  const walletUser = await prisma.walletUser.findFirst({
    where: {
      walletId,
      userId,
      role: 'owner',
    },
  });

  if (!walletUser) {
    throw new ForbiddenError('Only wallet owners can update wallet');
  }

  const wallet = await prisma.wallet.update({
    where: { id: walletId },
    data: updates,
    include: {
      devices: true,
      addresses: true,
      // Don't load UTXOs - use aggregate query instead
      group: {
        select: { name: true },
      },
      users: {
        select: { userId: true },
      },
    },
  });

  // Use aggregate query for balance (efficient for wallets with many UTXOs)
  const balanceResult = await prisma.uTXO.aggregate({
    where: {
      walletId,
      spent: false,
    },
    _sum: { amount: true },
  });
  const balance = Number(balanceResult._sum.amount || 0);

  // Determine if wallet is shared
  const userCount = wallet.users.length;
  const hasGroup = !!wallet.group;
  const isShared = hasGroup || userCount > 1;

  return {
    ...wallet,
    balance,
    deviceCount: wallet.devices.length,
    addressCount: wallet.addresses.length,
    isShared,
    sharedWith: isShared ? {
      groupName: wallet.group?.name || null,
      userCount,
    } : undefined,
  };
}

/**
 * Delete wallet
 */
export async function deleteWallet(walletId: string, userId: string): Promise<void> {
  // Check user has owner role
  const walletUser = await prisma.walletUser.findFirst({
    where: {
      walletId,
      userId,
      role: 'owner',
    },
  });

  if (!walletUser) {
    throw new ForbiddenError('Only wallet owners can delete wallet');
  }

  // Unsubscribe from address notifications to prevent memory leak
  const { getSyncService } = await import('../syncService');
  const syncService = getSyncService();
  await syncService.unsubscribeWalletAddresses(walletId);

  // Also clean up notification service subscriptions
  const { notificationService } = await import('../../websocket/notifications');
  await notificationService.unsubscribeWalletAddresses(walletId);

  await prisma.wallet.delete({
    where: { id: walletId },
  });

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.WALLET_DELETE, { walletId }, {
    userId,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: getErrorMessage(err) }));
}
