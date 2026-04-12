/**
 * Label API Path Definitions
 *
 * OpenAPI path definitions for gateway-exposed wallet label routes.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;

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

const labelResponse = {
  description: 'Label',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Label' },
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
        200: {
          description: 'Wallet labels',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/Label' },
              },
            },
          },
        },
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
} as const;
