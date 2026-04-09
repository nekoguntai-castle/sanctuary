/**
 * Ownership Transfer Types
 *
 * Shared interfaces and type definitions for the transfer service module.
 */

import type { OwnershipTransfer } from '../../generated/prisma/client';
export type { PrismaTxClient as PrismaTx } from '../../models/prisma';

/** OwnershipTransfer with user relations */
export type TransferWithUsers = OwnershipTransfer & {
  fromUser?: { id: string; username: string } | null;
  toUser?: { id: string; username: string } | null;
};

export type TransferStatus = 'pending' | 'accepted' | 'confirmed' | 'cancelled' | 'declined' | 'expired';
export type ResourceType = 'wallet' | 'device';

export interface Transfer {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  fromUserId: string;
  toUserId: string;
  status: TransferStatus;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date;
  message: string | null;
  declineReason: string | null;
  keepExistingUsers: boolean;
  fromUser?: { id: string; username: string };
  toUser?: { id: string; username: string };
  resourceName?: string;
}

export interface InitiateTransferInput {
  resourceType: ResourceType;
  resourceId: string;
  toUserId: string;
  message?: string;
  keepExistingUsers?: boolean;
  expiresInDays?: number;
}

export interface TransferFilters {
  role?: 'initiator' | 'recipient' | 'all';
  status?: TransferStatus | 'active' | 'all';
  resourceType?: ResourceType;
}
