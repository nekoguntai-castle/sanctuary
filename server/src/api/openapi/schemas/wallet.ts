/**
 * Wallet OpenAPI Schemas
 *
 * Schema definitions for wallet management.
 */

import {
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
} from '../../../services/wallet/types';

export const walletSchemas = {
  Wallet: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string', enum: ['single_sig', 'multi_sig'] },
      scriptType: { type: 'string', enum: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] },
      network: { type: 'string', enum: ['mainnet', 'testnet', 'regtest', 'signet'] },
      quorum: { type: 'integer', nullable: true },
      totalSigners: { type: 'integer', nullable: true },
      descriptor: { type: 'string', nullable: true },
      balance: { type: 'string', description: 'Balance in satoshis as string' },
      unconfirmedBalance: { type: 'string', description: 'Unconfirmed balance in satoshis' },
      lastSynced: { type: 'string', format: 'date-time', nullable: true },
      syncStatus: { type: 'string', enum: ['synced', 'syncing', 'error', 'pending', 'never'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      role: { type: 'string', enum: [...WALLET_ROLE_VALUES] },
      deviceCount: { type: 'integer' },
      isShared: { type: 'boolean' },
      pendingConsolidation: { type: 'boolean' },
      pendingReceive: { type: 'boolean' },
      pendingSend: { type: 'boolean' },
      hasPendingDraft: { type: 'boolean' },
      group: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
    required: ['id', 'name', 'type', 'scriptType', 'network', 'balance', 'createdAt'],
  },
  CreateWalletRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      type: { type: 'string', enum: ['single_sig', 'multi_sig'] },
      scriptType: { type: 'string', enum: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] },
      network: { type: 'string', enum: ['mainnet', 'testnet', 'regtest', 'signet'] },
      quorum: { type: 'integer' },
      totalSigners: { type: 'integer' },
      descriptor: { type: 'string' },
      fingerprint: { type: 'string' },
      groupId: { type: 'string' },
      deviceIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'type', 'scriptType'],
  },
  UpdateWalletRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      descriptor: { type: 'string' },
    },
  },
  WalletStats: {
    type: 'object',
    properties: {
      balance: { type: 'number' },
      received: { type: 'number' },
      sent: { type: 'number' },
      transactionCount: { type: 'integer' },
      utxoCount: { type: 'integer' },
      addressCount: { type: 'integer' },
    },
    required: ['balance', 'received', 'sent', 'transactionCount', 'utxoCount', 'addressCount'],
  },
  WalletShareRole: {
    type: 'string',
    enum: [...WALLET_SHARE_ROLE_VALUES],
  },
  WalletShareGroupRequest: {
    type: 'object',
    properties: {
      groupId: { type: 'string', nullable: true },
      role: { $ref: '#/components/schemas/WalletShareRole' },
    },
    additionalProperties: false,
  },
  WalletShareUserRequest: {
    type: 'object',
    properties: {
      targetUserId: { type: 'string' },
      role: { $ref: '#/components/schemas/WalletShareRole' },
    },
    required: ['targetUserId'],
    additionalProperties: false,
  },
  WalletShareDeviceSuggestion: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      fingerprint: { type: 'string' },
    },
    required: ['id', 'label', 'fingerprint'],
  },
  WalletShareGroupResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      groupId: { type: 'string', nullable: true },
      groupName: { type: 'string', nullable: true },
      groupRole: { $ref: '#/components/schemas/WalletShareRole' },
    },
    required: ['success', 'groupId', 'groupName', 'groupRole'],
  },
  WalletShareUserResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      devicesToShare: {
        type: 'array',
        items: { $ref: '#/components/schemas/WalletShareDeviceSuggestion' },
      },
    },
    required: ['success', 'message'],
  },
  WalletSharedGroup: {
    type: 'object',
    nullable: true,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      role: { $ref: '#/components/schemas/WalletShareRole' },
    },
    required: ['id', 'name', 'role'],
  },
  WalletSharedUser: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
      role: { type: 'string', enum: [...WALLET_ROLE_VALUES] },
    },
    required: ['id', 'username', 'role'],
  },
  WalletSharingInfo: {
    type: 'object',
    properties: {
      group: { $ref: '#/components/schemas/WalletSharedGroup' },
      users: {
        type: 'array',
        items: { $ref: '#/components/schemas/WalletSharedUser' },
      },
    },
    required: ['group', 'users'],
  },
} as const;
