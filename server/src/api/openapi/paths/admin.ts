/**
 * Admin API Path Definitions
 *
 * OpenAPI path definitions for bounded administrative metadata and
 * configuration endpoints.
 */

import { FEATURE_FLAG_KEYS } from '../../../services/featureFlags/definitions';

const bearerAuth = [{ bearerAuth: [] }] as const;

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const adminFeatureKeyParameter = {
  name: 'key',
  in: 'path',
  required: true,
  schema: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
} as const;

const jsonRequestBody = (schemaRef: string) => ({
  required: true,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const featureFlagResponse = jsonResponse('Feature flag', '#/components/schemas/AdminFeatureFlag');

export const adminPaths = {
  '/admin/version': {
    get: {
      tags: ['Admin'],
      summary: 'Get application version',
      description: 'Get the current application version and latest GitHub release metadata.',
      responses: {
        200: jsonResponse('Application version information', '#/components/schemas/AdminVersionResponse'),
        500: apiErrorResponse,
      },
    },
  },
  '/admin/settings': {
    get: {
      tags: ['Admin'],
      summary: 'Get system settings',
      description: 'Get administrative system settings. SMTP password values are never returned.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('System settings', '#/components/schemas/AdminSettings'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    put: {
      tags: ['Admin'],
      summary: 'Update system settings',
      description: 'Update administrative system settings. SMTP password values are encrypted before storage and never returned.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminSettingsUpdateRequest'),
      responses: {
        200: jsonResponse('Updated system settings', '#/components/schemas/AdminSettings'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features': {
    get: {
      tags: ['Admin'],
      summary: 'List feature flags',
      description: 'List runtime feature flag state from environment and database overrides.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Feature flags',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/AdminFeatureFlag' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/audit-log': {
    get: {
      tags: ['Admin'],
      summary: 'Get feature flag audit log',
      description: 'Get paginated feature flag audit entries, optionally filtered by feature flag key.',
      security: bearerAuth,
      parameters: [
        {
          name: 'key',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...FEATURE_FLAG_KEYS] },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Feature flag audit entries', '#/components/schemas/AdminFeatureFlagAuditResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/{key}': {
    get: {
      tags: ['Admin'],
      summary: 'Get feature flag',
      description: 'Get a single runtime feature flag by key.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update feature flag',
      description: 'Set a database override for a runtime feature flag.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateFeatureFlagRequest'),
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/{key}/reset': {
    post: {
      tags: ['Admin'],
      summary: 'Reset feature flag',
      description: 'Remove a database override and reset a runtime feature flag to its environment default.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
