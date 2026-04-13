/**
 * Transaction API Path Definitions
 *
 * OpenAPI path definitions for gateway-relevant transaction endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

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

const utxoIdParameter = {
  name: 'utxoId',
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
  '/transactions/{txid}/raw': {
    get: {
      tags: ['Transactions'],
      summary: 'Get raw transaction hex',
      description: 'Get raw transaction hex for hardware-wallet previous-transaction signing data.',
      security: bearerAuth,
      parameters: [txidParameter],
      responses: {
        200: jsonResponse('Raw transaction hex', '#/components/schemas/RawTransactionResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transactions/recent': {
    get: {
      tags: ['Transactions'],
      summary: 'List recent transactions',
      description: 'Get recent transactions across all wallets the user can access.',
      security: bearerAuth,
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
        {
          name: 'walletIds',
          in: 'query',
          required: false,
          schema: { type: 'string', description: 'Comma-separated wallet IDs to filter.' },
        },
      ],
      responses: {
        200: {
          description: 'Recent transactions',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/CrossWalletRecentTransaction' },
              },
            },
          },
        },
        401: apiErrorResponse,
        500: apiErrorResponse,
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
  '/transactions/balance-history': {
    get: {
      tags: ['Transactions'],
      summary: 'Get aggregate transaction balance history',
      description: 'Get balance-history chart data across all wallets the user can access.',
      security: bearerAuth,
      parameters: [
        {
          name: 'timeframe',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['1D', '1W', '1M', '1Y', 'ALL'], default: '1W' },
        },
        {
          name: 'totalBalance',
          in: 'query',
          required: false,
          schema: { type: 'number', default: 0 },
        },
        {
          name: 'walletIds',
          in: 'query',
          required: false,
          schema: { type: 'string', description: 'Comma-separated wallet IDs to filter.' },
        },
      ],
      responses: {
        200: {
          description: 'Balance history points',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/BalanceHistoryPoint' },
              },
            },
          },
        },
        401: apiErrorResponse,
        500: apiErrorResponse,
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
    post: {
      tags: ['Wallets'],
      summary: 'Generate wallet receiving address',
      description: 'Generate the next receiving address for a wallet. Owner or signer access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        201: jsonResponse('Generated receiving address', '#/components/schemas/WalletGeneratedAddressResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
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
  '/utxos/{utxoId}/freeze': {
    patch: {
      tags: ['Transactions'],
      summary: 'Freeze or unfreeze UTXO',
      description: 'Set a UTXO frozen flag after checking edit access to its wallet.',
      security: bearerAuth,
      parameters: [utxoIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UtxoFreezeRequest'),
      responses: {
        200: jsonResponse('UTXO freeze state updated', '#/components/schemas/UtxoFreezeResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/utxos/select': {
    post: {
      tags: ['Transactions'],
      summary: 'Select UTXOs',
      description: 'Select UTXOs for a target amount using a named strategy.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UtxoSelectionRequest'),
      responses: {
        200: jsonResponse('UTXO selection result', '#/components/schemas/UtxoSelectionResult'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/utxos/compare-strategies': {
    post: {
      tags: ['Transactions'],
      summary: 'Compare UTXO selection strategies',
      description: 'Compare all supported UTXO selection strategies for a target amount.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UtxoSelectionRequest'),
      responses: {
        200: jsonResponse('UTXO selection strategy comparison', '#/components/schemas/UtxoStrategyComparisonResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/utxos/recommended-strategy': {
    get: {
      tags: ['Transactions'],
      summary: 'Get recommended UTXO selection strategy',
      description: 'Get a UTXO selection strategy recommendation for current wallet context.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'feeRate',
          in: 'query',
          required: false,
          schema: { type: 'number', minimum: 1, default: 10 },
        },
        {
          name: 'prioritizePrivacy',
          in: 'query',
          required: false,
          schema: { type: 'boolean', default: false },
        },
      ],
      responses: {
        200: jsonResponse('Recommended selection strategy', '#/components/schemas/UtxoRecommendedStrategyResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
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
  '/wallets/{walletId}/transactions/batch': {
    post: {
      tags: ['Transactions'],
      summary: 'Create batch transaction PSBT',
      description: 'Create an unsigned PSBT with multiple outputs for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/TransactionBatchRequest'),
      responses: {
        200: jsonResponse('Unsigned batch transaction PSBT', '#/components/schemas/TransactionBatchResponse'),
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
  '/wallets/{walletId}/transactions/pending': {
    get: {
      tags: ['Transactions'],
      summary: 'List wallet pending transactions',
      description: 'Get pending transactions for one wallet with mempool fee-rate enrichment.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: {
          description: 'Wallet pending transactions',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/WalletPendingTransaction' },
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
  '/wallets/{walletId}/transactions/stats': {
    get: {
      tags: ['Transactions'],
      summary: 'Get wallet transaction stats',
      description: 'Get cached transaction count and aggregate amount statistics for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet transaction stats', '#/components/schemas/WalletTransactionStatsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/transactions/export': {
    get: {
      tags: ['Transactions'],
      summary: 'Export wallet transactions',
      description: 'Export wallet transactions as CSV or JSON over an optional date range.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'format',
          in: 'query',
          required: false,
          schema: { $ref: '#/components/schemas/TransactionExportFormat' },
        },
        {
          name: 'startDate',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'date' },
        },
        {
          name: 'endDate',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'date' },
        },
      ],
      responses: {
        200: {
          description: 'Transaction export',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/TransactionExportEntry' },
              },
            },
            'text/csv': {
              schema: { type: 'string' },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/transactions/recalculate': {
    post: {
      tags: ['Transactions'],
      summary: 'Recalculate wallet transaction balances',
      description: 'Recalculate running balanceAfter values for all wallet transactions.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet balances recalculated', '#/components/schemas/TransactionRecalculateResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
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
  '/wallets/{walletId}/privacy': {
    get: {
      tags: ['Transactions'],
      summary: 'Get wallet UTXO privacy analysis',
      description: 'Get privacy scores and summary recommendations for all wallet UTXOs.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet privacy analysis', '#/components/schemas/WalletPrivacyResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/utxos/{utxoId}/privacy': {
    get: {
      tags: ['Transactions'],
      summary: 'Get UTXO privacy score',
      description: 'Get privacy score for one UTXO after checking wallet access.',
      security: bearerAuth,
      parameters: [utxoIdParameter],
      responses: {
        200: jsonResponse('UTXO privacy score', '#/components/schemas/PrivacyScore'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/privacy/spend-analysis': {
    post: {
      tags: ['Transactions'],
      summary: 'Analyze spend privacy',
      description: 'Analyze privacy impact of spending selected wallet UTXOs together.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/SpendPrivacyRequest'),
      responses: {
        200: jsonResponse('Spend privacy analysis', '#/components/schemas/SpendPrivacyResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
