/**
 * Transfer OpenAPI Schemas
 *
 * Schema definitions for wallet and device ownership transfers.
 */

import {
  TRANSFER_RESOURCE_TYPES,
  TRANSFER_STATUS_VALUES,
} from '../../../services/transferService/types';

export const transferSchemas = {
  TransferUser: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
    },
    required: ['id', 'username'],
  },
  OwnershipTransfer: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      resourceType: { type: 'string', enum: [...TRANSFER_RESOURCE_TYPES] },
      resourceId: { type: 'string' },
      fromUserId: { type: 'string' },
      toUserId: { type: 'string' },
      status: { type: 'string', enum: [...TRANSFER_STATUS_VALUES] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      acceptedAt: { type: 'string', format: 'date-time', nullable: true },
      confirmedAt: { type: 'string', format: 'date-time', nullable: true },
      cancelledAt: { type: 'string', format: 'date-time', nullable: true },
      expiresAt: { type: 'string', format: 'date-time' },
      message: { type: 'string', nullable: true },
      declineReason: { type: 'string', nullable: true },
      keepExistingUsers: { type: 'boolean' },
      fromUser: { $ref: '#/components/schemas/TransferUser' },
      toUser: { $ref: '#/components/schemas/TransferUser' },
      resourceName: { type: 'string' },
    },
    required: [
      'id',
      'resourceType',
      'resourceId',
      'fromUserId',
      'toUserId',
      'status',
      'createdAt',
      'updatedAt',
      'acceptedAt',
      'confirmedAt',
      'cancelledAt',
      'expiresAt',
      'message',
      'declineReason',
      'keepExistingUsers',
    ],
  },
  TransferCreateRequest: {
    type: 'object',
    properties: {
      resourceType: { type: 'string', enum: [...TRANSFER_RESOURCE_TYPES] },
      resourceId: { type: 'string' },
      toUserId: { type: 'string' },
      message: { type: 'string' },
      keepExistingUsers: { type: 'boolean', default: true },
      expiresInDays: {
        type: 'integer',
        default: 7,
        description: 'Days until the transfer expires; values above 30 are capped by the service.',
      },
    },
    required: ['resourceType', 'resourceId', 'toUserId'],
  },
  TransferListResponse: {
    type: 'object',
    properties: {
      transfers: {
        type: 'array',
        items: { $ref: '#/components/schemas/OwnershipTransfer' },
      },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['transfers', 'total'],
  },
  TransferCountsResponse: {
    type: 'object',
    properties: {
      pendingIncoming: { type: 'integer', minimum: 0 },
      awaitingConfirmation: { type: 'integer', minimum: 0 },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['pendingIncoming', 'awaitingConfirmation', 'total'],
  },
  TransferDeclineRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
    },
  },
} as const;
