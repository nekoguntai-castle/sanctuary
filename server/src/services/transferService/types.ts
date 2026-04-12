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

export const TRANSFER_STATUS_VALUES = ['pending', 'accepted', 'confirmed', 'cancelled', 'declined', 'expired'] as const;
export const TRANSFER_RESOURCE_TYPES = ['wallet', 'device'] as const;
export const TRANSFER_ROLE_FILTER_VALUES = ['initiator', 'recipient', 'all'] as const;
export const TRANSFER_STATUS_FILTER_VALUES = [...TRANSFER_STATUS_VALUES, 'active', 'all'] as const;

export type TransferStatus = (typeof TRANSFER_STATUS_VALUES)[number];
export type ResourceType = (typeof TRANSFER_RESOURCE_TYPES)[number];
export type TransferRoleFilter = (typeof TRANSFER_ROLE_FILTER_VALUES)[number];

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
  role?: TransferRoleFilter;
  status?: TransferStatus | 'active' | 'all';
  resourceType?: ResourceType;
}
