import {
  ELECTRUM_NETWORK_VALUES,
  electrumServerMutableProperties,
  nodeConfigPortInputSchema,
} from './shared';

export const adminElectrumRuntimeSchemas = {
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
} as const;
