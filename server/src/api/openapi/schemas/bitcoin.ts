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
  FeeEstimates: {
    type: 'object',
    properties: {
      fastest: { type: 'number' },
      fast: { type: 'number' },
      medium: { type: 'number' },
      slow: { type: 'number' },
      minimum: { type: 'number' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['fastest', 'fast', 'medium', 'slow', 'minimum', 'updatedAt'],
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
