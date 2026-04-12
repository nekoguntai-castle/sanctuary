/**
 * Wallet Sharing API Path Definitions
 *
 * OpenAPI path definitions for wallet user and group sharing endpoints.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const targetUserIdParameter = {
  name: 'targetUserId',
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

export const walletSharingPaths = {
  '/wallets/{walletId}/share': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet sharing info',
      description: 'Get group and user sharing details for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet sharing details', '#/components/schemas/WalletSharingInfo'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/share/group': {
    post: {
      tags: ['Wallets'],
      summary: 'Share wallet with a group',
      description: 'Assign or remove a wallet group share. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/WalletShareGroupRequest'),
      responses: {
        200: jsonResponse('Wallet group sharing updated', '#/components/schemas/WalletShareGroupResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/share/user': {
    post: {
      tags: ['Wallets'],
      summary: 'Share wallet with a user',
      description: 'Grant or update direct wallet access for a user. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/WalletShareUserRequest'),
      responses: {
        201: jsonResponse('User added to wallet', '#/components/schemas/WalletShareUserResponse'),
        200: jsonResponse('User access updated', '#/components/schemas/WalletShareUserResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/share/user/{targetUserId}': {
    delete: {
      tags: ['Wallets'],
      summary: 'Remove wallet user access',
      description: 'Remove a non-owner user from a wallet. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter, targetUserIdParameter],
      responses: {
        200: jsonResponse('User removed from wallet', '#/components/schemas/WalletShareUserResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
