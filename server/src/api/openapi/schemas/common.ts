/**
 * Common OpenAPI Schemas
 *
 * Shared schema definitions used across multiple API domains.
 */

import { PASSWORD_POLICY, PASSWORD_POLICY_MESSAGES } from '../../../utils/password';

const passwordDescription = [
  'Must include uppercase, lowercase, and numeric characters.',
  PASSWORD_POLICY_MESSAGES.maxUtf8Bytes,
  'For non-ASCII passwords, the server applies the byte limit even when the character count is lower.',
].join(' ');

// OpenAPI maxLength is character-based; the description carries the stricter UTF-8 byte rule.
export const passwordRequestPropertySchema = {
  type: 'string',
  minLength: PASSWORD_POLICY.minLength,
  maxLength: PASSWORD_POLICY.maxUtf8Bytes,
  description: passwordDescription,
} as const;

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
