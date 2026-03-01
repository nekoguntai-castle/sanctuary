/**
 * Auth OpenAPI Schemas
 *
 * Schema definitions for authentication and authorization.
 */

export const authSchemas = {
  LoginRequest: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 3 },
      password: { type: 'string', minLength: 8 },
    },
    required: ['username', 'password'],
  },
  RegisterRequest: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 3 },
      password: { type: 'string', minLength: 8 },
    },
    required: ['username', 'password'],
  },
  LoginResponse: {
    type: 'object',
    properties: {
      token: { type: 'string' },
      refreshToken: { type: 'string' },
      user: { $ref: '#/components/schemas/User' },
      requires2FA: { type: 'boolean' },
    },
    required: ['token', 'refreshToken', 'user'],
  },
  User: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
      isAdmin: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      preferences: { type: 'object' },
      has2FA: { type: 'boolean' },
    },
    required: ['id', 'username', 'isAdmin', 'createdAt', 'has2FA'],
  },
} as const;
