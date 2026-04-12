/**
 * Admin OpenAPI Schemas
 *
 * Schema definitions for administrative endpoints.
 */

import {
  DEFAULT_AI_ENABLED,
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
  DEFAULT_DRAFT_EXPIRATION_DAYS,
  DEFAULT_DUST_THRESHOLD,
  DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS,
  DEFAULT_EMAIL_VERIFICATION_REQUIRED,
  DEFAULT_SMTP_FROM_NAME,
  DEFAULT_SMTP_PORT,
} from '../../../constants';
import { FEATURE_FLAG_KEYS } from '../../../services/featureFlags/definitions';
import { ADMIN_GROUP_ROLE_VALUES } from '../../admin/groupRoles';

const baseSettingsProperties = {
  registrationEnabled: { type: 'boolean', default: false },
  confirmationThreshold: { type: 'integer', default: DEFAULT_CONFIRMATION_THRESHOLD },
  deepConfirmationThreshold: { type: 'integer', default: DEFAULT_DEEP_CONFIRMATION_THRESHOLD },
  dustThreshold: { type: 'integer', default: DEFAULT_DUST_THRESHOLD },
  draftExpirationDays: { type: 'integer', default: DEFAULT_DRAFT_EXPIRATION_DAYS },
  aiEnabled: { type: 'boolean', default: DEFAULT_AI_ENABLED },
  aiEndpoint: { type: 'string', default: DEFAULT_AI_ENDPOINT },
  aiModel: { type: 'string', default: DEFAULT_AI_MODEL },
  'email.verificationRequired': { type: 'boolean', default: DEFAULT_EMAIL_VERIFICATION_REQUIRED },
  'email.tokenExpiryHours': { type: 'integer', default: DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS },
  'smtp.host': { type: 'string', default: '' },
  'smtp.port': { type: 'integer', default: DEFAULT_SMTP_PORT },
  'smtp.secure': { type: 'boolean', default: false },
  'smtp.user': { type: 'string', default: '' },
  'smtp.fromAddress': { type: 'string', default: '' },
  'smtp.fromName': { type: 'string', default: DEFAULT_SMTP_FROM_NAME },
  'smtp.configured': { type: 'boolean', default: false },
} as const;

const NODE_CONFIG_TYPE_VALUES = ['electrum'] as const;
const NODE_CONNECTION_MODE_VALUES = ['singleton', 'pool'] as const;
const NODE_LOAD_BALANCING_VALUES = ['round_robin', 'least_connections', 'failover_only'] as const;
const NODE_MEMPOOL_ESTIMATOR_VALUES = ['simple', 'mempool_space'] as const;
const ELECTRUM_NETWORK_VALUES = ['mainnet', 'testnet', 'signet', 'regtest'] as const;
const DEAD_LETTER_CATEGORY_VALUES = ['sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other'] as const;
const MONITORING_SERVICE_VALUES = ['grafana', 'prometheus', 'jaeger'] as const;

const nodeConfigPortInputSchema = {
  oneOf: [
    { type: 'string', pattern: '^\\d+$' },
    { type: 'integer', minimum: 1, maximum: 65535 },
  ],
} as const;

const nodeConfigCountInputSchema = {
  oneOf: [
    { type: 'string', pattern: '^\\d+$' },
    { type: 'integer', minimum: 0 },
  ],
} as const;

const nodeConfigNullablePortInputSchema = { ...nodeConfigPortInputSchema, nullable: true } as const;
const nodeConfigNullableCountInputSchema = { ...nodeConfigCountInputSchema, nullable: true } as const;
const nodeConnectionModeSchema = { type: 'string', enum: [...NODE_CONNECTION_MODE_VALUES] } as const;
const nodeLoadBalancingSchema = { type: 'string', enum: [...NODE_LOAD_BALANCING_VALUES] } as const;
const nodeMempoolEstimatorSchema = { type: 'string', enum: [...NODE_MEMPOOL_ESTIMATOR_VALUES] } as const;

