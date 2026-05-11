/**
 * Device OpenAPI Schemas
 *
 * Schema definitions for hardware device management.
 */

import {
  MOBILE_DEVICE_ACCOUNT_PURPOSES,
  MOBILE_DEVICE_SCRIPT_TYPES,
} from '@sanctuary/shared/schemas/mobileApiRequests';

export const deviceSchemas = {
  DeviceModel: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      manufacturer: { type: 'string' },
      connectivity: {
        type: 'array',
        items: { type: 'string' },
      },
      secureElement: { type: 'boolean' },
      openSource: { type: 'boolean' },
      airGapped: { type: 'boolean' },
      supportsBitcoinOnly: { type: 'boolean' },
      supportsMultisig: { type: 'boolean' },
      supportsTaproot: { type: 'boolean' },
      supportsPassphrase: { type: 'boolean' },
      scriptTypes: {
        type: 'array',
        items: { type: 'string' },
      },
      hasScreen: { type: 'boolean' },
      screenType: { type: 'string', nullable: true },
      integrationTested: { type: 'boolean' },
      releaseYear: { type: 'integer', nullable: true },
      discontinued: { type: 'boolean' },
      imageUrl: { type: 'string', nullable: true },
      websiteUrl: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'id',
      'name',
      'slug',
      'manufacturer',
      'connectivity',
      'secureElement',
      'openSource',
      'airGapped',
      'supportsBitcoinOnly',
      'supportsMultisig',
      'supportsTaproot',
      'supportsPassphrase',
      'scriptTypes',
      'hasScreen',
      'integrationTested',
      'discontinued',
      'createdAt',
      'updatedAt',
    ],
  },
  DeviceAccount: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      deviceId: { type: 'string' },
      purpose: { type: 'string' },
      scriptType: { type: 'string' },
      derivationPath: { type: 'string' },
      xpub: { type: 'string' },
    },
    required: ['id', 'purpose', 'scriptType', 'derivationPath', 'xpub'],
  },
  DeviceAccountInput: {
    type: 'object',
    properties: {
      purpose: { type: 'string', enum: [...MOBILE_DEVICE_ACCOUNT_PURPOSES] },
      scriptType: { type: 'string', enum: [...MOBILE_DEVICE_SCRIPT_TYPES] },
      derivationPath: { type: 'string' },
      xpub: { type: 'string' },
    },
    required: ['purpose', 'scriptType', 'derivationPath', 'xpub'],
  },
  DeviceWalletUsage: {
    type: 'object',
    properties: {
      wallet: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          scriptType: { type: 'string', nullable: true },
        },
        required: ['id', 'name'],
      },
    },
    required: ['wallet'],
  },
  Device: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      modelId: { type: 'string', nullable: true },
      type: { type: 'string' },
      label: { type: 'string' },
      fingerprint: { type: 'string' },
      xpub: { type: 'string', nullable: true },
      derivationPath: { type: 'string', nullable: true },
      groupId: { type: 'string', nullable: true },
      groupRole: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      role: { type: 'string', enum: ['owner', 'viewer'] },
      isOwner: { type: 'boolean' },
      userRole: { type: 'string', enum: ['owner', 'viewer'], nullable: true },
      sharedBy: { type: 'string', nullable: true },
      walletCount: { type: 'integer' },
      model: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string' },
          slug: { type: 'string' },
          name: { type: 'string' },
        },
      },
      wallets: {
        type: 'array',
        items: { $ref: '#/components/schemas/DeviceWalletUsage' },
      },
      accounts: {
        type: 'array',
        items: { $ref: '#/components/schemas/DeviceAccount' },
      },
    },
    required: ['id', 'label', 'fingerprint', 'type'],
  },
  DeviceShareInfo: {
    type: 'object',
    properties: {
      group: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      },
      users: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            role: { type: 'string', enum: ['owner', 'viewer'] },
          },
          required: ['id', 'username', 'role'],
        },
      },
    },
    required: ['group', 'users'],
  },
  DeviceShareUserRequest: {
    type: 'object',
    properties: {
      targetUserId: { type: 'string' },
    },
    required: ['targetUserId'],
  },
  DeviceShareGroupRequest: {
    type: 'object',
    properties: {
      groupId: { type: 'string', nullable: true },
    },
  },
  DeviceShareResult: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      groupName: { type: 'string', nullable: true },
    },
    required: ['success', 'message'],
  },
  CreateDeviceRequest: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      label: { type: 'string' },
      fingerprint: { type: 'string' },
      xpub: { type: 'string' },
      derivationPath: { type: 'string' },
      modelSlug: { type: 'string' },
      accounts: {
        type: 'array',
        items: { $ref: '#/components/schemas/DeviceAccountInput' },
      },
      merge: { type: 'boolean' },
    },
    required: ['type', 'label', 'fingerprint'],
    anyOf: [
      { required: ['xpub'] },
      { required: ['accounts'] },
    ],
  },
  UpdateDeviceRequest: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      derivationPath: { type: 'string' },
      type: { type: 'string' },
      modelSlug: { type: 'string' },
    },
  },
  DeviceMergeResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      device: { $ref: '#/components/schemas/Device' },
      added: { type: 'integer' },
    },
    required: ['message', 'device', 'added'],
  },
  DeviceConflictResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', example: 'Conflict' },
      message: { type: 'string' },
      existingDevice: {
        type: 'object',
        additionalProperties: true,
      },
      comparison: {
        type: 'object',
        properties: {
          newAccounts: {
            type: 'array',
            items: { $ref: '#/components/schemas/DeviceAccountInput' },
          },
          matchingAccounts: {
            type: 'array',
            items: { $ref: '#/components/schemas/DeviceAccount' },
          },
          conflictingAccounts: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      conflictingAccounts: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
    },
    required: ['error', 'message', 'existingDevice'],
  },
} as const;
