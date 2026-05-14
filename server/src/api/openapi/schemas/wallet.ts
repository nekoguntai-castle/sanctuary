/**
 * Wallet OpenAPI Schemas
 *
 * Schema definitions for wallet management.
 */

import {
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
} from '../../../services/wallet/types';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import {
  WALLET_IMPORT_FORMAT_VALUES,
  WALLET_IMPORT_NETWORK_VALUES,
  WALLET_IMPORT_SCRIPT_TYPE_VALUES,
  WALLET_IMPORT_WALLET_TYPE_VALUES,
} from '../../../services/walletImport/types';
import { WALLET_EXPORT_FORMAT_VALUES } from '../../../services/export/types';
import { DEFAULT_AUTOPILOT_SETTINGS } from '../../../services/autopilot/types';
import {
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
  VALID_SOURCE_TYPES,
  VALID_VOTE_DECISIONS,
} from '../../../services/vaultPolicy/types';

const WALLET_NETWORK_VALUES = BITCOIN_NETWORKS;

export const walletSchemas = {
  Wallet: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string', enum: ['single_sig', 'multi_sig'] },
      scriptType: { type: 'string', enum: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] },
      network: { type: 'string', enum: [...WALLET_NETWORK_VALUES] },
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
      network: { type: 'string', enum: [...WALLET_NETWORK_VALUES] },
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
  WalletBalanceHistoryPoint: {
    type: 'object',
    properties: {
      timestamp: { type: 'string' },
      balance: { type: 'number' },
    },
    required: ['timestamp', 'balance'],
  },
  WalletBalanceHistoryResponse: {
    type: 'object',
    properties: {
      timeframe: { type: 'string' },
      currentBalance: { type: 'number' },
      dataPoints: {
        type: 'array',
        items: { $ref: '#/components/schemas/WalletBalanceHistoryPoint' },
      },
    },
    required: ['timeframe', 'currentBalance', 'dataPoints'],
  },
  WalletGeneratedAddressResponse: {
    type: 'object',
    properties: {
      address: { type: 'string' },
    },
    required: ['address'],
  },
  WalletAddDeviceRequest: {
    type: 'object',
    properties: {
      deviceId: { type: 'string' },
      signerIndex: { type: 'integer', minimum: 0 },
    },
    required: ['deviceId'],
    additionalProperties: false,
  },
  WalletMessageResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  WalletRepairResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  WalletExportFormat: {
    type: 'object',
    properties: {
      id: { type: 'string', enum: [...WALLET_EXPORT_FORMAT_VALUES] },
      name: { type: 'string' },
      description: { type: 'string' },
      extension: { type: 'string' },
      mimeType: { type: 'string' },
    },
    required: ['id', 'name', 'description', 'extension', 'mimeType'],
  },
  WalletExportFormatsResponse: {
    type: 'object',
    properties: {
      formats: {
        type: 'array',
        items: { $ref: '#/components/schemas/WalletExportFormat' },
      },
    },
    required: ['formats'],
  },
  WalletTelegramSettings: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: false },
      notifyReceived: { type: 'boolean', default: true },
      notifySent: { type: 'boolean', default: true },
      notifyConsolidation: { type: 'boolean', default: true },
      notifyDraft: { type: 'boolean', default: true },
    },
    required: ['enabled', 'notifyReceived', 'notifySent', 'notifyConsolidation', 'notifyDraft'],
  },
  WalletTelegramSettingsResponse: {
    type: 'object',
    properties: {
      settings: { $ref: '#/components/schemas/WalletTelegramSettings' },
    },
    required: ['settings'],
  },
  UpdateWalletTelegramSettingsRequest: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      notifyReceived: { type: 'boolean' },
      notifySent: { type: 'boolean' },
      notifyConsolidation: { type: 'boolean' },
      notifyDraft: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  WalletSettingsUpdateResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  WalletAutopilotSettings: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: DEFAULT_AUTOPILOT_SETTINGS.enabled },
      maxFeeRate: { type: 'number', minimum: 0, default: DEFAULT_AUTOPILOT_SETTINGS.maxFeeRate },
      minUtxoCount: { type: 'integer', minimum: 0, default: DEFAULT_AUTOPILOT_SETTINGS.minUtxoCount },
      dustThreshold: { type: 'integer', minimum: 0, default: DEFAULT_AUTOPILOT_SETTINGS.dustThreshold },
      cooldownHours: { type: 'integer', minimum: 0, default: DEFAULT_AUTOPILOT_SETTINGS.cooldownHours },
      notifyTelegram: { type: 'boolean', default: DEFAULT_AUTOPILOT_SETTINGS.notifyTelegram },
      notifyPush: { type: 'boolean', default: DEFAULT_AUTOPILOT_SETTINGS.notifyPush },
      minDustCount: { type: 'integer', minimum: 0, default: DEFAULT_AUTOPILOT_SETTINGS.minDustCount },
      maxUtxoSize: { type: 'integer', minimum: 0, default: DEFAULT_AUTOPILOT_SETTINGS.maxUtxoSize },
    },
    required: [
      'enabled',
      'maxFeeRate',
      'minUtxoCount',
      'dustThreshold',
      'cooldownHours',
      'notifyTelegram',
      'notifyPush',
      'minDustCount',
      'maxUtxoSize',
    ],
  },
  WalletAutopilotSettingsResponse: {
    type: 'object',
    properties: {
      settings: { $ref: '#/components/schemas/WalletAutopilotSettings' },
    },
    required: ['settings'],
  },
  UpdateWalletAutopilotSettingsRequest: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      maxFeeRate: { type: 'number', minimum: 0 },
      minUtxoCount: { type: 'integer', minimum: 0 },
      dustThreshold: { type: 'integer', minimum: 0 },
      cooldownHours: { type: 'integer', minimum: 0 },
      notifyTelegram: { type: 'boolean' },
      notifyPush: { type: 'boolean' },
      minDustCount: { type: 'integer', minimum: 0 },
      maxUtxoSize: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  WalletAutopilotUtxoHealth: {
    type: 'object',
    properties: {
      totalUtxos: { type: 'integer', minimum: 0 },
      dustCount: { type: 'integer', minimum: 0 },
      dustValue: { type: 'string', description: 'Satoshis serialized as a string' },
      totalValue: { type: 'string', description: 'Satoshis serialized as a string' },
      avgUtxoSize: { type: 'string', description: 'Satoshis serialized as a string' },
      smallestUtxo: { type: 'string', description: 'Satoshis serialized as a string' },
      largestUtxo: { type: 'string', description: 'Satoshis serialized as a string' },
      consolidationCandidates: { type: 'integer', minimum: 0 },
    },
    required: [
      'totalUtxos',
      'dustCount',
      'dustValue',
      'totalValue',
      'avgUtxoSize',
      'smallestUtxo',
      'largestUtxo',
      'consolidationCandidates',
    ],
  },
  WalletAutopilotFeeSnapshot: {
    type: 'object',
    properties: {
      timestamp: { type: 'number' },
      fastest: { type: 'number' },
      halfHour: { type: 'number' },
      hour: { type: 'number' },
      economy: { type: 'number' },
      minimum: { type: 'number' },
    },
    required: ['timestamp', 'fastest', 'halfHour', 'hour', 'economy', 'minimum'],
  },
  WalletAutopilotStatusResponse: {
    type: 'object',
    properties: {
      utxoHealth: { $ref: '#/components/schemas/WalletAutopilotUtxoHealth' },
      feeSnapshot: { $ref: '#/components/schemas/WalletAutopilotFeeSnapshot' },
      settings: { $ref: '#/components/schemas/WalletAutopilotSettings' },
    },
    required: ['utxoHealth', 'feeSnapshot', 'settings'],
  },
  VaultPolicy: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string', nullable: true },
      groupId: { type: 'string', nullable: true },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      type: { type: 'string', enum: [...VALID_POLICY_TYPES] },
      config: { type: 'object', additionalProperties: true },
      priority: { type: 'integer' },
      enforcement: { type: 'string', enum: [...VALID_ENFORCEMENT_MODES] },
      enabled: { type: 'boolean' },
      sourceType: { type: 'string', enum: [...VALID_SOURCE_TYPES] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'type', 'config', 'priority', 'enforcement', 'enabled'],
  },
  VaultPolicyListResponse: {
    type: 'object',
    properties: {
      policies: {
        type: 'array',
        items: { $ref: '#/components/schemas/VaultPolicy' },
      },
    },
    required: ['policies'],
  },
  VaultPolicyResponse: {
    type: 'object',
    properties: {
      policy: { $ref: '#/components/schemas/VaultPolicy' },
    },
    required: ['policy'],
  },
  CreateVaultPolicyRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      type: { type: 'string', enum: [...VALID_POLICY_TYPES] },
      config: { type: 'object', additionalProperties: true },
      priority: { type: 'integer' },
      enforcement: { type: 'string', enum: [...VALID_ENFORCEMENT_MODES] },
      enabled: { type: 'boolean' },
    },
    required: ['name', 'type', 'config'],
    additionalProperties: false,
  },
  UpdateVaultPolicyRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      config: { type: 'object', additionalProperties: true },
      priority: { type: 'integer' },
      enforcement: { type: 'string', enum: [...VALID_ENFORCEMENT_MODES] },
      enabled: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  PolicyEvaluationOutput: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: { type: 'number' },
    },
    required: ['address', 'amount'],
  },
  PolicyEvaluationRequest: {
    type: 'object',
    properties: {
      recipient: { type: 'string' },
      amount: {
        oneOf: [
          { type: 'integer', minimum: 0 },
          { type: 'string', pattern: '^\\d+$' },
        ],
      },
      outputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/PolicyEvaluationOutput' },
      },
    },
    required: ['recipient', 'amount'],
    additionalProperties: false,
  },
  PolicyEvaluationResponse: {
    type: 'object',
    properties: {
      allowed: { type: 'boolean' },
      triggered: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            policyId: { type: 'string' },
            policyName: { type: 'string' },
            type: { type: 'string', enum: [...VALID_POLICY_TYPES] },
            action: { type: 'string', enum: ['approval_required', 'blocked', 'monitored'] },
            reason: { type: 'string' },
          },
          required: ['policyId', 'policyName', 'type', 'action', 'reason'],
        },
      },
      limits: { type: 'object', additionalProperties: true },
    },
    required: ['allowed', 'triggered'],
  },
  PolicyEventsResponse: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['events', 'total'],
  },
  PolicyAddress: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      policyId: { type: 'string' },
      address: { type: 'string' },
      label: { type: 'string', nullable: true },
      listType: { type: 'string', enum: ['allow', 'deny'] },
      addedBy: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'policyId', 'address', 'listType'],
  },
  PolicyAddressListResponse: {
    type: 'object',
    properties: {
      addresses: {
        type: 'array',
        items: { $ref: '#/components/schemas/PolicyAddress' },
      },
    },
    required: ['addresses'],
  },
  PolicyAddressResponse: {
    type: 'object',
    properties: {
      address: { $ref: '#/components/schemas/PolicyAddress' },
    },
    required: ['address'],
  },
  CreatePolicyAddressRequest: {
    type: 'object',
    properties: {
      address: { type: 'string', maxLength: 100 },
      label: { type: 'string' },
      listType: { type: 'string', enum: ['allow', 'deny'] },
    },
    required: ['address', 'listType'],
    additionalProperties: false,
  },
  WalletPolicyDeleteResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
    },
    required: ['success'],
  },
  WalletApprovalsResponse: {
    type: 'object',
    properties: {
      approvals: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
    },
    required: ['approvals'],
  },
  PendingApproval: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      draftTransactionId: { type: 'string' },
      walletId: { type: 'string' },
      status: { type: 'string' },
      requiredApprovals: { type: 'integer', minimum: 0 },
      currentApprovals: { type: 'integer', minimum: 0 },
      totalVotes: { type: 'integer', minimum: 0 },
      recipient: { type: 'string', nullable: true },
      amount: { type: 'string', description: 'Satoshis serialized as a string' },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'id',
      'draftTransactionId',
      'walletId',
      'status',
      'requiredApprovals',
      'currentApprovals',
      'totalVotes',
      'amount',
      'createdAt',
    ],
  },
  PendingApprovalsResponse: {
    type: 'object',
    properties: {
      approvals: {
        type: 'array',
        items: { $ref: '#/components/schemas/PendingApproval' },
      },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['approvals', 'total'],
  },
  ApprovalVoteRequest: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: [...VALID_VOTE_DECISIONS] },
      reason: { type: 'string' },
    },
    required: ['decision'],
    additionalProperties: false,
  },
  ApprovalVoteResponse: {
    type: 'object',
    properties: {
      vote: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          decision: { type: 'string', enum: [...VALID_VOTE_DECISIONS] },
          reason: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'decision', 'createdAt'],
      },
      request: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          requiredApprovals: { type: 'integer', minimum: 0 },
          currentApprovals: { type: 'integer', minimum: 0 },
          totalVotes: { type: 'integer', minimum: 0 },
        },
        required: ['id', 'status', 'requiredApprovals', 'currentApprovals', 'totalVotes'],
      },
    },
    required: ['vote', 'request'],
  },
  OwnerOverrideRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string', minLength: 1 },
    },
    required: ['reason'],
    additionalProperties: false,
  },
} as const;
