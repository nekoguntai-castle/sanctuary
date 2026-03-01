/**
 * Bitcoin API Path Definitions
 *
 * OpenAPI path definitions for Bitcoin network, sync, and price endpoints.
 */

export const syncPaths = {
  '/sync/wallet/{walletId}': {
    post: {
      tags: ['Sync'],
      summary: 'Sync wallet',
      description: 'Synchronize wallet with the blockchain',
      security: [{ bearerAuth: [] }],
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
          description: 'Sync complete',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SyncResult' },
            },
          },
        },
      },
    },
  },
} as const;

export const bitcoinPaths = {
  '/bitcoin/fees': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get fee estimates',
      description: 'Get current Bitcoin network fee estimates',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Fee estimates',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FeeEstimates' },
            },
          },
        },
      },
    },
  },
  '/bitcoin/broadcast': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Broadcast transaction',
      description: 'Broadcast a signed transaction to the network',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/BroadcastRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Transaction broadcast',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BroadcastResponse' },
            },
          },
        },
      },
    },
  },
} as const;

export const pricePaths = {
  '/price': {
    get: {
      tags: ['Price'],
      summary: 'Get BTC price',
      description: 'Get current Bitcoin price in USD',
      responses: {
        200: {
          description: 'Price data',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Price' },
            },
          },
        },
      },
    },
  },
} as const;
