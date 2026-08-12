import { browserOrBearerAuth } from '../security';

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

export const hardwarePaths = {
  '/hardware/jade/pin': {
    post: {
      tags: ['Devices'],
      summary: 'Relay a Jade blind-PIN operation',
      description:
        'Relays opaque JSON to one fixed official Jade PIN endpoint. The client cannot provide an upstream URL.',
      security: browserOrBearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['operation', 'data'],
              properties: {
                operation: { type: 'string', enum: ['get_pin', 'set_pin'] },
                data: {},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Bounded JSON response from the fixed Jade PIN endpoint',
          content: { 'application/json': { schema: {} } },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        429: apiErrorResponse,
        503: apiErrorResponse,
      },
    },
  },
} as const;
