import { FEATURE_FLAG_KEYS } from './shared';

export const adminFeatureAuditSchemas = {
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
