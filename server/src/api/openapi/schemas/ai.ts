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
      enabled: { type: 'boolean' },
      configured: { type: 'boolean' },
      available: { type: 'boolean' },
      message: { type: 'string' },
      model: { type: 'string' },
      endpoint: { type: 'string' },
      proxyAvailable: { type: 'boolean' },
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
  AIDetectProviderRequest: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', format: 'uri' },
      preferredProviderType: {
        type: 'string',
        enum: ['ollama', 'openai-compatible'],
      },
      apiKey: { type: 'string', writeOnly: true },
    },
    required: ['endpoint'],
  },
  AIDetectProviderResponse: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      providerType: {
        type: 'string',
        enum: ['ollama', 'openai-compatible'],
      },
      endpoint: { type: 'string' },
      models: {
        type: 'array',
        items: { $ref: '#/components/schemas/AIModel' },
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
} as const;
