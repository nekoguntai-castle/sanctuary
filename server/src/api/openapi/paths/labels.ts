/**
 * Label API Path Definitions
 *
 * OpenAPI path definitions for wallet labels and label associations.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const labelIdParameter = {
  name: 'labelId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const transactionIdParameter = {
  name: 'transactionId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const addressIdParameter = {
  name: 'addressId',
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

const labelArrayResponse = {
  description: 'Labels',
  content: {
    'application/json': {
      schema: {
        type: 'array',
        items: { $ref: '#/components/schemas/Label' },
      },
    },
  },
} as const;

const labelResponse = {
  description: 'Label',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Label' },
    },
  },
} as const;

const labelWithRelationsResponse = {
  description: 'Label with associated transactions and addresses',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/LabelWithRelations' },
    },
  },
} as const;

export const labelPaths = {
  '/wallets/{walletId}/labels': {
    get: {
      tags: ['Labels'],
      summary: 'List wallet labels',
      description: 'Get labels for a wallet the user can view.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: labelArrayResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
    post: {
      tags: ['Labels'],
      summary: 'Create wallet label',
      description: 'Create a label for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/CreateLabelRequest'),
      responses: {
        201: labelResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        409: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/labels/{labelId}': {
    get: {
      tags: ['Labels'],
      summary: 'Get wallet label',
      description: 'Get a label and its associated transactions and addresses for a wallet the user can view.',
      security: bearerAuth,
      parameters: [walletIdParameter, labelIdParameter],
      responses: {
        200: labelWithRelationsResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
    put: {
      tags: ['Labels'],
      summary: 'Update wallet label',
      description: 'Update a label for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter, labelIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UpdateLabelRequest'),
      responses: {
        200: labelResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Labels'],
      summary: 'Delete wallet label',
      description: 'Delete a label for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter, labelIdParameter],
      responses: {
        204: {
          description: 'Label deleted',
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/transactions/{transactionId}/labels': {
    get: {
      tags: ['Labels'],
      summary: 'List transaction labels',
      description: 'Get labels associated with a transaction the user can view.',
      security: bearerAuth,
      parameters: [transactionIdParameter],
      responses: {
        200: labelArrayResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Labels'],
      summary: 'Add transaction labels',
      description: 'Attach labels to a transaction the user can edit.',
      security: bearerAuth,
      parameters: [transactionIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/LabelIdsRequest'),
      responses: {
        200: labelArrayResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    put: {
      tags: ['Labels'],
      summary: 'Replace transaction labels',
      description: 'Replace all labels on a transaction the user can edit.',
      security: bearerAuth,
      parameters: [transactionIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/LabelIdsRequest'),
      responses: {
        200: labelArrayResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/transactions/{transactionId}/labels/{labelId}': {
    delete: {
      tags: ['Labels'],
      summary: 'Remove transaction label',
      description: 'Remove a label association from a transaction the user can edit.',
      security: bearerAuth,
      parameters: [transactionIdParameter, labelIdParameter],
      responses: {
        204: {
          description: 'Transaction label removed',
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/addresses/{addressId}/labels': {
    get: {
      tags: ['Labels'],
      summary: 'List address labels',
      description: 'Get labels associated with an address the user can view.',
      security: bearerAuth,
      parameters: [addressIdParameter],
      responses: {
        200: labelArrayResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Labels'],
      summary: 'Add address labels',
      description: 'Attach labels to an address the user can edit.',
      security: bearerAuth,
      parameters: [addressIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/LabelIdsRequest'),
      responses: {
        200: labelArrayResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    put: {
      tags: ['Labels'],
      summary: 'Replace address labels',
      description: 'Replace all labels on an address the user can edit.',
      security: bearerAuth,
      parameters: [addressIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/LabelIdsRequest'),
      responses: {
        200: labelArrayResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/addresses/{addressId}/labels/{labelId}': {
    delete: {
      tags: ['Labels'],
      summary: 'Remove address label',
      description: 'Remove a label association from an address the user can edit.',
      security: bearerAuth,
      parameters: [addressIdParameter, labelIdParameter],
      responses: {
        204: {
          description: 'Address label removed',
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
