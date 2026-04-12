/**
 * Mobile Permissions OpenAPI Schemas
 *
 * Schema definitions for user-facing mobile permission routes.
 */

import { MOBILE_ACTIONS } from '../../../../../shared/schemas/mobileApiRequests';

const permissionProperties = MOBILE_ACTIONS.reduce<Record<string, { type: 'boolean' }>>((acc, action) => {
  acc[action] = { type: 'boolean' };
  return acc;
}, {});

export const mobilePermissionSchemas = {
  MobilePermissionMap: {
    type: 'object',
    properties: permissionProperties,
    additionalProperties: false,
  },
  MobilePermissionUpdateRequest: {
    type: 'object',
    properties: permissionProperties,
    additionalProperties: false,
    minProperties: 1,
  },
  MobilePermissionSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string' },
      walletName: { type: 'string' },
      walletNetwork: { type: 'string', enum: ['mainnet', 'testnet', 'regtest', 'signet'] },
      role: { type: 'string', enum: ['viewer', 'signer', 'approver', 'owner'] },
      effectivePermissions: { $ref: '#/components/schemas/MobilePermissionMap' },
      hasCustomRestrictions: { type: 'boolean' },
      hasOwnerRestrictions: { type: 'boolean' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'id',
      'walletId',
      'walletName',
      'walletNetwork',
      'role',
      'effectivePermissions',
      'hasCustomRestrictions',
      'hasOwnerRestrictions',
      'updatedAt',
    ],
  },
  MobilePermissionListResponse: {
    type: 'object',
    properties: {
      permissions: {
        type: 'array',
        items: { $ref: '#/components/schemas/MobilePermissionSummary' },
      },
    },
    required: ['permissions'],
  },
  WalletMobilePermissionsResponse: {
    type: 'object',
    properties: {
      walletId: { type: 'string' },
      userId: { type: 'string' },
      role: { type: 'string', enum: ['viewer', 'signer', 'approver', 'owner'] },
      permissions: { $ref: '#/components/schemas/MobilePermissionMap' },
      hasCustomRestrictions: { type: 'boolean' },
      hasOwnerRestrictions: { type: 'boolean' },
      walletUsers: {
        type: 'array',
        items: { type: 'object' },
        description: 'Owner-only list of wallet users and effective mobile permissions',
      },
    },
    required: ['walletId', 'userId', 'role', 'permissions', 'hasCustomRestrictions', 'hasOwnerRestrictions'],
  },
  MobilePermissionUpdateResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      walletId: { type: 'string' },
      userId: { type: 'string' },
      role: { type: 'string', enum: ['viewer', 'signer', 'approver', 'owner'] },
      permissions: { $ref: '#/components/schemas/MobilePermissionMap' },
      hasCustomRestrictions: { type: 'boolean' },
      hasOwnerRestrictions: { type: 'boolean' },
    },
    required: ['success', 'walletId', 'userId', 'role', 'permissions', 'hasCustomRestrictions', 'hasOwnerRestrictions'],
  },
  MobilePermissionResetResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
} as const;
