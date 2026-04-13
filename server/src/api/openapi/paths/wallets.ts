/**
 * Wallet API Path Definitions
 *
 * OpenAPI path definitions for wallet management endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

export const walletPaths = {
  '/wallets': {
    get: {
      tags: ['Wallets'],
      summary: 'List wallets',
      description: 'Get all wallets for the authenticated user',
      security: bearerAuth,
      responses: {
        200: {
          description: 'List of wallets',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/Wallet' },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ['Wallets'],
      summary: 'Create wallet',
      description: 'Create a new wallet',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateWalletRequest' },
          },
        },
      },
      responses: {
        201: {
          description: 'Wallet created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Wallet' },
            },
          },
        },
      },
    },
  },
  '/wallets/{walletId}': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet',
      description: 'Get a specific wallet by ID',
      security: bearerAuth,
      parameters: [
        {
          name: 'walletId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: {
          description: 'Wallet details',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Wallet' },
            },
          },
        },
        404: {
          description: 'Wallet not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
    patch: {
      tags: ['Wallets'],
      summary: 'Update wallet',
      description: 'Update wallet properties',
      security: bearerAuth,
      parameters: [
        {
          name: 'walletId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateWalletRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Wallet updated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Wallet' },
            },
          },
        },
      },
    },
    delete: {
      tags: ['Wallets'],
      summary: 'Delete wallet',
      description: 'Delete a wallet (owner only)',
      security: bearerAuth,
      parameters: [
        {
          name: 'walletId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        204: {
          description: 'Wallet deleted',
        },
      },
    },
  },
  '/wallets/{walletId}/stats': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet stats',
      description: 'Get wallet statistics (balance, tx count, etc)',
      security: bearerAuth,
      parameters: [
        {
          name: 'walletId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: {
          description: 'Wallet statistics',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WalletStats' },
            },
          },
        },
      },
    },
  },
} as const;
