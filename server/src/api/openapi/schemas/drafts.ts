/**
 * Draft OpenAPI Schemas
 *
 * Schema definitions for gateway-exposed draft transaction routes.
 */

import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';

const draftIntegerValueSchema = {
  oneOf: [
    { type: 'integer', minimum: 0 },
    { type: 'string', pattern: '^\\d+$' },
  ],
} as const;

const draftFeeRateValueSchema = {
  oneOf: [
    { type: 'number', minimum: 0, exclusiveMinimum: true },
    { type: 'string', pattern: '^(?=.*[1-9])\\d+(\\.\\d+)?$' },
  ],
} as const;

export const draftSchemas = {
  DraftOutput: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: { type: 'number', minimum: 0 },
      sendMax: { type: 'boolean' },
    },
    required: ['address', 'amount'],
    additionalProperties: false,
  },
  DraftInput: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      vout: { type: 'integer', minimum: 0 },
      address: { type: 'string' },
      amount: { type: 'number' },
    },
    required: ['txid', 'vout', 'address', 'amount'],
    additionalProperties: false,
  },
  DraftDecoyOutput: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: { type: 'number' },
    },
    required: ['address', 'amount'],
    additionalProperties: false,
  },
  DraftOutputRequest: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: draftIntegerValueSchema,
      sendMax: { type: 'boolean' },
    },
    required: ['address', 'amount'],
    additionalProperties: false,
  },
  DraftInputRequest: {
    type: 'object',
    properties: {
      txid: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      vout: { type: 'integer', minimum: 0 },
      address: { type: 'string' },
      amount: draftIntegerValueSchema,
    },
    required: ['txid', 'vout', 'address', 'amount'],
    additionalProperties: false,
  },
  DraftDecoyOutputRequest: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: draftIntegerValueSchema,
    },
    required: ['address', 'amount'],
    additionalProperties: false,
  },
  DraftTransaction: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string' },
      userId: { type: 'string' },
      recipient: { type: 'string', nullable: true },
      amount: { type: 'number', nullable: true },
      feeRate: { type: 'number', nullable: true },
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
      enableRBF: { type: 'boolean' },
      subtractFees: { type: 'boolean' },
      sendMax: { type: 'boolean' },
      isRBF: { type: 'boolean' },
      outputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/DraftOutput' },
      },
      inputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/DraftInput' },
      },
      decoyOutputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/DraftDecoyOutput' },
      },
      payjoinUrl: { type: 'string', nullable: true },
      label: { type: 'string', nullable: true },
      memo: { type: 'string', nullable: true },
      psbtBase64: { type: 'string' },
      signedPsbtBase64: { type: 'string', nullable: true },
      fee: { type: 'number', nullable: true },
      totalInput: { type: 'number', nullable: true },
      totalOutput: { type: 'number', nullable: true },
      changeAmount: { type: 'number', nullable: true },
      changeAddress: { type: 'string', nullable: true },
      effectiveAmount: { type: 'number', nullable: true },
      inputPaths: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: [...ACTIONABLE_DRAFT_STATUS_VALUES] },
      signedDeviceIds: { type: 'array', items: { type: 'string' } },
      agentId: { type: 'string', nullable: true },
      agentOperationalWalletId: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
    },
    required: ['id', 'walletId', 'userId', 'psbtBase64', 'status', 'createdAt', 'updatedAt'],
  },
  CreateDraftRequest: {
    type: 'object',
    properties: {
      recipient: { type: 'string' },
      amount: draftIntegerValueSchema,
      feeRate: draftFeeRateValueSchema,
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
      enableRBF: { type: 'boolean' },
      subtractFees: { type: 'boolean' },
      sendMax: { type: 'boolean' },
      outputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/DraftOutputRequest' },
      },
      inputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/DraftInputRequest' },
      },
      decoyOutputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/DraftDecoyOutputRequest' },
      },
      payjoinUrl: { type: 'string' },
      isRBF: { type: 'boolean' },
      label: { type: 'string', nullable: true },
      memo: { type: 'string', nullable: true },
      psbtBase64: { type: 'string' },
      fee: draftIntegerValueSchema,
      totalInput: draftIntegerValueSchema,
      totalOutput: draftIntegerValueSchema,
      changeAmount: draftIntegerValueSchema,
      changeAddress: { type: 'string' },
      effectiveAmount: draftIntegerValueSchema,
      inputPaths: { type: 'array', items: { type: 'string', minLength: 1 } },
      signedPsbtBase64: { type: 'string', minLength: 1 },
      signedDeviceId: { type: 'string', minLength: 1 },
    },
    required: ['recipient', 'amount', 'feeRate', 'psbtBase64'],
    additionalProperties: false,
  },
  UpdateDraftRequest: {
    type: 'object',
    properties: {
      signedPsbtBase64: { type: 'string', minLength: 1 },
      signedDeviceId: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: [...ACTIONABLE_DRAFT_STATUS_VALUES] },
      label: { type: 'string', nullable: true },
      memo: { type: 'string', nullable: true },
    },
    additionalProperties: false,
  },
} as const;
