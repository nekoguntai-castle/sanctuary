/**
 * Health API Path Definitions
 *
 * OpenAPI path definitions for health, readiness, and circuit status endpoints.
 */

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

export const healthPaths = {
  '/health': {
    get: {
      tags: ['Health'],
      summary: 'Get API health',
      description: 'Run a comprehensive API health check across database, Redis, Electrum, WebSocket, sync, job queue, startup, circuit breaker, memory, and disk components.',
      responses: {
        200: jsonResponse('Healthy or degraded health status', '#/components/schemas/HealthResponse'),
        503: jsonResponse('Unhealthy health status', '#/components/schemas/HealthResponse'),
        500: apiErrorResponse,
      },
    },
  },
  '/health/live': {
    get: {
      tags: ['Health'],
      summary: 'Get liveness status',
      description: 'Kubernetes liveness probe that only verifies the API process is responding.',
      responses: {
        200: jsonResponse('API is alive', '#/components/schemas/HealthLiveResponse'),
      },
    },
  },
  '/health/ready': {
    get: {
      tags: ['Health'],
      summary: 'Get readiness status',
      description: 'Kubernetes readiness probe that checks whether required dependencies are ready for traffic.',
      responses: {
        200: jsonResponse('API is ready', '#/components/schemas/HealthReadyResponse'),
        503: jsonResponse('API is not ready', '#/components/schemas/HealthReadyResponse'),
        500: apiErrorResponse,
      },
    },
  },
  '/health/circuits': {
    get: {
      tags: ['Health'],
      summary: 'Get circuit breaker status',
      description: 'Get detailed circuit breaker status for the breakers registered in the API process. Worker breakers are not included.',
      responses: {
        200: jsonResponse('Circuit breaker status', '#/components/schemas/HealthCircuitsResponse'),
      },
    },
  },
} as const;