const electrumServerMutableProperties = {
  label: { type: 'string', minLength: 1 },
  host: { type: 'string', minLength: 1 },
  port: nodeConfigPortInputSchema,
  useSsl: { type: 'boolean', default: true },
  priority: { type: 'integer', minimum: 0 },
  enabled: { type: 'boolean', default: true },
  network: { type: 'string', enum: [...ELECTRUM_NETWORK_VALUES], default: 'mainnet' },
} as const;

const adminSuccessResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
} as const;

const nodeConfigResponseProperties = {
  type: { type: 'string', enum: [...NODE_CONFIG_TYPE_VALUES] },
  host: { type: 'string' },
  port: { type: 'string' },
  useSsl: { type: 'boolean' },
  allowSelfSignedCert: { type: 'boolean' },
  user: { type: 'string', nullable: true },
  hasPassword: { type: 'boolean' },
  explorerUrl: { type: 'string', nullable: true },
  feeEstimatorUrl: { type: 'string', nullable: true },
  mempoolEstimator: nodeMempoolEstimatorSchema,
  poolEnabled: { type: 'boolean' },
  poolMinConnections: { type: 'integer', minimum: 0 },
  poolMaxConnections: { type: 'integer', minimum: 0 },
  poolLoadBalancing: nodeLoadBalancingSchema,
  mainnetMode: nodeConnectionModeSchema,
  mainnetSingletonHost: { type: 'string', nullable: true },
  mainnetSingletonPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  mainnetSingletonSsl: { type: 'boolean', nullable: true },
  mainnetPoolMin: { type: 'integer', nullable: true, minimum: 0 },
  mainnetPoolMax: { type: 'integer', nullable: true, minimum: 0 },
  mainnetPoolLoadBalancing: nodeLoadBalancingSchema,
  testnetEnabled: { type: 'boolean' },
  testnetMode: nodeConnectionModeSchema,
  testnetSingletonHost: { type: 'string', nullable: true },
  testnetSingletonPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  testnetSingletonSsl: { type: 'boolean', nullable: true },
  testnetPoolMin: { type: 'integer', nullable: true, minimum: 0 },
  testnetPoolMax: { type: 'integer', nullable: true, minimum: 0 },
  testnetPoolLoadBalancing: nodeLoadBalancingSchema,
  signetEnabled: { type: 'boolean' },
  signetMode: nodeConnectionModeSchema,
  signetSingletonHost: { type: 'string', nullable: true },
  signetSingletonPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  signetSingletonSsl: { type: 'boolean', nullable: true },
  signetPoolMin: { type: 'integer', nullable: true, minimum: 0 },
  signetPoolMax: { type: 'integer', nullable: true, minimum: 0 },
  signetPoolLoadBalancing: nodeLoadBalancingSchema,
  proxyEnabled: { type: 'boolean' },
  proxyHost: { type: 'string', nullable: true },
  proxyPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  proxyUsername: { type: 'string', nullable: true },
  proxyPassword: {
    type: 'string',
    nullable: true,
    description: 'Masked as ******** when a proxy password is configured.',
  },
  servers: {
    type: 'array',
    items: { $ref: '#/components/schemas/AdminElectrumServer' },
  },
} as const;

const nodeConfigUpdateRequestProperties = {
  ...nodeConfigResponseProperties,
  port: nodeConfigPortInputSchema,
  user: { type: 'string', nullable: true },
  password: { type: 'string', format: 'password' },
  proxyPort: nodeConfigNullablePortInputSchema,
  proxyPassword: { type: 'string', format: 'password' },
  mainnetSingletonPort: nodeConfigNullablePortInputSchema,
  mainnetPoolMin: nodeConfigNullableCountInputSchema,
  mainnetPoolMax: nodeConfigNullableCountInputSchema,
  testnetSingletonPort: nodeConfigNullablePortInputSchema,
  testnetPoolMin: nodeConfigNullableCountInputSchema,
  testnetPoolMax: nodeConfigNullableCountInputSchema,
  signetSingletonPort: nodeConfigNullablePortInputSchema,
  signetPoolMin: nodeConfigNullableCountInputSchema,
  signetPoolMax: nodeConfigNullableCountInputSchema,
} as const;

