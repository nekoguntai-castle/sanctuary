/**
 * Auth API Path Definitions
 *
 * OpenAPI path definitions for authentication endpoints.
 */

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
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                refreshToken: { type: 'string' },
              },
              required: ['refreshToken'],
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Token refreshed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
