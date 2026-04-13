/**
 * Draft API Path Definitions
 *
 * OpenAPI path definitions for gateway-exposed draft transaction routes.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const draftIdParameter = {
  name: 'draftId',
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

const draftResponse = {
  description: 'Draft transaction',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/DraftTransaction' },
    },
  },
} as const;

export const draftPaths = {
  '/wallets/{walletId}/drafts': {
    get: {
      tags: ['Drafts'],
      summary: 'List wallet drafts',
      description: 'Get draft transactions for a wallet the user can view.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: {
          description: 'Wallet drafts',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/DraftTransaction' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/drafts/{draftId}': {
    get: {
      tags: ['Drafts'],
      summary: 'Get draft',
      description: 'Get a specific draft transaction for a wallet the user can view.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter],
      responses: {
        200: draftResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Drafts'],
      summary: 'Update draft',
      description: 'Update draft transaction signing state or metadata.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateDraftRequest' },
          },
        },
      },
      responses: {
        200: draftResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
