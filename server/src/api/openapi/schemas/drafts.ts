/**
 * Draft OpenAPI Schemas
 *
 * Schema definitions for gateway-exposed draft transaction routes.
 */

import { MOBILE_DRAFT_STATUS_VALUES } from '../../../../../shared/schemas/mobileApiRequests';

export const draftSchemas = {
  DraftOutput: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: { type: 'number', minimum: 1 },
      sendMax: { type: 'boolean' },
    },
    required: ['address', 'amount'],
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
        items: {
          type: 'object',
          properties: {
            address: { type: 'string' },
            amount: { type: 'number' },
          },
          required: ['address', 'amount'],
        },
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
      status: { type: 'string', enum: ['unsigned', 'partial', 'signed'] },
      signedDeviceIds: { type: 'array', items: { type: 'string' } },
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
      amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      feeRate: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
      enableRBF: { type: 'boolean' },
      subtractFees: { type: 'boolean' },
      sendMax: { type: 'boolean' },
      outputs: {},
      inputs: {},
      decoyOutputs: {},
      payjoinUrl: { type: 'string' },
      isRBF: { type: 'boolean' },
      label: { type: 'string', nullable: true },
      memo: { type: 'string', nullable: true },
      psbtBase64: { type: 'string' },
      fee: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      totalInput: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      totalOutput: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      changeAmount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      changeAddress: { type: 'string' },
      effectiveAmount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      inputPaths: {},
    },
    additionalProperties: false,
  },
  UpdateDraftRequest: {
    type: 'object',
    properties: {
      signedPsbtBase64: { type: 'string', minLength: 1 },
      signedDeviceId: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: [...MOBILE_DRAFT_STATUS_VALUES] },
      label: { type: 'string' },
      memo: { type: 'string' },
    },
    additionalProperties: false,
  },
} as const;
