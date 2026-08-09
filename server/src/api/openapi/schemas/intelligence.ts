/**
 * Intelligence OpenAPI Schemas
 *
 * Schema definitions for Treasury Intelligence insights, conversations, and settings.
 */

import {
  INSIGHT_SEVERITY_VALUES,
  INSIGHT_STATUS_VALUES,
  INSIGHT_TYPE_VALUES,
  INSIGHT_UPDATE_STATUS_VALUES,
  INTELLIGENCE_ENDPOINT_TYPE_VALUES,
  INTELLIGENCE_MESSAGE_ROLE_VALUES,
} from '../../../services/intelligence/types';
import { CHAT_MESSAGE_MAX_LENGTH } from '../../../services/intelligence/messageContent';

const jsonObject = {
  type: 'object',
  additionalProperties: true,
} as const;

export const intelligenceSchemas = {
  IntelligenceStatusResponse: {
    type: 'object',
    properties: {
      available: { type: 'boolean' },
      ollamaConfigured: { type: 'boolean' },
      endpointType: { type: 'string', enum: [...INTELLIGENCE_ENDPOINT_TYPE_VALUES] },
      reason: { type: 'string' },
    },
    required: ['available', 'ollamaConfigured'],
  },
  IntelligenceInsight: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string' },
      type: { type: 'string', enum: [...INSIGHT_TYPE_VALUES] },
      severity: { type: 'string', enum: [...INSIGHT_SEVERITY_VALUES] },
      title: { type: 'string' },
      summary: { type: 'string' },
      analysis: { type: 'string' },
      data: { ...jsonObject, nullable: true },
      status: { type: 'string', enum: [...INSIGHT_STATUS_VALUES] },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
      notifiedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'id',
      'walletId',
      'type',
      'severity',
      'title',
      'summary',
      'analysis',
      'status',
      'createdAt',
      'updatedAt',
    ],
  },
  IntelligenceInsightsResponse: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: { $ref: '#/components/schemas/IntelligenceInsight' },
      },
    },
    required: ['insights'],
  },
  IntelligenceInsightCountResponse: {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 0 },
    },
    required: ['count'],
  },
  IntelligenceUpdateInsightRequest: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...INSIGHT_UPDATE_STATUS_VALUES] },
    },
    required: ['status'],
  },
  IntelligenceInsightResponse: {
    type: 'object',
    properties: {
      insight: { $ref: '#/components/schemas/IntelligenceInsight' },
    },
    required: ['insight'],
  },
  IntelligenceConversation: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      walletId: { type: 'string', nullable: true },
      title: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'userId', 'createdAt', 'updatedAt'],
  },
  IntelligenceConversationsResponse: {
    type: 'object',
    properties: {
      conversations: {
        type: 'array',
        items: { $ref: '#/components/schemas/IntelligenceConversation' },
      },
    },
    required: ['conversations'],
  },
  IntelligenceCreateConversationRequest: {
    type: 'object',
    properties: {
      walletId: { type: 'string' },
    },
  },
  IntelligenceConversationResponse: {
    type: 'object',
    properties: {
      conversation: { $ref: '#/components/schemas/IntelligenceConversation' },
    },
    required: ['conversation'],
  },
  IntelligenceMessage: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      conversationId: { type: 'string' },
      role: { type: 'string', enum: [...INTELLIGENCE_MESSAGE_ROLE_VALUES] },
      content: { type: 'string' },
      metadata: { ...jsonObject, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'conversationId', 'role', 'content', 'createdAt'],
  },
  IntelligenceMessagesResponse: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: { $ref: '#/components/schemas/IntelligenceMessage' },
      },
    },
    required: ['messages'],
  },
  IntelligenceSendMessageRequest: {
    type: 'object',
    properties: {
      content: { type: 'string', minLength: 1, maxLength: CHAT_MESSAGE_MAX_LENGTH },
    },
    required: ['content'],
  },
  IntelligenceSendMessageResponse: {
    type: 'object',
    properties: {
      userMessage: { $ref: '#/components/schemas/IntelligenceMessage' },
      assistantMessage: { $ref: '#/components/schemas/IntelligenceMessage' },
    },
    required: ['userMessage', 'assistantMessage'],
  },
  IntelligenceDeleteConversationResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
    },
    required: ['success'],
  },
  IntelligenceSettings: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      notifyTelegram: { type: 'boolean' },
      notifyPush: { type: 'boolean' },
      severityFilter: { type: 'string', enum: [...INSIGHT_SEVERITY_VALUES] },
      typeFilter: {
        type: 'array',
        items: { type: 'string', enum: [...INSIGHT_TYPE_VALUES] },
      },
    },
    required: ['enabled', 'notifyTelegram', 'notifyPush', 'severityFilter', 'typeFilter'],
  },
  IntelligenceSettingsResponse: {
    type: 'object',
    properties: {
      settings: { $ref: '#/components/schemas/IntelligenceSettings' },
    },
    required: ['settings'],
  },
  IntelligenceUpdateSettingsRequest: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      notifyTelegram: { type: 'boolean' },
      notifyPush: { type: 'boolean' },
      severityFilter: { type: 'string', enum: [...INSIGHT_SEVERITY_VALUES] },
      typeFilter: {
        type: 'array',
        items: { type: 'string', enum: [...INSIGHT_TYPE_VALUES] },
      },
    },
  },
} as const;
