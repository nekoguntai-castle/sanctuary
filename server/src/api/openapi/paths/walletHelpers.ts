/**
 * Wallet Helper API Path Definitions
 *
 * OpenAPI path definitions for wallet analytics and helper operations.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
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

export const walletHelperPaths = {
  '/wallets/{walletId}/balance-history': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet balance history',
      description: 'Get sampled wallet balance history data points for charts.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'timeframe',
          in: 'query',
          required: false,
          schema: {
            type: 'string',
            default: '1M',
            description: 'Common values are 1D, 1W, 1M, 1Y, and ALL.',
          },
        },
      ],
      responses: {
        200: jsonResponse('Wallet balance history', '#/components/schemas/WalletBalanceHistoryResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/devices': {
    post: {
      tags: ['Wallets'],
      summary: 'Add device to wallet',
      description: 'Attach a device to a wallet. Owner or signer access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/WalletAddDeviceRequest'),
      responses: {
        201: jsonResponse('Device added to wallet', '#/components/schemas/WalletMessageResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/repair': {
    post: {
      tags: ['Wallets'],
      summary: 'Repair wallet descriptor',
      description: 'Regenerate a missing wallet descriptor from attached devices. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet repair result', '#/components/schemas/WalletRepairResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
