/**
 * Payjoin OpenAPI Schemas
 *
 * Schema definitions for BIP78 Payjoin management and receiver endpoints.
 */

import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';

export const payjoinSchemas = {
  PayjoinStatusResponse: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      configured: { type: 'boolean' },
    },
    required: ['enabled', 'configured'],
  },
  PayjoinEligibilityResponse: {
    type: 'object',
    properties: {
      eligible: { type: 'boolean' },
      status: {
        type: 'string',
        enum: ['ready', 'no-utxos', 'all-frozen', 'pending-confirmations', 'all-locked', 'unavailable'],
      },
      eligibleUtxoCount: { type: 'integer', minimum: 0 },
      totalUtxoCount: { type: 'integer', minimum: 0 },
      reason: { type: 'string', nullable: true },
    },
    required: ['eligible', 'status', 'eligibleUtxoCount', 'totalUtxoCount', 'reason'],
  },
  PayjoinUriResponse: {
    type: 'object',
    properties: {
      uri: { type: 'string' },
      address: { type: 'string' },
      payjoinUrl: { type: 'string', format: 'uri' },
    },
    required: ['uri', 'address', 'payjoinUrl'],
  },
  PayjoinParseUriRequest: {
    type: 'object',
    properties: {
      uri: { type: 'string', minLength: 1 },
    },
    required: ['uri'],
  },
  PayjoinParseUriResponse: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: { type: 'number', description: 'Amount in satoshis' },
      label: { type: 'string' },
      message: { type: 'string' },
      payjoinUrl: { type: 'string', format: 'uri' },
      hasPayjoin: { type: 'boolean' },
    },
    required: ['address', 'hasPayjoin'],
  },
  PayjoinAttemptRequest: {
    type: 'object',
    properties: {
      psbt: { type: 'string', minLength: 1, description: 'Original PSBT in base64 format' },
      payjoinUrl: { type: 'string', format: 'uri' },
      network: {
        type: 'string',
        enum: [...BITCOIN_NETWORKS],
        default: 'mainnet',
      },
    },
    required: ['psbt', 'payjoinUrl'],
  },
  PayjoinAttemptResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      proposalPsbt: { type: 'string', description: 'Payjoin proposal PSBT in base64 format' },
      isPayjoin: { type: 'boolean' },
      error: { type: 'string' },
    },
    required: ['success', 'isPayjoin'],
  },
  PayjoinReceiverError: {
    type: 'string',
    enum: [
      'version-unsupported',
      'unavailable',
      'not-enough-money',
      'original-psbt-rejected',
      'receiver-error',
    ],
  },
} as const;
