/**
 * Common OpenAPI Schemas
 *
 * Shared schema definitions used across multiple API domains.
 */

export const commonSchemas = {
  ApiError: {
    type: 'object',
    properties: {
      error: { type: 'string', example: 'NotFound' },
      code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
      message: { type: 'string', example: 'Wallet not found' },
      details: { type: 'object' },
      timestamp: { type: 'string', format: 'date-time' },
      requestId: { type: 'string' },
    },
    required: ['error', 'code', 'message', 'timestamp'],
  },
  SuccessResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
} as const;
