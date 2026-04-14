import {
  DEAD_LETTER_CATEGORY_VALUES,
  MONITORING_SERVICE_VALUES,
  NODE_CONFIG_TYPE_VALUES,
  nodeConfigPortInputSchema,
  nodeConfigResponseProperties,
  nodeConfigUpdateRequestProperties,
} from './shared';

export const adminOpsMonitoringNodeSchemas = {
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
} as const;
