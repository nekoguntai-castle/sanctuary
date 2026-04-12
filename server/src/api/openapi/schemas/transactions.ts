/**
 * Transaction OpenAPI Schemas
 *
 * Schema definitions for gateway-relevant transaction routes.
 */

import { MOBILE_API_REQUEST_LIMITS } from '../../../../../shared/schemas/mobileApiRequests';

export const transactionSchemas = {
  UtxoReference: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      vout: { type: 'integer', minimum: 0 },
    },
    required: ['txid', 'vout'],
  },
  TransactionLabel: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      color: { type: 'string' },
      description: { type: 'string', nullable: true },
    },
    required: ['id', 'name', 'color'],
  },
  TransactionInput: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      transactionId: { type: 'string' },
      inputIndex: { type: 'integer', minimum: 0 },
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      vout: { type: 'integer', minimum: 0 },
      address: { type: 'string' },
      amount: { type: 'number', description: 'Amount in satoshis' },
      derivationPath: { type: 'string', nullable: true },
    },
    required: ['id', 'inputIndex', 'txid', 'vout', 'address', 'amount'],
  },
  TransactionOutput: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      transactionId: { type: 'string' },
      outputIndex: { type: 'integer', minimum: 0 },
      address: { type: 'string' },
      amount: { type: 'number', description: 'Amount in satoshis' },
      scriptPubKey: { type: 'string', nullable: true },
      outputType: {
        type: 'string',
        enum: ['recipient', 'change', 'decoy', 'consolidation', 'op_return', 'unknown'],
      },
      isOurs: { type: 'boolean' },
      label: { type: 'string', nullable: true },
    },
    required: ['id', 'outputIndex', 'address', 'amount', 'outputType', 'isOurs'],
  },
  Transaction: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      walletId: { type: 'string' },
      type: { type: 'string', enum: ['sent', 'received', 'consolidation', 'receive'] },
      amount: { type: 'number', description: 'Signed amount in satoshis' },
      fee: { type: 'number', nullable: true, description: 'Fee in satoshis' },
      balanceAfter: { type: 'number', nullable: true },
      confirmations: { type: 'integer' },
      blockHeight: { type: 'integer', nullable: true },
      blockTime: { type: 'string', format: 'date-time', nullable: true },
      label: { type: 'string', nullable: true },
      memo: { type: 'string', nullable: true },
      counterpartyAddress: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      wallet: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
        },
      },
      address: { type: 'object', nullable: true },
      labels: {
        type: 'array',
        items: { $ref: '#/components/schemas/TransactionLabel' },
      },
      inputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/TransactionInput' },
      },
      outputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/TransactionOutput' },
      },
    },
    required: ['id', 'txid', 'walletId', 'type', 'amount', 'confirmations', 'createdAt', 'updatedAt'],
  },
  PendingTransaction: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      walletId: { type: 'string' },
      walletName: { type: 'string' },
      type: { type: 'string' },
      amount: { type: 'number' },
      fee: { type: 'number' },
      size: { type: 'integer' },
      feeRate: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['txid', 'walletId', 'type', 'amount', 'fee', 'size', 'feeRate', 'createdAt'],
  },
  WalletAddress: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string' },
      address: { type: 'string' },
      derivationPath: { type: 'string' },
      index: { type: 'integer' },
      used: { type: 'boolean' },
      balance: { type: 'number', description: 'Address balance in satoshis' },
      isChange: { type: 'boolean' },
      labels: {
        type: 'array',
        items: { $ref: '#/components/schemas/TransactionLabel' },
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'walletId', 'address', 'derivationPath', 'index', 'used', 'balance', 'isChange'],
  },
  AddressSummary: {
    type: 'object',
    properties: {
      totalAddresses: { type: 'integer' },
      usedCount: { type: 'integer' },
      unusedCount: { type: 'integer' },
      totalBalance: { type: 'number' },
      usedBalance: { type: 'number' },
      unusedBalance: { type: 'number' },
    },
    required: ['totalAddresses', 'usedCount', 'unusedCount', 'totalBalance', 'usedBalance', 'unusedBalance'],
  },
  GenerateAddressesRequest: {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 1, default: 10 },
    },
  },
  GenerateAddressesResponse: {
    type: 'object',
    properties: {
      generated: { type: 'integer' },
      receiveAddresses: { type: 'integer' },
      changeAddresses: { type: 'integer' },
    },
    required: ['generated', 'receiveAddresses', 'changeAddresses'],
  },
  Utxo: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string' },
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      vout: { type: 'integer', minimum: 0 },
      address: { type: 'string' },
      amount: { type: 'number', description: 'Amount in satoshis' },
      confirmations: { type: 'integer' },
      blockHeight: { type: 'integer', nullable: true },
      frozen: { type: 'boolean' },
      spendable: { type: 'boolean' },
      lockedByDraftId: { type: 'string', nullable: true },
      lockedByDraftLabel: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'walletId', 'txid', 'vout', 'address', 'amount', 'confirmations', 'frozen', 'spendable', 'createdAt'],
  },
  UtxosResponse: {
    type: 'object',
    properties: {
      utxos: {
        type: 'array',
        items: { $ref: '#/components/schemas/Utxo' },
      },
      count: { type: 'integer' },
      totalBalance: { type: 'number' },
    },
    required: ['utxos', 'count', 'totalBalance'],
  },
  DecoyOutputsRequest: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      count: { type: 'integer', minimum: 0 },
    },
    required: ['enabled', 'count'],
  },
  TransactionCreateRequest: {
    type: 'object',
    properties: {
      recipient: { type: 'string' },
      amount: { type: 'number', minimum: 1 },
      feeRate: { type: 'number', minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate },
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
      enableRBF: { type: 'boolean', default: true },
      label: { type: 'string' },
      memo: { type: 'string' },
      sendMax: { type: 'boolean', default: false },
      subtractFees: { type: 'boolean', default: false },
      decoyOutputs: { $ref: '#/components/schemas/DecoyOutputsRequest' },
    },
    required: ['recipient', 'amount', 'feeRate'],
  },
  TransactionCreateResponse: {
    type: 'object',
    properties: {
      psbtBase64: { type: 'string' },
      fee: { type: 'number' },
      totalInput: { type: 'number' },
      totalOutput: { type: 'number' },
      changeAmount: { type: 'number' },
      changeAddress: { type: 'string' },
      utxos: {
        type: 'array',
        items: { $ref: '#/components/schemas/UtxoReference' },
      },
      inputPaths: { type: 'array', items: { type: 'string' } },
      effectiveAmount: { type: 'number' },
      decoyOutputs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            address: { type: 'string' },
            amount: { type: 'number' },
          },
          required: ['address', 'amount'],
        },
      },
      policyEvaluation: { type: 'object' },
    },
    required: ['psbtBase64', 'fee', 'totalInput', 'totalOutput', 'changeAmount', 'utxos'],
  },
  TransactionEstimateRequest: {
    type: 'object',
    properties: {
      recipient: { type: 'string' },
      amount: { type: 'number', minimum: 1 },
      feeRate: { type: 'number', minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate },
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['recipient', 'amount', 'feeRate'],
  },
  TransactionEstimateResponse: {
    type: 'object',
    properties: {
      fee: { type: 'number' },
      totalCost: { type: 'number' },
      inputCount: { type: 'integer' },
      outputCount: { type: 'integer' },
      changeAmount: { type: 'number' },
      sufficient: { type: 'boolean' },
      error: { type: 'string' },
    },
    required: ['fee', 'totalCost', 'inputCount', 'outputCount', 'changeAmount', 'sufficient'],
  },
  TransactionBroadcastRequest: {
    type: 'object',
    properties: {
      signedPsbtBase64: { type: 'string', minLength: 1 },
      rawTxHex: { type: 'string', minLength: 1 },
      recipient: { type: 'string' },
      amount: { type: 'number' },
      fee: { type: 'number' },
      label: { type: 'string' },
      memo: { type: 'string' },
      utxos: {
        type: 'array',
        items: { $ref: '#/components/schemas/UtxoReference' },
      },
    },
    anyOf: [
      { required: ['signedPsbtBase64'] },
      { required: ['rawTxHex'] },
    ],
  },
  TransactionBroadcastResponse: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      broadcasted: { type: 'boolean' },
    },
    required: ['txid', 'broadcasted'],
  },
  PsbtCreateRequest: {
    type: 'object',
    properties: {
      recipients: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            address: { type: 'string' },
            amount: { type: 'number', minimum: 1 },
          },
          required: ['address', 'amount'],
        },
      },
      feeRate: { type: 'number', minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate },
      utxoIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['recipients', 'feeRate'],
  },
  PsbtCreateResponse: {
    type: 'object',
    properties: {
      psbt: { type: 'string' },
      fee: { type: 'number' },
      inputPaths: { type: 'array', items: { type: 'string' } },
      totalInput: { type: 'number' },
      totalOutput: { type: 'number' },
      changeAmount: { type: 'number' },
      changeAddress: { type: 'string' },
      utxos: {
        type: 'array',
        items: { $ref: '#/components/schemas/UtxoReference' },
      },
    },
    required: ['psbt', 'fee', 'totalInput', 'totalOutput', 'changeAmount', 'utxos'],
  },
  PsbtBroadcastRequest: {
    type: 'object',
    properties: {
      signedPsbt: { type: 'string', minLength: 1 },
      label: { type: 'string' },
      memo: { type: 'string' },
    },
    required: ['signedPsbt'],
  },
  PsbtBroadcastResponse: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      broadcasted: { type: 'boolean' },
    },
    required: ['txid', 'broadcasted'],
  },
} as const;