export const adminSchemas = {
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
  AdminUser: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
      email: { type: 'string', format: 'email', nullable: true },
      emailVerified: { type: 'boolean' },
      emailVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
      isAdmin: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'username', 'email', 'emailVerified', 'isAdmin', 'createdAt'],
  },
  AdminCreateUserRequest: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 3 },
      password: {
        type: 'string',
        minLength: 8,
        description: 'Must include uppercase, lowercase, and numeric characters.',
      },
      email: { type: 'string', format: 'email' },
      isAdmin: { type: 'boolean', default: false },
    },
    required: ['username', 'password', 'email'],
    additionalProperties: false,
  },
  AdminUpdateUserRequest: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 3 },
      password: {
        type: 'string',
        minLength: 8,
        description: 'Must include uppercase, lowercase, and numeric characters.',
      },
      email: {
        oneOf: [
          { type: 'string', format: 'email' },
          { type: 'string', enum: [''] },
        ],
        description: 'Use an empty string to clear the user email address.',
      },
      isAdmin: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  AdminDeleteUserResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  AdminGroupRole: {
    type: 'string',
    enum: [...ADMIN_GROUP_ROLE_VALUES],
  },
  AdminGroupMember: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      username: { type: 'string' },
      role: { $ref: '#/components/schemas/AdminGroupRole' },
    },
    required: ['userId', 'username', 'role'],
  },
  AdminGroup: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      purpose: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      members: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminGroupMember' },
      },
    },
    required: ['id', 'name', 'description', 'purpose', 'createdAt', 'updatedAt', 'members'],
  },
  AdminCreateGroupRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', nullable: true },
      purpose: { type: 'string', nullable: true },
      memberIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  AdminUpdateGroupRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', nullable: true },
      purpose: { type: 'string', nullable: true },
      memberIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    additionalProperties: false,
  },
  AdminAddGroupMemberRequest: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      role: { $ref: '#/components/schemas/AdminGroupRole' },
    },
    required: ['userId'],
    additionalProperties: false,
  },
  AdminDeleteGroupResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  AdminRemoveGroupMemberResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  AdminPolicyDeleteResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
    },
    required: ['success'],
  },
  AdminElectrumServer: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      nodeConfigId: { type: 'string' },
      network: { type: 'string', enum: [...ELECTRUM_NETWORK_VALUES] },
      label: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      useSsl: { type: 'boolean' },
      priority: { type: 'integer', minimum: 0 },
      enabled: { type: 'boolean' },
      lastHealthCheck: { type: 'string', format: 'date-time', nullable: true },
      healthCheckFails: { type: 'integer', minimum: 0 },
      isHealthy: { type: 'boolean' },
      lastHealthCheckError: { type: 'string', nullable: true },
      supportsVerbose: { type: 'boolean', nullable: true },
      lastCapabilityCheck: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'host', 'port', 'priority'],
    additionalProperties: true,
  },
  AdminCreateElectrumServerRequest: {
    type: 'object',
    properties: electrumServerMutableProperties,
    required: ['label', 'host', 'port'],
    additionalProperties: false,
  },
  AdminUpdateElectrumServerRequest: {
    type: 'object',
    properties: {
      ...electrumServerMutableProperties,
      useSsl: { type: 'boolean' },
      enabled: { type: 'boolean' },
      network: { type: 'string', enum: [...ELECTRUM_NETWORK_VALUES] },
    },
    additionalProperties: false,
  },
  AdminElectrumConnectionTestRequest: {
    type: 'object',
    properties: {
      host: { type: 'string', minLength: 1 },
      port: nodeConfigPortInputSchema,
      useSsl: { type: 'boolean', default: false },
    },
    required: ['host', 'port'],
    additionalProperties: false,
  },
  AdminElectrumConnectionTestResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      blockHeight: { type: 'integer', minimum: 0 },
    },
    required: ['success', 'message'],
  },
  AdminReorderElectrumServersRequest: {
    type: 'object',
    properties: {
      serverIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['serverIds'],
    additionalProperties: false,
  },
  AdminReorderElectrumServersResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  AdminDeleteElectrumServerResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  AdminElectrumServerTestInfo: {
    type: 'object',
    properties: {
      blockHeight: { type: 'integer', minimum: 0 },
      supportsVerbose: { type: 'boolean' },
    },
    additionalProperties: true,
  },
  AdminElectrumServerTestResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      error: { type: 'string' },
      info: { $ref: '#/components/schemas/AdminElectrumServerTestInfo' },
    },
    required: ['success', 'message'],
  },
  AdminTorContainerStatusResponse: {
    type: 'object',
    properties: {
      available: { type: 'boolean' },
      exists: { type: 'boolean' },
      running: { type: 'boolean' },
      status: { type: 'string' },
      containerId: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['available', 'exists', 'running'],
  },
  AdminContainerActionResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  AdminCacheStats: {
    type: 'object',
    properties: {
      hits: { type: 'integer', minimum: 0 },
      misses: { type: 'integer', minimum: 0 },
      sets: { type: 'integer', minimum: 0 },
      deletes: { type: 'integer', minimum: 0 },
      evictions: { type: 'integer', minimum: 0 },
      size: { type: 'integer', minimum: 0 },
    },
    additionalProperties: true,
  },
  AdminCacheMetricsResponse: {
    type: 'object',
    properties: {
      timestamp: { type: 'string', format: 'date-time' },
      stats: { $ref: '#/components/schemas/AdminCacheStats' },
      hitRate: { type: 'string' },
    },
    required: ['timestamp', 'stats', 'hitRate'],
  },
  AdminWebSocketRateLimits: {
    type: 'object',
    properties: {
      maxMessagesPerSecond: { type: 'integer', minimum: 0 },
      gracePeriodMs: { type: 'integer', minimum: 0 },
      gracePeriodMessageLimit: { type: 'integer', minimum: 0 },
      maxSubscriptionsPerConnection: { type: 'integer', minimum: 0 },
    },
    additionalProperties: true,
  },
  AdminWebSocketRateLimitEvent: {
    type: 'object',
    properties: {
      timestamp: { type: 'string', format: 'date-time' },
      userId: { type: 'string', nullable: true },
      reason: {
        type: 'string',
        enum: ['grace_period_exceeded', 'per_second_exceeded', 'subscription_limit', 'queue_overflow'],
      },
      details: { type: 'string' },
      path: { type: 'string' },
    },
    required: ['timestamp'],
    additionalProperties: true,
  },
  AdminWebSocketStatsResponse: {
    type: 'object',
    properties: {
      connections: {
        type: 'object',
        properties: {
          current: { type: 'integer', minimum: 0 },
          max: { type: 'integer', minimum: 0 },
          uniqueUsers: { type: 'integer', minimum: 0 },
          maxPerUser: { type: 'integer', minimum: 0 },
        },
        required: ['current', 'max', 'uniqueUsers', 'maxPerUser'],
      },
      subscriptions: {
        type: 'object',
        properties: {
          total: { type: 'integer', minimum: 0 },
          channels: { type: 'integer', minimum: 0 },
          channelList: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['total', 'channels', 'channelList'],
      },
      rateLimits: { $ref: '#/components/schemas/AdminWebSocketRateLimits' },
      recentRateLimitEvents: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminWebSocketRateLimitEvent' },
      },
    },
    required: ['connections', 'subscriptions', 'rateLimits', 'recentRateLimitEvents'],
  },
  AdminDeadLetterCategory: {
    type: 'string',
    enum: [...DEAD_LETTER_CATEGORY_VALUES],
  },
  AdminDeadLetterStats: {
    type: 'object',
    properties: {
      total: { type: 'integer', minimum: 0 },
      byCategory: {
        type: 'object',
        additionalProperties: { type: 'integer', minimum: 0 },
      },
      oldest: { type: 'string', format: 'date-time' },
      newest: { type: 'string', format: 'date-time' },
    },
    required: ['total', 'byCategory'],
  },
  AdminDeadLetterEntry: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      category: { $ref: '#/components/schemas/AdminDeadLetterCategory' },
      operation: { type: 'string' },
      payload: { type: 'object', additionalProperties: true },
      error: { type: 'string' },
      errorStack: {
        type: 'string',
        description: 'Truncated to 500 characters by the admin API.',
      },
      attempts: { type: 'integer', minimum: 0 },
      firstFailedAt: { type: 'string', format: 'date-time' },
      lastFailedAt: { type: 'string', format: 'date-time' },
      metadata: { type: 'object', additionalProperties: true },
    },
    required: ['id', 'category'],
    additionalProperties: true,
  },
  AdminDeadLetterQueueResponse: {
    type: 'object',
    properties: {
      stats: { $ref: '#/components/schemas/AdminDeadLetterStats' },
      entries: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminDeadLetterEntry' },
      },
    },
    required: ['stats', 'entries'],
  },
  AdminDeadLetterRetryResponse: {
    type: 'object',
    properties: {
      entry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { $ref: '#/components/schemas/AdminDeadLetterCategory' },
          operation: { type: 'string' },
        },
        required: ['id', 'category', 'operation'],
      },
      retry: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
        },
        required: ['success', 'message'],
      },
    },
    required: ['entry', 'retry'],
  },
  AdminClearDeadLetterCategoryResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      removed: { type: 'integer', minimum: 0 },
    },
    required: ['success', 'removed'],
  },
  AdminMonitoringServiceId: {
    type: 'string',
    enum: [...MONITORING_SERVICE_VALUES],
  },
  AdminMonitoringService: {
    type: 'object',
    properties: {
      id: { $ref: '#/components/schemas/AdminMonitoringServiceId' },
      name: { type: 'string' },
      description: { type: 'string' },
      url: { type: 'string' },
      defaultPort: { type: 'integer', minimum: 0 },
      icon: { type: 'string' },
      isCustomUrl: { type: 'boolean' },
      status: { type: 'string', enum: ['unknown', 'healthy', 'unhealthy'] },
    },
    required: ['id', 'name', 'description', 'url', 'defaultPort', 'icon', 'isCustomUrl'],
  },
  AdminMonitoringServicesResponse: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      services: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminMonitoringService' },
      },
    },
    required: ['enabled', 'services'],
  },
  AdminUpdateMonitoringServiceRequest: {
    type: 'object',
    properties: {
      customUrl: { type: 'string', nullable: true },
    },
    additionalProperties: false,
  },
  AdminGrafanaConfigResponse: {
    type: 'object',
    properties: {
      username: { type: 'string' },
      passwordSource: { type: 'string', enum: ['GRAFANA_PASSWORD', 'ENCRYPTION_KEY'] },
      password: { type: 'string', format: 'password' },
      anonymousAccess: { type: 'boolean' },
      anonymousAccessNote: { type: 'string' },
    },
    required: ['username', 'passwordSource', 'password', 'anonymousAccess', 'anonymousAccessNote'],
  },
  AdminUpdateGrafanaRequest: {
    type: 'object',
    properties: {
      anonymousAccess: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  AdminGrafanaUpdateResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  AdminNodeConfig: {
    type: 'object',
    properties: nodeConfigResponseProperties,
    required: [
      'type',
      'host',
      'port',
      'useSsl',
      'allowSelfSignedCert',
      'explorerUrl',
      'feeEstimatorUrl',
      'mempoolEstimator',
      'poolEnabled',
      'poolMinConnections',
      'poolMaxConnections',
      'poolLoadBalancing',
      'servers',
    ],
  },
  AdminNodeConfigUpdateRequest: {
    type: 'object',
    properties: nodeConfigUpdateRequestProperties,
    required: ['type', 'host', 'port'],
    additionalProperties: false,
  },
  AdminNodeConfigUpdateResponse: {
    allOf: [
      { $ref: '#/components/schemas/AdminNodeConfig' },
      {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
    ],
  },
  AdminNodeConfigTestRequest: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...NODE_CONFIG_TYPE_VALUES] },
      host: { type: 'string' },
      port: nodeConfigPortInputSchema,
      useSsl: { type: 'boolean', default: false },
    },
    required: ['type', 'host', 'port'],
    additionalProperties: false,
  },
  AdminNodeConfigTestSuccessResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      blockHeight: { type: 'integer', minimum: 0 },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  AdminNodeConfigTestFailedResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: { type: 'string', enum: ['Connection Failed'] },
      message: { type: 'string' },
    },
    required: ['success', 'error', 'message'],
  },
  AdminProxyTestRequest: {
    type: 'object',
    properties: {
      host: { type: 'string' },
      port: nodeConfigPortInputSchema,
      username: { type: 'string' },
      password: { type: 'string', format: 'password' },
    },
    required: ['host', 'port'],
    additionalProperties: false,
  },
  AdminProxyTestSuccessResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string' },
      exitIp: { type: 'string' },
      isTorExit: { type: 'boolean' },
    },
    required: ['success', 'message', 'exitIp', 'isTorExit'],
  },
  AdminProxyTestFailedResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: { type: 'string', enum: ['Tor Verification Failed'] },
      message: { type: 'string' },
    },
    required: ['success', 'error', 'message'],
  },
  AdminFeatureFlagKey: {
    type: 'string',
    enum: [...FEATURE_FLAG_KEYS],
  },
  AdminFeatureFlag: {
    type: 'object',
    properties: {
      key: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
      enabled: { type: 'boolean' },
      description: { type: 'string' },
      category: { type: 'string', enum: ['general', 'experimental'] },
      source: { type: 'string', enum: ['environment', 'database'] },
      modifiedBy: { type: 'string', nullable: true },
      updatedAt: { type: 'string', format: 'date-time', nullable: true },
      hasSideEffects: { type: 'boolean' },
      sideEffectDescription: { type: 'string' },
    },
    required: ['key', 'enabled', 'description', 'category', 'source'],
  },
  AdminFeatureFlagAuditEntry: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      key: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
      previousValue: { type: 'boolean', nullable: true },
      newValue: { type: 'boolean' },
      changedBy: { type: 'string' },
      reason: { type: 'string', nullable: true },
      ipAddress: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'key', 'previousValue', 'newValue', 'changedBy', 'createdAt'],
  },
  AdminFeatureFlagAuditResponse: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminFeatureFlagAuditEntry' },
      },
      total: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      offset: { type: 'integer', minimum: 0 },
    },
    required: ['entries', 'total', 'limit', 'offset'],
  },
  AdminUpdateFeatureFlagRequest: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      reason: { type: 'string', maxLength: 500 },
    },
    required: ['enabled'],
    additionalProperties: false,
  },
  AdminAuditLog: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      userId: { type: 'string', nullable: true },
      username: { type: 'string' },
      action: { type: 'string' },
      category: { type: 'string' },
      details: { type: 'object', additionalProperties: true, nullable: true },
      ipAddress: { type: 'string', nullable: true },
      userAgent: { type: 'string', nullable: true },
      success: { type: 'boolean' },
      errorMsg: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'id',
      'userId',
      'username',
      'action',
      'category',
      'details',
      'ipAddress',
      'userAgent',
      'success',
      'errorMsg',
      'createdAt',
    ],
  },
  AdminAuditLogsResponse: {
    type: 'object',
    properties: {
      logs: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminAuditLog' },
      },
      total: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    required: ['logs', 'total', 'limit', 'offset'],
  },
  AdminAuditStatsResponse: {
    type: 'object',
    properties: {
      totalEvents: { type: 'integer', minimum: 0 },
      byCategory: {
        type: 'object',
        additionalProperties: { type: 'integer', minimum: 0 },
      },
      byAction: {
        type: 'object',
        additionalProperties: { type: 'integer', minimum: 0 },
      },
      failedEvents: { type: 'integer', minimum: 0 },
    },
    required: ['totalEvents', 'byCategory', 'byAction', 'failedEvents'],
  },
} as const;
