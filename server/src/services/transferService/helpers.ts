/**
 * Transfer Helpers
 *
 * Utility functions shared across transfer operations:
 * expiry calculation, ownership checks, resource name lookup, formatting.
 */

import { deviceRepository, transferRepository, walletRepository } from '../../repositories';
import type { ResourceType, Transfer, TransferWithUsers } from './types';
import type { PrismaTx } from './types';

export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_EXPIRY_DAYS = 30;

/**
 * Calculate expiry date from now
 */
export function calculateExpiryDate(days: number = DEFAULT_EXPIRY_DAYS): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + Math.min(days, MAX_EXPIRY_DAYS));
  return expiry;
}

/**
 * Check if a transfer has expired
 */
export function isExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Get resource name for display
 */
export async function getResourceName(resourceType: ResourceType, resourceId: string): Promise<string> {
  if (resourceType === 'wallet') {
    const name = await walletRepository.getName(resourceId);
    return name || 'Unknown Wallet';
  } else {
    const device = await deviceRepository.findById(resourceId);
    return device?.label || 'Unknown Device';
  }
}

/**
 * Check effective ownership for a transfer target.
 * Group-derived ownership counts here because transferring to an existing
 * effective owner would not change that user's access.
 */
export async function checkResourceOwnership(
  resourceType: ResourceType,
  resourceId: string,
  userId: string,
  tx: PrismaTx,
): Promise<boolean> {
  return transferRepository.isEffectiveResourceOwner(resourceType, resourceId, userId, tx);
}

/**
 * Format transfer for response (include user info and resource name)
 */
export async function formatTransfer(transfer: TransferWithUsers): Promise<Transfer> {
  const resourceType = transfer.resourceType as ResourceType;
  const resourceName = await getResourceName(resourceType, transfer.resourceId);
  return {
    ...transfer,
    resourceType,
    status: transfer.status as Transfer['status'],
    resourceName,
    fromUser: transfer.fromUser ? {
      id: transfer.fromUser.id,
      username: transfer.fromUser.username,
    } : undefined,
    toUser: transfer.toUser ? {
      id: transfer.toUser.id,
      username: transfer.toUser.username,
    } : undefined,
  };
}
