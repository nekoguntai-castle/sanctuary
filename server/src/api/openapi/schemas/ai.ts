/**
 * AI OpenAPI Schemas
 *
 * Schema definitions for public AI assistant endpoints.
 */

import {
  AI_QUERY_AGGREGATION_VALUES,
  AI_QUERY_RESULT_TYPES,
  AI_QUERY_SORT_ORDERS,
} from '../../../services/ai/types';

const jsonObject = {
  type: 'object',
  additionalProperties: true,
} as const;

export const aiSchemas = {
  AIStatusResponse: {
    type: 'object',
    properties: {
      available: { type: 'boolean' },
      message: { type: 'string' },
      model: { type: 'string' },
      endpoint: { type: 'string' },
      containerAvailable: { type: 'boolean' },
      error: { type: 'string' },
    },
    required: ['available'],
  },
  AISuggestLabelRequest: {
    type: 'object',
    properties: {
      transactionId: { type: 'string', minLength: 1 },
    },
    required: ['transactionId'],
  },
  AISuggestLabelResponse: {
    type: 'object',
    properties: {
      suggestion: { type: 'string' },
    },
    required: ['suggestion'],
  },
  AIQueryRequest: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      walletId: { type: 'string', minLength: 1 },
    },
    required: ['query', 'walletId'],
  },
  AIQueryResult: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...AI_QUERY_RESULT_TYPES] },
      filter: jsonObject,
      sort: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          order: { type: 'string', enum: [...AI_QUERY_SORT_ORDERS] },
        },
        required: ['field', 'order'],
      },
      limit: { type: 'integer', minimum: 1 },
      aggregation: { type: 'string', enum: [...AI_QUERY_AGGREGATION_VALUES], nullable: true },
    },
    required: ['type'],
  },
  AIDetectOllamaResponse: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      endpoint: { type: 'string' },
      models: {
        type: 'array',
        items: { type: 'string' },
      },
      message: { type: 'string' },
    },
    required: ['found'],
  },
  AIModel: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      size: { type: 'integer', minimum: 0 },
      modifiedAt: { type: 'string', format: 'date-time' },
    },
    required: ['name', 'size', 'modifiedAt'],
  },
  AIModelsResponse: {
    type: 'object',
    properties: {
      models: {
        type: 'array',
        items: { $ref: '#/components/schemas/AIModel' },
      },
    },
    required: ['models'],
  },
  AIModelRequest: {
    type: 'object',
    properties: {
      model: { type: 'string', minLength: 1 },
    },
    required: ['model'],
  },
  AIModelOperationResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      model: { type: 'string' },
      status: { type: 'string' },
      error: { type: 'string' },
    },
    required: ['success'],
  },
  AIContainerStatusResponse: {
    type: 'object',
    properties: {
      available: { type: 'boolean' },
      exists: { type: 'boolean' },
      running: { type: 'boolean' },
      status: { type: 'string' },
      containerId: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['available'],
  },
  AIContainerActionResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success'],
  },
  AISystemResource: {
    type: 'object',
    properties: {
      total: { type: 'integer', minimum: 0 },
      available: { type: 'integer', minimum: 0 },
      required: { type: 'integer', minimum: 0 },
      sufficient: { type: 'boolean' },
    },
    required: ['total', 'available', 'required', 'sufficient'],
  },
  AISystemResourcesResponse: {
    type: 'object',
    properties: {
      ram: { $ref: '#/components/schemas/AISystemResource' },
      disk: { $ref: '#/components/schemas/AISystemResource' },
      gpu: {
        type: 'object',
        properties: {
          available: { type: 'boolean' },
          name: { type: 'string', nullable: true },
        },
        required: ['available', 'name'],
      },
      overall: {
        type: 'object',
        properties: {
          sufficient: { type: 'boolean' },
          warnings: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['sufficient', 'warnings'],
      },
    },
    required: ['ram', 'disk', 'gpu', 'overall'],
  },
} as const;
