/**
 * Wallet Webhook API Path Definitions
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const webhookIdParameter = {
  name: 'webhookId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const deliveryIdParameter = {
  name: 'deliveryId',
  in: 'path',
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

const jsonRequestBody = (schemaRef: string) => ({
  required: true,
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

export const walletWebhookPaths = {
  '/wallets/{walletId}/webhooks': {
    get: {
      tags: ['Wallets'],
      summary: 'List wallet webhooks',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet webhooks', '#/components/schemas/WalletWebhookEndpointListResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
    post: {
      tags: ['Wallets'],
      summary: 'Create wallet webhook',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/WalletWebhookEndpointCreateRequest'),
      responses: {
        201: jsonResponse('Created wallet webhook', '#/components/schemas/WalletWebhookEndpointResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/webhooks/{webhookId}': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet webhook',
      security: bearerAuth,
      parameters: [walletIdParameter, webhookIdParameter],
      responses: {
        200: jsonResponse('Wallet webhook', '#/components/schemas/WalletWebhookEndpointResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Wallets'],
      summary: 'Update wallet webhook',
      security: bearerAuth,
      parameters: [walletIdParameter, webhookIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/WalletWebhookEndpointUpdateRequest'),
      responses: {
        200: jsonResponse('Updated wallet webhook', '#/components/schemas/WalletWebhookEndpointResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Wallets'],
      summary: 'Delete wallet webhook',
      security: bearerAuth,
      parameters: [walletIdParameter, webhookIdParameter],
      responses: {
        200: jsonResponse('Deleted wallet webhook', '#/components/schemas/WalletSettingsUpdateResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/webhooks/{webhookId}/test': {
    post: {
      tags: ['Wallets'],
      summary: 'Test wallet webhook configuration',
      security: bearerAuth,
      parameters: [walletIdParameter, webhookIdParameter],
      responses: {
        200: jsonResponse('Webhook test result', '#/components/schemas/WalletSettingsUpdateResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/webhooks/{webhookId}/deliveries': {
    get: {
      tags: ['Wallets'],
      summary: 'List wallet webhook deliveries',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        webhookIdParameter,
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      ],
      responses: {
        200: jsonResponse('Wallet webhook deliveries', '#/components/schemas/WalletWebhookDeliveryListResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/webhooks/{webhookId}/deliveries/{deliveryId}/replay': {
    post: {
      tags: ['Wallets'],
      summary: 'Replay a wallet webhook delivery',
      security: bearerAuth,
      parameters: [walletIdParameter, webhookIdParameter, deliveryIdParameter],
      responses: {
        200: jsonResponse('Webhook replay result', '#/components/schemas/WalletWebhookReplayResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
