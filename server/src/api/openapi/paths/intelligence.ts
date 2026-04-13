/**
 * Intelligence API Path Definitions
 *
 * OpenAPI path definitions for Treasury Intelligence endpoints.
 */

import {
  INSIGHT_SEVERITY_VALUES,
  INSIGHT_STATUS_VALUES,
  INSIGHT_TYPE_VALUES,
} from '../../../services/intelligence/types';
import { browserOrBearerAuth as bearerAuth } from '../security';

const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const walletIdQueryParameter = {
  name: 'walletId',
  in: 'query',
  required: true,
  schema: { type: 'string' },
} as const;

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const jsonRequestBody = (schemaRef: string, required = true) => ({
  required,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const paginationParameters = (defaultLimit: number) => [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: defaultLimit },
  },
  {
    name: 'offset',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 0, default: 0 },
  },
] as const;

export const intelligencePaths = {
  '/intelligence/status': {
    get: {
      tags: ['Intelligence'],
      summary: 'Get Treasury Intelligence status',
      description: 'Check whether Treasury Intelligence prerequisites are available for the authenticated user.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Intelligence status', '#/components/schemas/IntelligenceStatusResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/intelligence/insights': {
    get: {
      tags: ['Intelligence'],
      summary: 'List wallet insights',
      description: 'List Treasury Intelligence insights for a wallet the authenticated user can access.',
      security: bearerAuth,
      parameters: [
        walletIdQueryParameter,
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...INSIGHT_STATUS_VALUES] },
        },
        {
          name: 'type',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...INSIGHT_TYPE_VALUES] },
        },
        {
          name: 'severity',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...INSIGHT_SEVERITY_VALUES] },
        },
        ...paginationParameters(50),
      ],
      responses: {
        200: jsonResponse('Wallet insights', '#/components/schemas/IntelligenceInsightsResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/intelligence/insights/count': {
    get: {
      tags: ['Intelligence'],
      summary: 'Count active wallet insights',
      description: 'Count active Treasury Intelligence insights for a wallet.',
      security: bearerAuth,
      parameters: [walletIdQueryParameter],
      responses: {
        200: jsonResponse('Active insight count', '#/components/schemas/IntelligenceInsightCountResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/intelligence/insights/{id}': {
    patch: {
      tags: ['Intelligence'],
      summary: 'Update insight status',
      description: 'Dismiss an insight or mark it as acted on after verifying wallet access.',
      security: bearerAuth,
      parameters: [idParameter],
      requestBody: jsonRequestBody('#/components/schemas/IntelligenceUpdateInsightRequest'),
      responses: {
        200: jsonResponse('Updated insight', '#/components/schemas/IntelligenceInsightResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/intelligence/conversations': {
    get: {
      tags: ['Intelligence'],
      summary: 'List intelligence conversations',
      description: 'List Treasury Intelligence conversations for the authenticated user.',
      security: bearerAuth,
      parameters: [...paginationParameters(20)],
      responses: {
        200: jsonResponse('Conversations', '#/components/schemas/IntelligenceConversationsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Intelligence'],
      summary: 'Create intelligence conversation',
      description: 'Create a Treasury Intelligence conversation, optionally scoped to a wallet.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/IntelligenceCreateConversationRequest', false),
      responses: {
        201: jsonResponse('Created conversation', '#/components/schemas/IntelligenceConversationResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/intelligence/conversations/{id}/messages': {
    get: {
      tags: ['Intelligence'],
      summary: 'List conversation messages',
      description: 'List messages for an owned Treasury Intelligence conversation.',
      security: bearerAuth,
      parameters: [idParameter],
      responses: {
        200: jsonResponse('Conversation messages', '#/components/schemas/IntelligenceMessagesResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Intelligence'],
      summary: 'Send intelligence conversation message',
      description: 'Send a user message and return the saved user and assistant messages.',
      security: bearerAuth,
      parameters: [idParameter],
      requestBody: jsonRequestBody('#/components/schemas/IntelligenceSendMessageRequest'),
      responses: {
        200: jsonResponse('Saved user and assistant messages', '#/components/schemas/IntelligenceSendMessageResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/intelligence/conversations/{id}': {
    delete: {
      tags: ['Intelligence'],
      summary: 'Delete intelligence conversation',
      description: 'Delete a Treasury Intelligence conversation owned by the authenticated user.',
      security: bearerAuth,
      parameters: [idParameter],
      responses: {
        200: jsonResponse('Conversation deleted', '#/components/schemas/IntelligenceDeleteConversationResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/intelligence/settings/{walletId}': {
    get: {
      tags: ['Intelligence'],
      summary: 'Get wallet intelligence settings',
      description: 'Get Treasury Intelligence settings for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet intelligence settings', '#/components/schemas/IntelligenceSettingsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Intelligence'],
      summary: 'Update wallet intelligence settings',
      description: 'Update Treasury Intelligence settings for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/IntelligenceUpdateSettingsRequest'),
      responses: {
        200: jsonResponse('Updated wallet intelligence settings', '#/components/schemas/IntelligenceSettingsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
