/**
 * Auth OpenAPI Schemas
 *
 * Schema definitions for authentication and authorization.
 */

import { MOBILE_API_REQUEST_LIMITS } from '../../../../../shared/schemas/mobileApiRequests';

export const authSchemas = {
  LoginRequest: {
    type: 'object',
    properties: {
      username: {
        type: 'string',
        minLength: MOBILE_API_REQUEST_LIMITS.usernameMinLength,
        maxLength: MOBILE_API_REQUEST_LIMITS.usernameMaxLength,
      },
      password: {
        type: 'string',
        minLength: MOBILE_API_REQUEST_LIMITS.loginPasswordMinLength,
      },
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
  RefreshTokenRequest: {
    type: 'object',
    properties: {
      refreshToken: {
        type: 'string',
        minLength: MOBILE_API_REQUEST_LIMITS.refreshTokenMinLength,
      },
      rotate: { type: 'boolean', deprecated: true },
    },
    required: ['refreshToken'],
  },
  RefreshTokenResponse: {
    type: 'object',
    properties: {
      token: { type: 'string' },
      refreshToken: { type: 'string' },
      expiresIn: { type: 'integer' },
    },
    required: ['token', 'refreshToken', 'expiresIn'],
  },
  LogoutRequest: {
    type: 'object',
    properties: {
      refreshToken: { type: 'string' },
    },
  },
  LogoutAllResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      sessionsRevoked: { type: 'integer' },
    },
    required: ['success', 'message', 'sessionsRevoked'],
  },
  TwoFactorVerifyRequest: {
    type: 'object',
    properties: {
      tempToken: { type: 'string', minLength: 1 },
      code: { type: 'string', minLength: 1 },
    },
    required: ['tempToken', 'code'],
  },
  UserPreferences: {
    type: 'object',
    additionalProperties: true,
  },
  UpdateUserPreferencesRequest: {
    type: 'object',
    additionalProperties: true,
  },
  Session: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      deviceName: { type: 'string' },
      userAgent: { type: 'string', nullable: true },
      ipAddress: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      lastUsedAt: { type: 'string', format: 'date-time' },
      isCurrent: { type: 'boolean' },
    },
    required: ['id', 'deviceName', 'createdAt', 'lastUsedAt', 'isCurrent'],
  },
  SessionsResponse: {
    type: 'object',
    properties: {
      sessions: {
        type: 'array',
        items: { $ref: '#/components/schemas/Session' },
      },
      count: { type: 'integer' },
    },
    required: ['sessions', 'count'],
  },
  User: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
      email: { type: 'string', nullable: true },
      isAdmin: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      preferences: { $ref: '#/components/schemas/UserPreferences' },
      has2FA: { type: 'boolean' },
      twoFactorEnabled: { type: 'boolean' },
      usingDefaultPassword: { type: 'boolean' },
    },
    required: ['id', 'username', 'isAdmin', 'createdAt', 'has2FA'],
  },
} as const;
