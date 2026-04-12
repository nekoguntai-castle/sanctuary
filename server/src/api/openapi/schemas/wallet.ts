/**
 * Wallet OpenAPI Schemas
 *
 * Schema definitions for wallet management.
 */

import {
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
} from '../../../services/wallet/types';
import {
  WALLET_IMPORT_FORMAT_VALUES,
  WALLET_IMPORT_NETWORK_VALUES,
  WALLET_IMPORT_SCRIPT_TYPE_VALUES,
  WALLET_IMPORT_WALLET_TYPE_VALUES,
} from '../../../services/walletImport/types';

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
  WalletImportFormat: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      extensions: {
        type: 'array',
        items: { type: 'string' },
      },
      priority: { type: 'integer' },
    },
    required: ['id', 'name', 'description', 'extensions', 'priority'],
  },
  WalletImportFormatsResponse: {
    type: 'object',
    properties: {
      formats: {
        type: 'array',
        items: { $ref: '#/components/schemas/WalletImportFormat' },
      },
    },
    required: ['formats'],
  },
  WalletImportValidateRequest: {
    type: 'object',
    properties: {
      descriptor: { type: 'string' },
      json: {
        oneOf: [
          { type: 'string' },
          { type: 'object', additionalProperties: true },
        ],
      },
    },
    minProperties: 1,
    additionalProperties: false,
  },
  WalletImportDeviceResolution: {
    type: 'object',
    properties: {
      fingerprint: { type: 'string' },
      xpub: { type: 'string' },
      derivationPath: { type: 'string' },
      existingDeviceId: { type: 'string', nullable: true },
      existingDeviceLabel: { type: 'string', nullable: true },
      willCreate: { type: 'boolean' },
      suggestedLabel: { type: 'string' },
      originalType: { type: 'string' },
    },
    required: [
      'fingerprint',
      'xpub',
      'derivationPath',
      'existingDeviceId',
      'existingDeviceLabel',
      'willCreate',
    ],
  },
  WalletImportValidationResponse: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' },
      error: { type: 'string' },
      format: { type: 'string', enum: [...WALLET_IMPORT_FORMAT_VALUES] },
      walletType: { type: 'string', enum: [...WALLET_IMPORT_WALLET_TYPE_VALUES] },
      scriptType: { type: 'string', enum: [...WALLET_IMPORT_SCRIPT_TYPE_VALUES] },
      network: { type: 'string', enum: [...WALLET_IMPORT_NETWORK_VALUES] },
      quorum: { type: 'integer' },
      totalSigners: { type: 'integer' },
      devices: {
        type: 'array',
        items: { $ref: '#/components/schemas/WalletImportDeviceResolution' },
      },
      suggestedName: { type: 'string' },
    },
    required: ['valid', 'format', 'walletType', 'scriptType', 'network', 'devices'],
  },
  WalletImportRequest: {
    type: 'object',
    properties: {
      data: { type: 'string' },
      name: { type: 'string', minLength: 1 },
      network: { type: 'string', enum: [...WALLET_IMPORT_NETWORK_VALUES] },
      deviceLabels: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['data', 'name'],
    additionalProperties: false,
  },
  ImportedWalletSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string', enum: [...WALLET_IMPORT_WALLET_TYPE_VALUES] },
      scriptType: { type: 'string', enum: [...WALLET_IMPORT_SCRIPT_TYPE_VALUES] },
      network: { type: 'string', enum: [...WALLET_IMPORT_NETWORK_VALUES] },
      quorum: { type: 'integer', nullable: true },
      totalSigners: { type: 'integer', nullable: true },
      descriptor: { type: 'string', nullable: true },
    },
    required: ['id', 'name', 'type', 'scriptType', 'network'],
  },
  WalletImportResponse: {
    type: 'object',
    properties: {
      wallet: { $ref: '#/components/schemas/ImportedWalletSummary' },
      devicesCreated: { type: 'integer', minimum: 0 },
      devicesReused: { type: 'integer', minimum: 0 },
      createdDeviceIds: {
        type: 'array',
        items: { type: 'string' },
      },
      reusedDeviceIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['wallet', 'devicesCreated', 'devicesReused', 'createdDeviceIds', 'reusedDeviceIds'],
  },
  ValidateXpubRequest: {
    type: 'object',
    properties: {
      xpub: { type: 'string' },
      scriptType: { type: 'string', enum: [...WALLET_IMPORT_SCRIPT_TYPE_VALUES] },
      network: { type: 'string', enum: [...WALLET_IMPORT_NETWORK_VALUES], default: 'mainnet' },
      fingerprint: { type: 'string' },
      accountPath: { type: 'string' },
    },
    required: ['xpub'],
    additionalProperties: false,
  },
  ValidateXpubResponse: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' },
      descriptor: { type: 'string' },
      scriptType: { type: 'string', enum: [...WALLET_IMPORT_SCRIPT_TYPE_VALUES] },
      firstAddress: { type: 'string' },
      xpub: { type: 'string' },
      fingerprint: { type: 'string' },
      accountPath: { type: 'string' },
    },
    required: ['valid', 'descriptor', 'scriptType', 'firstAddress', 'xpub', 'fingerprint', 'accountPath'],
  },
} as const;
