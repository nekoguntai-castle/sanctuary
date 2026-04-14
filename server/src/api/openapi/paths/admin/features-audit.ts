import {
  adminFeatureKeyParameter,
  apiErrorResponse,
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_LOG_LIMIT_MAX,
  AUDIT_STATS_DAYS,
  bearerAuth,
  featureFlagResponse,
  FEATURE_FLAG_KEYS,
  jsonRequestBody,
  jsonResponse,
} from './shared';

export const adminFeaturesAuditPaths = {
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
  '/admin/audit-logs': {
    get: {
      tags: ['Admin'],
      summary: 'List audit logs',
      description: 'List administrative audit logs with filters and clamped pagination.',
      security: bearerAuth,
      parameters: [
        {
          name: 'userId',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'username',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'action',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'category',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'success',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'startDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'endDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: AUDIT_LOG_LIMIT_MAX,
            default: AUDIT_DEFAULT_PAGE_SIZE,
          },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Audit log entries', '#/components/schemas/AdminAuditLogsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/audit-logs/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Get audit log statistics',
      description: 'Get aggregate audit log statistics for a recent day window.',
      security: bearerAuth,
      parameters: [
        {
          name: 'days',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, default: AUDIT_STATS_DAYS },
        },
      ],
      responses: {
        200: jsonResponse('Audit log statistics', '#/components/schemas/AdminAuditStatsResponse'),
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
