import {
  adminSuccessResponseSchema,
  baseSettingsProperties,
} from './shared';

export const adminCoreSettingsBackupSchemas = {
  AdminVersionResponse: {
    type: 'object',
    properties: {
      currentVersion: { type: 'string' },
      latestVersion: { type: 'string' },
      updateAvailable: { type: 'boolean' },
      releaseUrl: { type: 'string' },
      releaseName: { type: 'string' },
      publishedAt: { type: 'string' },
      releaseNotes: { type: 'string' },
    },
    required: [
      'currentVersion',
      'latestVersion',
      'updateAvailable',
      'releaseUrl',
      'releaseName',
      'publishedAt',
      'releaseNotes',
    ],
  },
  AdminSettings: {
    type: 'object',
    properties: baseSettingsProperties,
    additionalProperties: true,
  },
  AdminSettingsUpdateRequest: {
    type: 'object',
    properties: {
      ...baseSettingsProperties,
      'smtp.password': { type: 'string' },
    },
    additionalProperties: true,
  },
  AdminSimpleErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      issues: {
        type: 'array',
        items: { type: 'string' },
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['error'],
  },
  AdminSuccessResponse: adminSuccessResponseSchema,
  AdminEncryptionKeysRequest: {
    type: 'object',
    properties: {
      password: { type: 'string', minLength: 1 },
    },
    required: ['password'],
    additionalProperties: false,
  },
  AdminEncryptionKeysResponse: {
    type: 'object',
    properties: {
      encryptionKey: { type: 'string' },
      encryptionSalt: { type: 'string' },
      hasEncryptionKey: { type: 'boolean' },
      hasEncryptionSalt: { type: 'boolean' },
    },
    required: ['encryptionKey', 'encryptionSalt', 'hasEncryptionKey', 'hasEncryptionSalt'],
  },
  AdminCreateBackupRequest: {
    type: 'object',
    properties: {
      includeCache: { type: 'boolean', default: false },
      description: { type: 'string' },
    },
    additionalProperties: false,
  },
  AdminBackupMeta: {
    type: 'object',
    properties: {
      version: { type: 'string' },
      appVersion: { type: 'string' },
      schemaVersion: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      createdBy: { type: 'string' },
      description: { type: 'string' },
      includesCache: { type: 'boolean' },
      recordCounts: {
        type: 'object',
        additionalProperties: { type: 'integer', minimum: 0 },
      },
    },
    required: ['version', 'appVersion', 'schemaVersion', 'createdAt', 'createdBy', 'includesCache', 'recordCounts'],
  },
  AdminSanctuaryBackup: {
    type: 'object',
    properties: {
      meta: { $ref: '#/components/schemas/AdminBackupMeta' },
      data: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
      },
    },
    required: ['meta', 'data'],
  },
  AdminBackupPayloadRequest: {
    type: 'object',
    properties: {
      backup: { $ref: '#/components/schemas/AdminSanctuaryBackup' },
    },
    required: ['backup'],
    additionalProperties: false,
  },
  AdminBackupValidationInfo: {
    type: 'object',
    properties: {
      createdAt: { type: 'string', format: 'date-time' },
      appVersion: { type: 'string' },
      schemaVersion: { type: 'integer' },
      totalRecords: { type: 'integer', minimum: 0 },
      tables: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['createdAt', 'appVersion', 'schemaVersion', 'totalRecords', 'tables'],
  },
  AdminBackupValidationResponse: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' },
      issues: {
        type: 'array',
        items: { type: 'string' },
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
      info: { $ref: '#/components/schemas/AdminBackupValidationInfo' },
    },
    required: ['valid', 'issues', 'warnings', 'info'],
  },
  AdminRestoreRequest: {
    type: 'object',
    properties: {
      backup: { $ref: '#/components/schemas/AdminSanctuaryBackup' },
      confirmationCode: { type: 'string', enum: ['CONFIRM_RESTORE'] },
    },
    required: ['backup', 'confirmationCode'],
    additionalProperties: false,
  },
  AdminRestoreSuccessResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      tablesRestored: { type: 'integer', minimum: 0 },
      recordsRestored: { type: 'integer', minimum: 0 },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['success', 'message', 'tablesRestored', 'recordsRestored', 'warnings'],
  },
  AdminRestoreInvalidBackupResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', enum: ['Invalid Backup'] },
      message: { type: 'string' },
      issues: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['error', 'message', 'issues'],
  },
  AdminRestoreFailedResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', enum: ['Restore Failed'] },
      message: { type: 'string' },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['error', 'message', 'warnings'],
  },
  AdminSupportPackage: {
    type: 'object',
    properties: {
      version: { type: 'string' },
      generatedAt: { type: 'string', format: 'date-time' },
      serverVersion: { type: 'string' },
      collectors: {
        type: 'object',
        additionalProperties: { type: 'object', additionalProperties: true },
      },
      meta: {
        type: 'object',
        properties: {
          totalDurationMs: { type: 'integer', minimum: 0 },
          succeeded: {
            type: 'array',
            items: { type: 'string' },
          },
          failed: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['totalDurationMs', 'succeeded', 'failed'],
      },
    },
    required: ['version', 'generatedAt', 'serverVersion', 'collectors', 'meta'],
  },
} as const;
