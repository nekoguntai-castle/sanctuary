/**
 * Wallet OpenAPI Schemas
 *
 * Schema definitions for wallet management.
 */

export const walletSchemas = {
  Wallet: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string', enum: ['single_sig', 'multi_sig'] },
      scriptType: { type: 'string', enum: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] },
      network: { type: 'string', enum: ['mainnet', 'testnet', 'regtest', 'signet'] },
      quorum: { type: 'integer', nullable: true },
      totalSigners: { type: 'integer', nullable: true },
      descriptor: { type: 'string', nullable: true },
      balance: { type: 'string', description: 'Balance in satoshis as string' },
      unconfirmedBalance: { type: 'string', description: 'Unconfirmed balance in satoshis' },
      lastSynced: { type: 'string', format: 'date-time', nullable: true },
      syncStatus: { type: 'string', enum: ['synced', 'syncing', 'error', 'pending', 'never'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      role: { type: 'string', enum: ['owner', 'signer', 'viewer'] },
      deviceCount: { type: 'integer' },
      isShared: { type: 'boolean' },
      pendingConsolidation: { type: 'boolean' },
      pendingReceive: { type: 'boolean' },
      pendingSend: { type: 'boolean' },
      hasPendingDraft: { type: 'boolean' },
      group: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
    required: ['id', 'name', 'type', 'scriptType', 'network', 'balance', 'createdAt'],
  },
  CreateWalletRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      type: { type: 'string', enum: ['single_sig', 'multi_sig'] },
      scriptType: { type: 'string', enum: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] },
      network: { type: 'string', enum: ['mainnet', 'testnet', 'regtest', 'signet'] },
      quorum: { type: 'integer' },
      totalSigners: { type: 'integer' },
      descriptor: { type: 'string' },
      fingerprint: { type: 'string' },
      groupId: { type: 'string' },
      deviceIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'type', 'scriptType'],
  },
  UpdateWalletRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      descriptor: { type: 'string' },
    },
  },
  WalletStats: {
    type: 'object',
    properties: {
      balance: { type: 'number' },
      received: { type: 'number' },
      sent: { type: 'number' },
      transactionCount: { type: 'integer' },
      utxoCount: { type: 'integer' },
      addressCount: { type: 'integer' },
    },
    required: ['balance', 'received', 'sent', 'transactionCount', 'utxoCount', 'addressCount'],
  },
} as const;
