/**
 * Transfer Queries
 *
 * Read-only query functions for retrieving transfer data.
 */

import { transferRepository } from '../../repositories';
import { formatTransfer } from './helpers';
import type { Transfer, TransferFilters, ResourceType } from './types';

/**
 * Get transfers for a user
 */
export async function getUserTransfers(
  userId: string,
  filters: TransferFilters = {}
): Promise<{ transfers: Transfer[]; total: number }> {
  const repoFilters = {
    role: filters.role,
    /* v8 ignore start -- "all" status is a UI convenience normalized before repository call */
    status: filters.status === 'all' ? undefined : filters.status,
    /* v8 ignore stop */
    resourceType: filters.resourceType,
  };

  const [transfers, total] = await Promise.all([
    transferRepository.findByUser(userId, repoFilters),
    transferRepository.countByUser(userId, repoFilters),
  ]);

  // Format all transfers
  const formatted = await Promise.all(transfers.map(formatTransfer));

  return { transfers: formatted, total };
}

/**
 * Get a single transfer by ID
 */
export async function getTransfer(transferId: string): Promise<Transfer | null> {
  const transfer = await transferRepository.findByIdWithUsers(transferId);

  if (!transfer) {
    return null;
  }

  return formatTransfer(transfer);
}

/**
 * Check if resource has an active transfer
 */
export async function hasActiveTransfer(
  resourceType: ResourceType,
  resourceId: string
): Promise<boolean> {
  return transferRepository.hasActiveTransfer(resourceType, resourceId);
}

/**
 * Get pending incoming transfers count for a user
 */
export async function getPendingIncomingCount(userId: string): Promise<number> {
  return transferRepository.getPendingIncomingCount(userId);
}

/**
 * Get transfers requiring owner confirmation
 */
export async function getAwaitingConfirmationCount(userId: string): Promise<number> {
  return transferRepository.getAwaitingConfirmationCount(userId);
}
