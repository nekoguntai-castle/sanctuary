/**
 * Device API Path Definitions
 *
 * OpenAPI path definitions for hardware device management endpoints.
 */

export const devicePaths = {
  '/devices': {
    get: {
      tags: ['Devices'],
      summary: 'List devices',
      description: 'Get all devices for the authenticated user',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'List of devices',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/Device' },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ['Devices'],
      summary: 'Create device',
      description: 'Register a new hardware device',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateDeviceRequest' },
          },
        },
      },
      responses: {
        201: {
          description: 'Device created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Device' },
            },
          },
        },
      },
    },
  },
} as const;
