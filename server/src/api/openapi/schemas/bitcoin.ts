/**
 * Bitcoin OpenAPI Schemas
 *
 * Schema definitions for Bitcoin network operations, sync, and price.
 */

export const syncSchemas = {
  SyncResult: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      walletId: { type: 'string' },
      balance: { type: 'string' },
      unconfirmedBalance: { type: 'string' },
      transactionsFound: { type: 'integer' },
      newAddressesGenerated: { type: 'integer' },
      duration: { type: 'number' },
    },
    required: ['success', 'walletId', 'balance'],
  },
} as const;

export const bitcoinSchemas = {
  BitcoinStatus: {
    type: 'object',
    properties: {
      connected: { type: 'boolean' },
      server: { type: 'string' },
      protocol: { type: 'string' },
      blockHeight: { type: 'integer' },
      network: { type: 'string' },
      explorerUrl: { type: 'string' },
      confirmationThreshold: { type: 'integer' },
      deepConfirmationThreshold: { type: 'integer' },
      error: { type: 'string' },
      pool: {
        type: 'object',
        nullable: true,
        additionalProperties: true,
      },
    },
    required: ['connected'],
  },
  FeeEstimates: {
    type: 'object',
    properties: {
      fastest: { type: 'number' },
      halfHour: { type: 'number' },
      hour: { type: 'number' },
      economy: { type: 'number' },
      minimum: { type: 'number' },
      source: { type: 'string', enum: ['mempool', 'electrum'] },
    },
    required: ['fastest', 'halfHour', 'hour', 'economy', 'minimum', 'source'],
  },
  BroadcastRequest: {
    type: 'object',
    properties: {
      hex: { type: 'string', description: 'Signed transaction hex' },
      walletId: { type: 'string' },
    },
    required: ['hex', 'walletId'],
  },
  BroadcastResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      txid: { type: 'string' },
    },
    required: ['success', 'txid'],
  },
} as const;

export const priceSchemas = {
  Price: {
    type: 'object',
    properties: {
      price: { type: 'number' },
      currency: { type: 'string' },
      change24h: { type: 'number' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['price', 'currency', 'change24h', 'updatedAt'],
  },
} as const;
