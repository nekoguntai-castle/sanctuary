/**
 * Internal OpenAPI Schemas
 *
 * Schema definitions for root-mounted internal gateway and AI container endpoints.
 */

import { MOBILE_ACTIONS } from '../../../../../shared/schemas/mobileApiRequests';

const satsMetric = {
  type: 'integer',
  minimum: 0,
  description: 'Satoshis serialized as a JSON number for aggregate internal-only analysis.',
} as const;

const internalAiPeriodSpendSchema = {
  type: 'object',
  properties: {
    count: { type: 'integer', minimum: 0 },
    totalSats: satsMetric,
  },
  required: ['count', 'totalSats'],
} as const;

export const internalSchemas = {
  InternalSimpleErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['error'],
  },
  InternalMobilePermissionCheckRequest: {
    type: 'object',
    properties: {
      walletId: { type: 'string', minLength: 1 },
      userId: { type: 'string', minLength: 1 },
      action: { type: 'string', enum: [...MOBILE_ACTIONS] },
    },
    required: ['walletId', 'userId', 'action'],
    additionalProperties: false,
  },
  InternalMobilePermissionCheckResponse: {
    type: 'object',
    properties: {
      allowed: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['allowed'],
  },
  InternalAIPullProgressRequest: {
    type: 'object',
    properties: {
      model: { type: 'string', minLength: 1 },
      status: { type: 'string', minLength: 1 },
      completed: { type: 'integer', minimum: 0 },
      total: { type: 'integer', minimum: 0 },
      digest: { type: 'string' },
      error: { type: 'string' },
    },
    required: ['model', 'status'],
  },
  InternalAIPullProgressResponse: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
    },
    required: ['ok'],
  },
  InternalAITransactionContext: {
    type: 'object',
    properties: {
      walletId: { type: 'string' },
      amount: satsMetric,
      direction: { type: 'string', enum: ['receive', 'send'] },
      date: { type: 'string', format: 'date-time' },
      confirmations: { type: 'integer', minimum: 0 },
    },
    required: ['walletId', 'amount', 'direction', 'date', 'confirmations'],
  },
  InternalAIWalletLabelsResponse: {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['labels'],
  },
  InternalAIWalletContextResponse: {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        items: { type: 'string' },
      },
      stats: {
        type: 'object',
        properties: {
          transactionCount: { type: 'integer', minimum: 0 },
          addressCount: { type: 'integer', minimum: 0 },
          utxoCount: { type: 'integer', minimum: 0 },
        },
        required: ['transactionCount', 'addressCount', 'utxoCount'],
      },
    },
    required: ['labels', 'stats'],
  },
  InternalAIUtxoDistribution: {
    type: 'object',
    properties: {
      dust: { type: 'integer', minimum: 0 },
      small: { type: 'integer', minimum: 0 },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['dust', 'small', 'total'],
  },
  InternalAIUtxoHealthResponse: {
    type: 'object',
    properties: {
      totalUtxos: { type: 'integer', minimum: 0 },
      dustCount: { type: 'integer', minimum: 0 },
      dustValueSats: satsMetric,
      totalValueSats: satsMetric,
      avgUtxoSizeSats: satsMetric,
      consolidationCandidates: { type: 'integer', minimum: 0 },
      distribution: { $ref: '#/components/schemas/InternalAIUtxoDistribution' },
    },
    required: [
      'totalUtxos',
      'dustCount',
      'dustValueSats',
      'totalValueSats',
      'avgUtxoSizeSats',
      'consolidationCandidates',
      'distribution',
    ],
  },
  InternalAIFeeSnapshot: {
    type: 'object',
    properties: {
      timestamp: { type: 'integer', minimum: 0 },
      economy: { type: 'number', minimum: 0 },
      minimum: { type: 'number', minimum: 0 },
      fastest: { type: 'number', minimum: 0 },
    },
    required: ['timestamp', 'economy', 'minimum', 'fastest'],
  },
  InternalAIFeeHistoryResponse: {
    type: 'object',
    properties: {
      snapshots: {
        type: 'array',
        items: { $ref: '#/components/schemas/InternalAIFeeSnapshot' },
      },
      trend: { type: 'string', enum: ['rising', 'falling', 'stable'] },
      currentEconomy: { type: 'number', nullable: true, minimum: 0 },
      snapshotCount: { type: 'integer', minimum: 0 },
    },
    required: ['snapshots', 'trend', 'currentEconomy', 'snapshotCount'],
  },
  InternalAISpendingVelocityResponse: {
    type: 'object',
    properties: {
      '24h': internalAiPeriodSpendSchema,
      '7d': internalAiPeriodSpendSchema,
      '30d': internalAiPeriodSpendSchema,
      '90d': internalAiPeriodSpendSchema,
      averageDailySpend90d: satsMetric,
      currentDayVsAverage: { type: 'number', minimum: 0 },
    },
    required: ['24h', '7d', '30d', '90d', 'averageDailySpend90d', 'currentDayVsAverage'],
  },
  InternalAIUtxoAgeBucket: {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 0 },
      totalSats: satsMetric,
    },
    required: ['count', 'totalSats'],
  },
  InternalAIUpcomingLongTermUtxos: {
    type: 'object',
    properties: {
      daysUntilLongTerm: { type: 'integer', minimum: 0 },
      count: { type: 'integer', minimum: 0 },
      totalSats: satsMetric,
    },
    required: ['daysUntilLongTerm', 'count', 'totalSats'],
  },
  InternalAIUtxoAgeProfileResponse: {
    type: 'object',
    properties: {
      shortTerm: { $ref: '#/components/schemas/InternalAIUtxoAgeBucket' },
      longTerm: { $ref: '#/components/schemas/InternalAIUtxoAgeBucket' },
      thresholdDays: { type: 'integer', minimum: 1 },
      upcomingLongTerm: {
        type: 'array',
        items: { $ref: '#/components/schemas/InternalAIUpcomingLongTermUtxos' },
      },
    },
    required: ['shortTerm', 'longTerm', 'thresholdDays', 'upcomingLongTerm'],
  },
} as const;
