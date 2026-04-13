/**
 * Wallet Export API Path Definitions
 *
 * OpenAPI path definitions for wallet and label export endpoints.
 */

import { WALLET_EXPORT_FORMAT_VALUES } from '../../../services/export/types';
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

const textFileSchema = {
  type: 'string',
  description: 'File download content',
} as const;

export const walletExportPaths = {
  '/wallets/{walletId}/export/labels': {
    get: {
      tags: ['Wallets'],
      summary: 'Export wallet labels',
      description: 'Export wallet labels in BIP 329 JSON Lines format.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: {
          description: 'BIP 329 JSON Lines label export',
          content: {
            'application/jsonl': {
              schema: textFileSchema,
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/export/formats': {
    get: {
      tags: ['Wallets'],
      summary: 'List wallet export formats',
      description: 'Get export formats available for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: {
          description: 'Wallet export formats',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WalletExportFormatsResponse' },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/export': {
    get: {
      tags: ['Wallets'],
      summary: 'Export wallet',
      description: 'Export wallet data in a supported external wallet format.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'format',
          in: 'query',
          required: false,
          schema: {
            type: 'string',
            enum: [...WALLET_EXPORT_FORMAT_VALUES],
            default: 'sparrow',
          },
        },
      ],
      responses: {
        200: {
          description: 'Wallet export file',
          content: {
            'application/json': {
              schema: textFileSchema,
            },
            'text/plain': {
              schema: textFileSchema,
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
