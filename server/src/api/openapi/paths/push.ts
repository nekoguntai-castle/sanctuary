/**
 * Push Notification API Path Definitions
 *
 * OpenAPI path definitions for user-facing push device routes.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;

const deviceIdParameter = {
  name: 'id',
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

const successResponse = {
  description: 'Success',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/SuccessResponse' },
    },
  },
} as const;

export const pushPaths = {
  '/push/register': {
    post: {
      tags: ['Push'],
      summary: 'Register push device',
      description: 'Register or update a mobile device token for push notifications.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PushRegisterRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Device registered',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PushRegisterResponse' },
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
      },
    },
  },
  '/push/unregister': {
    delete: {
      tags: ['Push'],
      summary: 'Unregister push device by token',
      description: 'Remove a mobile device token. The route is idempotent for unknown tokens.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PushUnregisterRequest' },
          },
        },
      },
      responses: {
        200: successResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
      },
    },
  },
  '/push/devices': {
    get: {
      tags: ['Push'],
      summary: 'List push devices',
      description: 'List registered push devices for the authenticated user.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Registered devices',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PushDevicesResponse' },
            },
          },
        },
        401: apiErrorResponse,
      },
    },
  },
  '/push/devices/{id}': {
    delete: {
      tags: ['Push'],
      summary: 'Delete push device by ID',
      description: 'Remove a registered push device owned by the authenticated user.',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      responses: {
        200: successResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
