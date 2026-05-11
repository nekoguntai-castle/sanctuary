/**
 * Label OpenAPI Schemas
 *
 * Schema definitions for wallet label routes exposed through the gateway.
 */

import { MOBILE_API_REQUEST_LIMITS } from '@sanctuary/shared/schemas/mobileApiRequests';

export const labelSchemas = {
  Label: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string' },
      name: { type: 'string' },
      color: { type: 'string', nullable: true },
      description: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      transactionCount: { type: 'integer' },
      addressCount: { type: 'integer' },
    },
    required: ['id', 'walletId', 'name', 'createdAt', 'updatedAt'],
  },
  LabelWithRelations: {
    allOf: [
      { $ref: '#/components/schemas/Label' },
      {
        type: 'object',
        properties: {
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
          addresses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
    ],
  },
  LabelIdsRequest: {
    type: 'object',
    properties: {
      labelIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['labelIds'],
  },
  CreateLabelRequest: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: MOBILE_API_REQUEST_LIMITS.labelNameMinLength,
        maxLength: MOBILE_API_REQUEST_LIMITS.labelNameMaxLength,
      },
      color: { type: 'string', maxLength: MOBILE_API_REQUEST_LIMITS.labelColorMaxLength },
      description: {
        type: 'string',
        maxLength: MOBILE_API_REQUEST_LIMITS.labelDescriptionMaxLength,
        nullable: true,
      },
    },
    required: ['name'],
  },
  UpdateLabelRequest: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: MOBILE_API_REQUEST_LIMITS.labelNameMinLength,
        maxLength: MOBILE_API_REQUEST_LIMITS.labelNameMaxLength,
      },
      color: { type: 'string', maxLength: MOBILE_API_REQUEST_LIMITS.labelColorMaxLength },
      description: {
        type: 'string',
        maxLength: MOBILE_API_REQUEST_LIMITS.labelDescriptionMaxLength,
        nullable: true,
      },
    },
  },
} as const;
