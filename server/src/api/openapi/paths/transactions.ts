/**
 * Transaction API Path Definitions
 *
 * OpenAPI path definitions for gateway-relevant transaction endpoints.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const txidParameter = {
  name: 'txid',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
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

export const transactionPaths = {
  '/wallets/{walletId}/transactions': {
    get: {
      tags: ['Transactions'],
      summary: 'List wallet transactions',
      description: 'Get paginated transactions for a wallet the user can view.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1 },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0 },
        },
      ],
      responses: {
        200: {
          description: 'Wallet transactions',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/Transaction' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/transactions/{txid}': {
    get: {
      tags: ['Transactions'],
      summary: 'Get transaction detail',
      description: 'Get a transaction by txid if it belongs to a wallet the user can access.',
      security: bearerAuth,
      parameters: [txidParameter],
      responses: {
        200: jsonResponse('Transaction detail', '#/components/schemas/Transaction'),
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/transactions/pending': {
    get: {
      tags: ['Transactions'],
      summary: 'List pending transactions',
      description: 'Get pending transactions across all wallets the user can access.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Pending transactions',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/PendingTransaction' },
              },
            },
          },
        },
        401: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/addresses/summary': {
    get: {
      tags: ['Transactions'],
      summary: 'Get wallet address summary',
      description: 'Get wallet address counts and balances.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Address summary', '#/components/schemas/AddressSummary'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/addresses': {
    get: {
      tags: ['Transactions'],
      summary: 'List wallet addresses',
      description: 'Get wallet addresses with balances, labels, and receive/change classification.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'used',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'change',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1 },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0 },
        },
      ],
      responses: {
        200: {
          description: 'Wallet addresses',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/WalletAddress' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/addresses/generate': {
    post: {
      tags: ['Transactions'],
      summary: 'Generate wallet addresses',
      description: 'Generate additional receive and change addresses for a descriptor wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GenerateAddressesRequest' },
          },
        },
      },
      responses: {
        200: jsonResponse('Generated address counts', '#/components/schemas/GenerateAddressesResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/utxos': {
    get: {
      tags: ['Transactions'],
      summary: 'List wallet UTXOs',
      description: 'Get unspent outputs for a wallet with draft lock and spendability metadata.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1 },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Wallet UTXOs', '#/components/schemas/UtxosResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/transactions/create': {
    post: {
      tags: ['Transactions'],
      summary: 'Create transaction PSBT',
      description: 'Create an unsigned PSBT for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/TransactionCreateRequest'),
      responses: {
        200: jsonResponse('Unsigned transaction PSBT', '#/components/schemas/TransactionCreateResponse'),
        400: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/transactions/estimate': {
    post: {
      tags: ['Transactions'],
      summary: 'Estimate transaction',
      description: 'Estimate transaction cost for a wallet the user can view.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/TransactionEstimateRequest'),
      responses: {
        200: jsonResponse('Transaction estimate', '#/components/schemas/TransactionEstimateResponse'),
        400: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/transactions/broadcast': {
    post: {
      tags: ['Transactions'],
      summary: 'Broadcast transaction',
      description: 'Broadcast a signed PSBT or raw transaction hex for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/TransactionBroadcastRequest'),
      responses: {
        200: jsonResponse('Broadcast result', '#/components/schemas/TransactionBroadcastResponse'),
        400: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/psbt/create': {
    post: {
      tags: ['Transactions'],
      summary: 'Create PSBT',
      description: 'Create an unsigned PSBT for hardware wallet signing.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/PsbtCreateRequest'),
      responses: {
        200: jsonResponse('Unsigned PSBT', '#/components/schemas/PsbtCreateResponse'),
        400: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/psbt/broadcast': {
    post: {
      tags: ['Transactions'],
      summary: 'Broadcast PSBT',
      description: 'Broadcast a signed PSBT for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/PsbtBroadcastRequest'),
      responses: {
        200: jsonResponse('Broadcast result', '#/components/schemas/PsbtBroadcastResponse'),
        400: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
} as const;
