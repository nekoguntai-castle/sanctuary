/**
 * Auth API Path Definitions
 *
 * OpenAPI path definitions for authentication endpoints.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;

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

const sessionIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const authPaths = {
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Login',
      description: 'Authenticate with username and password',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginResponse' },
            },
          },
        },
        401: {
          description: 'Invalid credentials',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
  },
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register',
      description: 'Create a new user account',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RegisterRequest' },
          },
        },
      },
      responses: {
        201: {
          description: 'Registration successful',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginResponse' },
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
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Refresh token',
      description: 'Get a new access token using refresh token',
      requestBody: jsonRequestBody('#/components/schemas/RefreshTokenRequest'),
      responses: {
        200: jsonResponse('Token refreshed', '#/components/schemas/RefreshTokenResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Logout',
      description: 'Revoke the current access token and optionally the refresh token.',
      security: bearerAuth,
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LogoutRequest' },
          },
        },
      },
      responses: {
        200: successResponse,
        401: apiErrorResponse,
      },
    },
  },
  '/auth/logout-all': {
    post: {
      tags: ['Auth'],
      summary: 'Logout all sessions',
      description: 'Revoke all refresh and access tokens for the authenticated user.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('All sessions revoked', '#/components/schemas/LogoutAllResponse'),
        401: apiErrorResponse,
      },
    },
  },
  '/auth/2fa/verify': {
    post: {
      tags: ['Auth'],
      summary: 'Verify 2FA login',
      description: 'Exchange a temporary 2FA token and verification code for full auth tokens.',
      requestBody: jsonRequestBody('#/components/schemas/TwoFactorVerifyRequest'),
      responses: {
        200: jsonResponse('2FA verified', '#/components/schemas/LoginResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
      },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Get current user',
      description: 'Get the authenticated user profile.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Current user', '#/components/schemas/User'),
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/auth/me/preferences': {
    patch: {
      tags: ['Auth'],
      summary: 'Update user preferences',
      description: 'Merge new preferences into the authenticated user profile.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/UpdateUserPreferencesRequest'),
      responses: {
        200: jsonResponse('Updated user', '#/components/schemas/User'),
        401: apiErrorResponse,
      },
    },
  },
  '/auth/sessions': {
    get: {
      tags: ['Auth'],
      summary: 'List sessions',
      description: 'List active sessions for the authenticated user.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Active sessions', '#/components/schemas/SessionsResponse'),
        401: apiErrorResponse,
      },
    },
  },
  '/auth/sessions/{id}': {
    delete: {
      tags: ['Auth'],
      summary: 'Revoke session',
      description: 'Revoke one active session for the authenticated user.',
      security: bearerAuth,
      parameters: [sessionIdParameter],
      responses: {
        200: successResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
