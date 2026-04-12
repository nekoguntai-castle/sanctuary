/**
 * Bitcoin API Path Definitions
 *
 * OpenAPI path definitions for Bitcoin network, sync, and price endpoints.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;

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

const currencyQueryParameter = {
  name: 'currency',
  in: 'query',
  required: false,
  schema: { type: 'string', default: 'USD' },
} as const;

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
