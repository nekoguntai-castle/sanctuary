/**
 * Transaction OpenAPI Schemas
 *
 * Schema definitions for gateway-relevant transaction routes.
 */

import { MOBILE_API_REQUEST_LIMITS } from '@sanctuary/shared/schemas/mobileApiRequests';
import {
  UTXO_SELECTION_STRATEGIES,
  PENDING_TRANSACTION_TYPES,
  PRIVACY_GRADES,
  PUBLIC_TRANSACTION_TYPES,
} from '@sanctuary/shared/constants/transactions';

const SAFE_SATOSHI_INTEGER_PATTERN = '^(?:0*[1-9]\\d{0,14}|0*[1-8]\\d{15}|0*900719925474099[0-1])$';
const safeSatoshiAmountInput = {
  oneOf: [
    { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    {
      type: 'string',
      pattern: SAFE_SATOSHI_INTEGER_PATTERN,
      description: 'Positive safe integer amount in satoshis.',
    },
  ],
} as const;

const utxoFeeRateInput = {
  oneOf: [
    { type: 'number', minimum: 1 },
    { type: 'string', minLength: 1 },
  ],
} as const;

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
      type: { type: 'string', enum: [...PUBLIC_TRANSACTION_TYPES] },
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
      count: { type: 'integer', minimum: 0, maximum: 1000, default: 10 },
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
      feeRate: {
        type: 'number',
        minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate,
        maximum: MOBILE_API_REQUEST_LIMITS.maxFeeRate,
      },
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
      signingContext: { $ref: '#/components/schemas/PsbtSigningContext' },
      intentId: { type: 'string' },
      intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
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
    required: ['psbtBase64', 'signingContext', 'intentId', 'intentDigest', 'fee', 'totalInput', 'totalOutput', 'changeAmount', 'utxos'],
  },
  TransactionBatchOutput: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: { type: 'number', minimum: 1 },
      sendMax: { type: 'boolean', default: false },
    },
    required: ['address'],
    additionalProperties: false,
  },
  TransactionBatchRequest: {
    type: 'object',
    properties: {
      outputs: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/components/schemas/TransactionBatchOutput' },
      },
      feeRate: {
        type: 'number',
        minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate,
        maximum: MOBILE_API_REQUEST_LIMITS.maxFeeRate,
      },
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
      enableRBF: { type: 'boolean', default: true },
      label: { type: 'string' },
      memo: { type: 'string' },
    },
    required: ['outputs', 'feeRate'],
    additionalProperties: false,
  },
  TransactionBatchResponse: {
    type: 'object',
    properties: {
      psbtBase64: { type: 'string' },
      signingContext: { $ref: '#/components/schemas/PsbtSigningContext' },
      intentId: { type: 'string' },
      intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
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
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
      },
      policyEvaluation: { type: 'object' },
    },
    required: ['psbtBase64', 'signingContext', 'intentId', 'intentDigest', 'fee', 'totalInput', 'totalOutput', 'changeAmount', 'utxos', 'outputs'],
  },
  TransactionEstimateRequest: {
    type: 'object',
    properties: {
      recipient: { type: 'string' },
      amount: { type: 'number', minimum: 1 },
      feeRate: {
        type: 'number',
        minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate,
        maximum: MOBILE_API_REQUEST_LIMITS.maxFeeRate,
      },
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
      draftId: { type: 'string', minLength: 1 },
      intentId: { type: 'string', minLength: 1 },
      intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
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
      { required: ['draftId'] },
    ],
    not: {
      required: ['signedPsbtBase64', 'rawTxHex'],
    },
  },
  TransactionBroadcastResponse: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      broadcasted: { type: 'boolean' },
      persistenceStatus: { type: 'string', enum: ['complete', 'pending_reconciliation'] },
      persistenceReason: { type: 'string', enum: ['post_acceptance_persistence_race'] },
    },
    required: ['txid', 'broadcasted', 'persistenceStatus'],
  },
  PsbtCreateRequest: {
    type: 'object',
    properties: {
      recipients: {
        type: 'array',
        minItems: 1,
        maxItems: 1,
        items: {
          type: 'object',
          properties: {
            address: { type: 'string' },
            amount: { type: 'number', minimum: 1 },
          },
          required: ['address', 'amount'],
        },
      },
      feeRate: {
        type: 'number',
        minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate,
        maximum: MOBILE_API_REQUEST_LIMITS.maxFeeRate,
      },
      utxoIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['recipients', 'feeRate'],
  },
  PsbtCreateResponse: {
    type: 'object',
    properties: {
      psbt: { type: 'string' },
      signingContext: { $ref: '#/components/schemas/PsbtSigningContext' },
      intentId: { type: 'string' },
      intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
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
    required: ['psbt', 'signingContext', 'intentId', 'intentDigest', 'fee', 'totalInput', 'totalOutput', 'changeAmount', 'utxos'],
  },
  PsbtBroadcastRequest: {
    type: 'object',
    properties: {
      signedPsbt: { type: 'string', minLength: 1 },
      intentId: { type: 'string', minLength: 1 },
      intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      label: { type: 'string' },
      memo: { type: 'string' },
    },
    required: ['signedPsbt', 'intentId', 'intentDigest'],
  },
  PsbtBroadcastResponse: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      broadcasted: { type: 'boolean' },
      persistenceStatus: { type: 'string', enum: ['complete', 'pending_reconciliation'] },
      persistenceReason: { type: 'string', enum: ['post_acceptance_persistence_race'] },
    },
    required: ['txid', 'broadcasted', 'persistenceStatus'],
  },
  RawTransactionResponse: {
    type: 'object',
    properties: {
      hex: { type: 'string' },
    },
    required: ['hex'],
  },
  CrossWalletRecentTransaction: {
    allOf: [
      { $ref: '#/components/schemas/Transaction' },
      {
        type: 'object',
        properties: {
          walletName: { type: 'string' },
          isFrozen: { type: 'boolean' },
          isLocked: { type: 'boolean' },
          lockedByDraftLabel: { type: 'string' },
        },
      },
    ],
  },
  BalanceHistoryPoint: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      value: { type: 'number' },
    },
    required: ['name', 'value'],
  },
  ActivitySummary: {
    type: 'object',
    properties: {
      count: { type: 'integer', description: 'Confirmed transactions in the period.' },
      receivedSats: {
        type: 'number',
        description: 'Total received in the period, as a positive magnitude.',
      },
      sentSats: {
        type: 'number',
        description:
          'Total sent in the period, as a positive magnitude. Never netted against receivedSats — a period that received and spent the same amount is not an empty period.',
      },
      latestAt: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description: 'Block time of the most recent confirmed transaction, or null.',
      },
    },
    required: ['count', 'receivedSats', 'sentSats', 'latestAt'],
  },
  WalletPendingTransaction: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      walletId: { type: 'string' },
      walletName: { type: 'string' },
      type: { type: 'string', enum: [...PENDING_TRANSACTION_TYPES] },
      amount: { type: 'number' },
      fee: { type: 'number' },
      feeRate: { type: 'number' },
      vsize: { type: 'integer' },
      recipient: { type: 'string' },
      timeInQueue: { type: 'integer', minimum: 0 },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['txid', 'walletId', 'type', 'amount', 'fee', 'feeRate', 'timeInQueue', 'createdAt'],
  },
  WalletTransactionStatsResponse: {
    type: 'object',
    properties: {
      totalCount: { type: 'integer', minimum: 0 },
      receivedCount: { type: 'integer', minimum: 0 },
      sentCount: { type: 'integer', minimum: 0 },
      consolidationCount: { type: 'integer', minimum: 0 },
      totalReceived: { type: 'number' },
      totalSent: { type: 'number' },
      totalFees: { type: 'number' },
      walletBalance: { type: 'number' },
    },
    required: [
      'totalCount',
      'receivedCount',
      'sentCount',
      'consolidationCount',
      'totalReceived',
      'totalSent',
      'totalFees',
      'walletBalance',
    ],
  },
  TransactionExportFormat: {
    type: 'string',
    enum: ['csv', 'json'],
  },
  TransactionExportEntry: {
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date-time' },
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      type: { type: 'string' },
      amountBtc: { type: 'number' },
      amountSats: { type: 'number' },
      balanceAfterBtc: { type: 'number', nullable: true },
      balanceAfterSats: { type: 'number', nullable: true },
      feeSats: { type: 'number', nullable: true },
      confirmations: { type: 'integer' },
      label: { type: 'string' },
      memo: { type: 'string' },
      counterpartyAddress: { type: 'string' },
      blockHeight: { type: 'integer', nullable: true },
    },
    required: ['date', 'txid', 'type', 'amountBtc', 'amountSats', 'confirmations'],
  },
  TransactionRecalculateResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string' },
      finalBalance: { type: 'number' },
      finalBalanceBtc: { type: 'number' },
    },
    required: ['success', 'message', 'finalBalance', 'finalBalanceBtc'],
  },
  UtxoFreezeRequest: {
    type: 'object',
    properties: {
      frozen: { type: 'boolean' },
    },
    required: ['frozen'],
    additionalProperties: false,
  },
  UtxoFreezeResponse: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      vout: { type: 'integer', minimum: 0 },
      frozen: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['id', 'txid', 'vout', 'frozen', 'message'],
  },
  UtxoSelectionStrategy: {
    type: 'string',
    enum: UTXO_SELECTION_STRATEGIES,
  },
  UtxoSelectionRequest: {
    type: 'object',
    properties: {
      amount: safeSatoshiAmountInput,
      feeRate: utxoFeeRateInput,
      strategy: { $ref: '#/components/schemas/UtxoSelectionStrategy' },
      scriptType: { type: 'string', minLength: 1 },
    },
    required: ['amount', 'feeRate'],
    additionalProperties: false,
  },
  UtxoCompareStrategiesRequest: {
    type: 'object',
    properties: {
      amount: safeSatoshiAmountInput,
      feeRate: utxoFeeRateInput,
      scriptType: { type: 'string', minLength: 1 },
    },
    required: ['amount', 'feeRate'],
    additionalProperties: false,
  },
  UtxoSelectionResult: {
    type: 'object',
    properties: {
      selected: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            txid: { type: 'string' },
            vout: { type: 'integer', minimum: 0 },
            address: { type: 'string' },
            amount: { type: 'number' },
            confirmations: { type: 'integer' },
          },
        },
      },
      totalAmount: { type: 'number' },
      estimatedFee: { type: 'number' },
      changeAmount: { type: 'number' },
      inputCount: { type: 'integer', minimum: 0 },
      strategy: { $ref: '#/components/schemas/UtxoSelectionStrategy' },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
      privacyImpact: {
        type: 'object',
        additionalProperties: true,
      },
    },
    required: ['selected', 'totalAmount', 'estimatedFee', 'changeAmount', 'inputCount', 'strategy', 'warnings'],
  },
  UtxoStrategyComparisonResponse: {
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/UtxoSelectionResult' },
  },
  UtxoRecommendedStrategyResponse: {
    type: 'object',
    properties: {
      strategy: { $ref: '#/components/schemas/UtxoSelectionStrategy' },
      reason: { type: 'string' },
      utxoCount: { type: 'integer', minimum: 0 },
      feeRate: { type: 'number' },
    },
    required: ['strategy', 'reason', 'utxoCount', 'feeRate'],
  },
  PrivacyGrade: {
    type: 'string',
    enum: PRIVACY_GRADES,
  },
  PrivacyFactor: {
    type: 'object',
    properties: {
      factor: { type: 'string' },
      impact: { type: 'number' },
      description: { type: 'string' },
    },
    required: ['factor', 'impact', 'description'],
  },
  PrivacyScore: {
    type: 'object',
    properties: {
      score: { type: 'number', minimum: 0, maximum: 100 },
      grade: { $ref: '#/components/schemas/PrivacyGrade' },
      factors: {
        type: 'array',
        items: { $ref: '#/components/schemas/PrivacyFactor' },
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['score', 'grade', 'factors', 'warnings'],
    additionalProperties: true,
  },
  UtxoPrivacyInfo: {
    type: 'object',
    properties: {
      utxoId: { type: 'string' },
      txid: { type: 'string' },
      vout: { type: 'integer', minimum: 0 },
      amount: { type: 'number' },
      address: { type: 'string' },
      score: { $ref: '#/components/schemas/PrivacyScore' },
    },
    required: ['utxoId', 'txid', 'vout', 'amount', 'address', 'score'],
    additionalProperties: true,
  },
  WalletPrivacySummary: {
    type: 'object',
    properties: {
      averageScore: { type: 'number', minimum: 0, maximum: 100 },
      grade: { $ref: '#/components/schemas/PrivacyGrade' },
      utxoCount: { type: 'integer', minimum: 0 },
      addressReuseCount: { type: 'integer', minimum: 0 },
      roundAmountCount: { type: 'integer', minimum: 0 },
      clusterCount: { type: 'integer', minimum: 0 },
      recommendations: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['averageScore', 'grade', 'utxoCount', 'addressReuseCount', 'roundAmountCount', 'clusterCount', 'recommendations'],
    additionalProperties: true,
  },
  WalletPrivacyResponse: {
    type: 'object',
    properties: {
      utxos: {
        type: 'array',
        items: { $ref: '#/components/schemas/UtxoPrivacyInfo' },
      },
      summary: { $ref: '#/components/schemas/WalletPrivacySummary' },
    },
    required: ['utxos', 'summary'],
  },
  SpendPrivacyRequest: {
    type: 'object',
    properties: {
      utxoIds: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' },
      },
    },
    required: ['utxoIds'],
    additionalProperties: false,
  },
  SpendPrivacyResponse: {
    type: 'object',
    properties: {
      score: { type: 'number', minimum: 0, maximum: 100 },
      grade: { $ref: '#/components/schemas/PrivacyGrade' },
      linkedAddresses: { type: 'integer', minimum: 0 },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['score', 'grade', 'linkedAddresses', 'warnings'],
    additionalProperties: true,
  },
} as const;
