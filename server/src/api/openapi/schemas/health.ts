/**
 * Health OpenAPI Schemas
 *
 * Schema definitions for API health and readiness endpoints.
 */

export const healthSchemas = {
  HealthStatus: {
    type: 'string',
    enum: ['healthy', 'degraded', 'unhealthy'],
  },
  ComponentHealth: {
    type: 'object',
    properties: {
      status: { $ref: '#/components/schemas/HealthStatus' },
      message: { type: 'string' },
      latency: { type: 'number' },
      details: {
        type: 'object',
        additionalProperties: true,
      },
    },
    required: ['status'],
  },
  HealthResponse: {
    type: 'object',
    properties: {
      status: { $ref: '#/components/schemas/HealthStatus' },
      timestamp: { type: 'string', format: 'date-time' },
      uptime: { type: 'integer', minimum: 0 },
      version: { type: 'string' },
      components: {
        type: 'object',
        properties: {
          database: { $ref: '#/components/schemas/ComponentHealth' },
          redis: { $ref: '#/components/schemas/ComponentHealth' },
          electrum: { $ref: '#/components/schemas/ComponentHealth' },
          websocket: { $ref: '#/components/schemas/ComponentHealth' },
          sync: { $ref: '#/components/schemas/ComponentHealth' },
          jobQueue: { $ref: '#/components/schemas/ComponentHealth' },
          cacheInvalidation: { $ref: '#/components/schemas/ComponentHealth' },
          startup: { $ref: '#/components/schemas/ComponentHealth' },
          circuitBreakers: { $ref: '#/components/schemas/ComponentHealth' },
          memory: { $ref: '#/components/schemas/ComponentHealth' },
          disk: { $ref: '#/components/schemas/ComponentHealth' },
        },
        required: [
          'database',
          'redis',
          'electrum',
          'websocket',
          'sync',
          'jobQueue',
          'cacheInvalidation',
          'startup',
          'circuitBreakers',
          'memory',
          'disk',
        ],
      },
    },
    required: ['status', 'timestamp', 'uptime', 'version', 'components'],
  },
  HealthLiveResponse: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['alive'] },
    },
    required: ['status'],
  },
  HealthReadyResponse: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ready', 'not ready'] },
      reason: { type: 'string' },
    },
    required: ['status'],
  },
  CircuitBreakerHealth: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      state: { type: 'string', enum: ['closed', 'open', 'half-open'] },
      failures: { type: 'integer', minimum: 0 },
      successes: { type: 'integer', minimum: 0 },
      lastFailure: { type: 'string', format: 'date-time', nullable: true },
      lastSuccess: { type: 'string', format: 'date-time', nullable: true },
      totalRequests: { type: 'integer', minimum: 0 },
      totalFailures: { type: 'integer', minimum: 0 },
    },
    required: ['name', 'state', 'failures', 'successes'],
    additionalProperties: true,
  },
  HealthCircuitsResponse: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['api-process'] },
      overall: { $ref: '#/components/schemas/HealthStatus' },
      circuits: {
        type: 'array',
        items: { $ref: '#/components/schemas/CircuitBreakerHealth' },
      },
    },
    required: ['overall', 'circuits'],
  },
} as const;
