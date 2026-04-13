/**
 * Device API Path Definitions
 *
 * OpenAPI path definitions for hardware device management endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const deviceIdParameter = {
  name: 'deviceId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const accountIdParameter = {
  name: 'accountId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const slugParameter = {
  name: 'slug',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const targetUserIdParameter = {
  name: 'targetUserId',
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

const arrayResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'array',
        items: { $ref: schemaRef },
      },
    },
  },
});

export const devicePaths = {
  '/devices/models': {
    get: {
      tags: ['Devices'],
      summary: 'List device models',
      description: 'Get the public hardware device model catalog.',
      parameters: [
        {
          name: 'manufacturer',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'airGapped',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'connectivity',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'showDiscontinued',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
      ],
      responses: {
        200: arrayResponse('Hardware device models', '#/components/schemas/DeviceModel'),
        500: apiErrorResponse,
      },
    },
  },
  '/devices/models/{slug}': {
    get: {
      tags: ['Devices'],
      summary: 'Get device model',
      description: 'Get a public hardware device model by slug.',
      parameters: [slugParameter],
      responses: {
        200: jsonResponse('Hardware device model', '#/components/schemas/DeviceModel'),
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/devices/manufacturers': {
    get: {
      tags: ['Devices'],
      summary: 'List device manufacturers',
      description: 'Get distinct active hardware device manufacturers.',
      responses: {
        200: {
          description: 'Device manufacturers',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
        500: apiErrorResponse,
      },
    },
  },
  '/devices': {
    get: {
      tags: ['Devices'],
      summary: 'List devices',
      description: 'Get all devices for the authenticated user',
      security: bearerAuth,
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
      security: bearerAuth,
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
        200: {
          description: 'Existing device updated by merge request',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DeviceMergeResponse' },
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        409: {
          description: 'Device fingerprint conflict or account merge conflict',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DeviceConflictResponse' },
            },
          },
        },
      },
    },
  },
  '/devices/{deviceId}': {
    get: {
      tags: ['Devices'],
      summary: 'Get device',
      description: 'Get a specific hardware device by ID',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      responses: {
        200: {
          description: 'Device details',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Device' },
            },
          },
        },
        404: {
          description: 'Device not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
    patch: {
      tags: ['Devices'],
      summary: 'Update device',
      description: 'Update hardware device properties',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateDeviceRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Device updated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Device' },
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        404: {
          description: 'Device not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
    delete: {
      tags: ['Devices'],
      summary: 'Delete device',
      description: 'Delete a hardware device if it is not in use by any wallet',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      responses: {
        204: {
          description: 'Device deleted',
        },
        404: {
          description: 'Device not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        409: {
          description: 'Device is in use by one or more wallets',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
  },
  '/devices/{deviceId}/accounts': {
    get: {
      tags: ['Devices'],
      summary: 'List device accounts',
      description: 'Get all xpub accounts for a device the user can view.',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      responses: {
        200: arrayResponse('Device accounts', '#/components/schemas/DeviceAccount'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Devices'],
      summary: 'Add device account',
      description: 'Add an xpub account to an owned device.',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/DeviceAccountInput'),
      responses: {
        201: jsonResponse('Device account created', '#/components/schemas/DeviceAccount'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/devices/{deviceId}/accounts/{accountId}': {
    delete: {
      tags: ['Devices'],
      summary: 'Delete device account',
      description: 'Remove an xpub account from an owned device. The last account cannot be removed.',
      security: bearerAuth,
      parameters: [deviceIdParameter, accountIdParameter],
      responses: {
        204: {
          description: 'Device account deleted',
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/devices/{deviceId}/share': {
    get: {
      tags: ['Devices'],
      summary: 'Get device sharing info',
      description: 'Get group and user sharing details for a device the user can view.',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      responses: {
        200: jsonResponse('Device sharing details', '#/components/schemas/DeviceShareInfo'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/devices/{deviceId}/share/user': {
    post: {
      tags: ['Devices'],
      summary: 'Share device with user',
      description: 'Grant direct viewer access to an owned device.',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/DeviceShareUserRequest'),
      responses: {
        200: jsonResponse('Device user sharing updated', '#/components/schemas/DeviceShareResult'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/devices/{deviceId}/share/user/{targetUserId}': {
    delete: {
      tags: ['Devices'],
      summary: 'Remove device user access',
      description: 'Remove direct user access from an owned device.',
      security: bearerAuth,
      parameters: [deviceIdParameter, targetUserIdParameter],
      responses: {
        200: jsonResponse('Device user access removed', '#/components/schemas/DeviceShareResult'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/devices/{deviceId}/share/group': {
    post: {
      tags: ['Devices'],
      summary: 'Share device with group',
      description: 'Assign or remove group viewer access for an owned device.',
      security: bearerAuth,
      parameters: [deviceIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/DeviceShareGroupRequest'),
      responses: {
        200: jsonResponse('Device group sharing updated', '#/components/schemas/DeviceShareResult'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
