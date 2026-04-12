/**
 * Mobile Permissions API Path Definitions
 *
 * OpenAPI path definitions for user-facing mobile permission routes.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const userIdParameter = {
  name: 'userId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const permissionUpdateRequestBody = {
  required: true,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/MobilePermissionUpdateRequest' },
    },
  },
} as const;

const updateResponse = {
  description: 'Mobile permissions updated',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/MobilePermissionUpdateResponse' },
    },
  },
} as const;

export const mobilePermissionPaths = {
  '/mobile-permissions': {
    get: {
      tags: ['Mobile Permissions'],
      summary: 'List mobile permissions',
      description: 'Get mobile permission summaries for the authenticated user.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Mobile permission summaries',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MobilePermissionListResponse' },
            },
          },
        },
        401: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/mobile-permissions': {
    get: {
      tags: ['Mobile Permissions'],
      summary: 'Get wallet mobile permissions',
      description: 'Get effective mobile permissions for the authenticated user on a wallet. Owners also receive wallet user permission details.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: {
          description: 'Wallet mobile permissions',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WalletMobilePermissionsResponse' },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Mobile Permissions'],
      summary: 'Update own wallet mobile permissions',
      description: 'Restrict the authenticated user mobile permissions for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: permissionUpdateRequestBody,
      responses: {
        200: updateResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Mobile Permissions'],
      summary: 'Reset own wallet mobile permissions',
      description: 'Reset the authenticated user mobile permissions for a wallet to defaults.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: {
          description: 'Mobile permissions reset',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MobilePermissionResetResponse' },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/mobile-permissions/{userId}': {
    patch: {
      tags: ['Mobile Permissions'],
      summary: 'Set wallet user mobile permission caps',
      description: 'Owner-only route to set maximum mobile permissions for another wallet user.',
      security: bearerAuth,
      parameters: [walletIdParameter, userIdParameter],
      requestBody: permissionUpdateRequestBody,
      responses: {
        200: updateResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/mobile-permissions/{userId}/caps': {
    delete: {
      tags: ['Mobile Permissions'],
      summary: 'Clear wallet user mobile permission caps',
      description: 'Owner-only route to clear maximum mobile permission caps for another wallet user.',
      security: bearerAuth,
      parameters: [walletIdParameter, userIdParameter],
      responses: {
        200: updateResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
} as const;
