/**
 * Bitcoin API Path Definitions
 *
 * OpenAPI path definitions for Bitcoin network, sync, and price endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

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

const optionalJsonRequestBody = (schemaRef: string) => ({
  required: false,
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

const currencyQueryParameter = {
  name: 'currency',
  in: 'query',
  required: false,
  schema: { type: 'string', default: 'USD' },
} as const;

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const syncNetworkParameter = {
  name: 'network',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: ['mainnet', 'testnet', 'signet'] },
} as const;

const txidParameter = {
  name: 'txid',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const addressNetworkQueryParameter = {
  name: 'network',
  in: 'query',
  required: false,
  schema: { type: 'string', enum: ['mainnet', 'testnet', 'regtest'], default: 'mainnet' },
} as const;

export const syncPaths = {
  '/sync/wallet/{walletId}': {
    post: {
      tags: ['Sync'],
      summary: 'Sync wallet',
      description: 'Synchronize a wallet immediately with the blockchain.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Sync complete', '#/components/schemas/SyncResult'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/queue/{walletId}': {
    post: {
      tags: ['Sync'],
      summary: 'Queue wallet sync',
      description: 'Queue a wallet for background synchronization.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: optionalJsonRequestBody('#/components/schemas/SyncPriorityRequest'),
      responses: {
        200: jsonResponse('Wallet queued for sync', '#/components/schemas/QueuedWalletSyncResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/status/{walletId}': {
    get: {
      tags: ['Sync'],
      summary: 'Get wallet sync status',
      description: 'Get current queued/in-progress sync state for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet sync status', '#/components/schemas/WalletSyncStatus'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/logs/{walletId}': {
    get: {
      tags: ['Sync'],
      summary: 'Get wallet sync logs',
      description: 'Get buffered in-memory sync logs for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet sync logs', '#/components/schemas/WalletSyncLogsResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/user': {
    post: {
      tags: ['Sync'],
      summary: 'Queue all user wallets',
      description: 'Queue all wallets owned or accessible by the authenticated user for background sync.',
      security: bearerAuth,
      requestBody: optionalJsonRequestBody('#/components/schemas/SyncPriorityRequest'),
      responses: {
        200: jsonResponse('User wallets queued for sync', '#/components/schemas/SyncSimpleSuccessResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/reset/{walletId}': {
    post: {
      tags: ['Sync'],
      summary: 'Reset wallet sync state',
      description: 'Reset a stuck wallet sync state flag.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet sync state reset', '#/components/schemas/SyncSimpleSuccessResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/resync/{walletId}': {
    post: {
      tags: ['Sync'],
      summary: 'Full wallet resync',
      description: 'Clear transactions and queue a high-priority full resync for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Full wallet resync queued', '#/components/schemas/ResyncWalletResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/network/{network}': {
    post: {
      tags: ['Sync'],
      summary: 'Queue network sync',
      description: 'Queue all authenticated-user wallets on a supported network for background sync.',
      security: bearerAuth,
      parameters: [syncNetworkParameter],
      requestBody: optionalJsonRequestBody('#/components/schemas/SyncPriorityRequest'),
      responses: {
        200: jsonResponse('Network wallets queued for sync', '#/components/schemas/NetworkSyncResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/network/{network}/resync': {
    post: {
      tags: ['Sync'],
      summary: 'Full network resync',
      description: 'Clear transactions and queue high-priority resync for all authenticated-user wallets on a network.',
      security: bearerAuth,
      parameters: [
        syncNetworkParameter,
        {
          name: 'X-Confirm-Resync',
          in: 'header',
          required: true,
          schema: { type: 'string', enum: ['true'] },
        },
      ],
      responses: {
        200: jsonResponse('Full network resync queued', '#/components/schemas/NetworkResyncResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/sync/network/{network}/status': {
    get: {
      tags: ['Sync'],
      summary: 'Get network sync status',
      description: 'Get aggregate sync state for authenticated-user wallets on a network.',
      security: bearerAuth,
      parameters: [syncNetworkParameter],
      responses: {
        200: jsonResponse('Network sync status', '#/components/schemas/NetworkSyncStatusResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;

export const bitcoinPaths = {
  '/bitcoin/status': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get Bitcoin status',
      description: 'Get Bitcoin node and network status with graceful degradation when unavailable',
      responses: {
        200: {
          description: 'Bitcoin status',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BitcoinStatus' },
            },
          },
        },
      },
    },
  },
  '/bitcoin/mempool': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get mempool dashboard data',
      description: 'Get recent confirmed blocks, projected mempool blocks, and mempool summary data.',
      responses: {
        200: jsonResponse('Mempool dashboard data', '#/components/schemas/BitcoinMempoolResponse'),
        500: jsonResponse('Mempool fetch failed', '#/components/schemas/BitcoinSimpleErrorResponse'),
      },
    },
  },
  '/bitcoin/blocks/recent': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get recent blocks',
      description: 'Get recent confirmed blocks from the configured mempool data source.',
      parameters: [
        {
          name: 'count',
          in: 'query',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 10,
          },
        },
      ],
      responses: {
        200: {
          description: 'Recent blocks',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/BitcoinRecentBlock' },
              },
            },
          },
        },
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/block/{height}': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get block header',
      description: 'Get a block header by non-negative block height from the configured Electrum server.',
      parameters: [
        {
          name: 'height',
          in: 'path',
          required: true,
          schema: { type: 'integer', minimum: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Block header', '#/components/schemas/BitcoinBlockHeader'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/fees': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get fee estimates',
      description: 'Get current Bitcoin network fee estimates',
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
  '/bitcoin/fees/advanced': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get advanced fee estimates',
      description: 'Get fee estimates with confirmation-target block and minute predictions.',
      responses: {
        200: jsonResponse('Advanced fee estimates', '#/components/schemas/AdvancedFeeEstimates'),
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/utils/estimate-fee': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Estimate transaction fee',
      description: 'Estimate transaction virtual size and absolute fee from input/output counts and a fee rate.',
      requestBody: jsonRequestBody('#/components/schemas/EstimateFeeRequest'),
      responses: {
        200: jsonResponse('Fee estimate', '#/components/schemas/EstimateFeeResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/utils/estimate-optimal-fee': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Estimate optimal transaction fee',
      description: 'Estimate transaction fee using priority and script-type defaults.',
      requestBody: jsonRequestBody('#/components/schemas/EstimateOptimalFeeRequest'),
      responses: {
        200: jsonResponse('Optimal fee estimate', '#/components/schemas/EstimateOptimalFeeResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/address/validate': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Validate Bitcoin address',
      description: 'Validate a Bitcoin address and optionally fetch balance/count details.',
      requestBody: jsonRequestBody('#/components/schemas/AddressValidationRequest'),
      responses: {
        200: jsonResponse('Address validation result', '#/components/schemas/AddressValidationResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/address/{address}': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get Bitcoin address info',
      description: 'Validate an address and return address type, balance, and transaction count.',
      parameters: [
        {
          name: 'address',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        addressNetworkQueryParameter,
      ],
      responses: {
        200: jsonResponse('Address info', '#/components/schemas/AddressInfoResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/address/{addressId}/sync': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Sync address',
      description: 'Synchronize one wallet address after checking authenticated wallet access.',
      security: bearerAuth,
      parameters: [
        {
          name: 'addressId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: jsonResponse('Address sync result', '#/components/schemas/AddressSyncResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/address-lookup': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Look up owned addresses',
      description: 'Look up which accessible wallets own a batch of addresses.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AddressLookupRequest'),
      responses: {
        200: jsonResponse('Address ownership lookup', '#/components/schemas/AddressLookupResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/transaction/{txid}': {
    get: {
      tags: ['Bitcoin'],
      summary: 'Get Bitcoin transaction details',
      description: 'Get transaction details from the configured blockchain data source.',
      parameters: [txidParameter],
      responses: {
        200: jsonResponse('Transaction details', '#/components/schemas/BitcoinTransactionDetails'),
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/broadcast': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Broadcast transaction',
      description: 'Broadcast a signed transaction to the network',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/BroadcastRequest'),
      responses: {
        200: {
          description: 'Transaction broadcast',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BroadcastResponse' },
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/transaction/{txid}/rbf-check': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Check RBF replacement eligibility',
      description: 'Check whether a transaction can be replaced with Replace-By-Fee.',
      security: bearerAuth,
      parameters: [txidParameter],
      responses: {
        200: jsonResponse('RBF eligibility result', '#/components/schemas/RbfCheckResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/transaction/{txid}/rbf': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Create RBF replacement transaction',
      description: 'Create a PSBT for an RBF replacement transaction after checking wallet edit access.',
      security: bearerAuth,
      parameters: [txidParameter],
      requestBody: jsonRequestBody('#/components/schemas/RbfRequest'),
      responses: {
        200: jsonResponse('RBF replacement PSBT', '#/components/schemas/RbfResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/transaction/cpfp': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Create CPFP child transaction',
      description: 'Create a Child-Pays-For-Parent PSBT after checking wallet edit access.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/CpfpRequest'),
      responses: {
        200: jsonResponse('CPFP PSBT', '#/components/schemas/CpfpResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/transaction/batch': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Create batch transaction',
      description: 'Create a PSBT that sends to multiple recipients after checking wallet edit access.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/BatchTransactionRequest'),
      responses: {
        200: jsonResponse('Batch transaction PSBT', '#/components/schemas/BatchTransactionResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/wallet/{walletId}/sync': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Legacy wallet sync',
      description: 'Synchronize a wallet through the legacy Bitcoin sync route after checking wallet access.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Legacy wallet sync result', '#/components/schemas/BitcoinLegacyWalletSyncResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/bitcoin/wallet/{walletId}/update-confirmations': {
    post: {
      tags: ['Bitcoin'],
      summary: 'Update wallet confirmations',
      description: 'Update transaction confirmations for a wallet after checking wallet access.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Confirmation update result', '#/components/schemas/BitcoinUpdateConfirmationsResponse'),
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/node/test': {
    post: {
      tags: ['Node'],
      summary: 'Test Electrum server connection',
      description: 'Test connectivity to an Electrum server with tcp or ssl protocol.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/NodeConnectionTestRequest'),
      responses: {
        200: jsonResponse('Node connection test result', '#/components/schemas/NodeConnectionTestResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;

export const pricePaths = {
  '/price': {
    get: {
      tags: ['Price'],
      summary: 'Get BTC price',
      description: 'Get the current aggregated Bitcoin price.',
      parameters: [
        currencyQueryParameter,
        {
          name: 'useCache',
          in: 'query',
          required: false,
          schema: { type: 'boolean', default: true },
        },
      ],
      responses: {
        200: jsonResponse('Price data', '#/components/schemas/Price'),
        500: apiErrorResponse,
      },
    },
  },
  '/price/multiple': {
    get: {
      tags: ['Price'],
      summary: 'Get multiple BTC prices',
      description: 'Get aggregated Bitcoin prices for a comma-separated list of fiat currencies.',
      parameters: [
        {
          name: 'currencies',
          in: 'query',
          required: true,
          schema: { type: 'string', example: 'USD,EUR,GBP' },
        },
      ],
      responses: {
        200: jsonResponse('Price data keyed by currency', '#/components/schemas/PriceMultipleResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/price/from/{provider}': {
    get: {
      tags: ['Price'],
      summary: 'Get BTC price from provider',
      description: 'Get the current Bitcoin price from a specific configured provider.',
      parameters: [
        {
          name: 'provider',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        currencyQueryParameter,
      ],
      responses: {
        200: jsonResponse('Provider price data', '#/components/schemas/PriceSource'),
        500: apiErrorResponse,
      },
    },
  },
  '/price/convert/to-fiat': {
    post: {
      tags: ['Price'],
      summary: 'Convert sats to fiat',
      description: 'Convert satoshis to a fiat amount using the current Bitcoin price.',
      requestBody: jsonRequestBody('#/components/schemas/PriceConvertToFiatRequest'),
      responses: {
        200: jsonResponse('Fiat conversion result', '#/components/schemas/PriceConvertToFiatResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/price/convert/to-sats': {
    post: {
      tags: ['Price'],
      summary: 'Convert fiat to sats',
      description: 'Convert a fiat amount to satoshis using the current Bitcoin price.',
      requestBody: jsonRequestBody('#/components/schemas/PriceConvertToSatsRequest'),
      responses: {
        200: jsonResponse('Satoshi conversion result', '#/components/schemas/PriceConvertToSatsResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/price/currencies': {
    get: {
      tags: ['Price'],
      summary: 'List price currencies',
      description: 'List fiat currencies supported by the configured price providers.',
      responses: {
        200: jsonResponse('Supported currencies', '#/components/schemas/PriceCurrencyListResponse'),
      },
    },
  },
  '/price/providers': {
    get: {
      tags: ['Price'],
      summary: 'List price providers',
      description: 'List configured Bitcoin price providers.',
      responses: {
        200: jsonResponse('Configured price providers', '#/components/schemas/PriceProviderListResponse'),
      },
    },
  },
  '/price/health': {
    get: {
      tags: ['Price'],
      summary: 'Check price provider health',
      description: 'Check whether at least one configured price provider is healthy.',
      responses: {
        200: jsonResponse('Price provider health', '#/components/schemas/PriceHealthResponse'),
        500: apiErrorResponse,
      },
    },
  },
  '/price/cache/stats': {
    get: {
      tags: ['Price'],
      summary: 'Get price cache statistics',
      description: 'Admin-only price cache statistics.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Price cache statistics', '#/components/schemas/PriceCacheStats'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/price/cache/clear': {
    post: {
      tags: ['Price'],
      summary: 'Clear price cache',
      description: 'Admin-only request to clear cached price entries.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Price cache cleared', '#/components/schemas/PriceCacheClearResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/price/cache/duration': {
    post: {
      tags: ['Price'],
      summary: 'Set price cache duration',
      description: 'Admin-only request to set the price cache duration in milliseconds.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/PriceCacheDurationRequest'),
      responses: {
        200: jsonResponse('Price cache duration updated', '#/components/schemas/PriceCacheDurationResponse'),
        400: jsonResponse('Invalid cache duration', '#/components/schemas/PriceSimpleErrorResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/price/historical': {
    get: {
      tags: ['Price'],
      summary: 'Get historical BTC price',
      description: 'Get the historical Bitcoin price for a specific date.',
      parameters: [
        {
          name: 'date',
          in: 'query',
          required: true,
          schema: { type: 'string', example: '2026-04-12' },
        },
        currencyQueryParameter,
      ],
      responses: {
        200: jsonResponse('Historical price data', '#/components/schemas/PriceHistoricalResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/price/history': {
    get: {
      tags: ['Price'],
      summary: 'Get BTC price history',
      description: 'Get Bitcoin price history for a bounded day window.',
      parameters: [
        {
          name: 'days',
          in: 'query',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 365,
            default: 30,
          },
        },
        currencyQueryParameter,
      ],
      responses: {
        200: jsonResponse('Price history data', '#/components/schemas/PriceHistoryResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
