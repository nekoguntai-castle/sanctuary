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
      username: { type: 'string', minLength: 1 },
      password: { type: 'string', minLength: 8 },
      email: { type: 'string', format: 'email' },
    },
    required: ['username', 'password', 'email'],
  },
  RegistrationStatusResponse: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
    },
    required: ['enabled'],
  },
  LoginResponse: {
    type: 'object',
    properties: {
      expiresIn: { type: 'integer' },
      user: { $ref: '#/components/schemas/User' },
      requires2FA: { type: 'boolean' },
      tempToken: { type: 'string' },
      emailVerificationRequired: { type: 'boolean' },
      verificationEmailSent: { type: 'boolean' },
      message: { type: 'string' },
    },
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
      expiresIn: { type: 'integer' },
    },
    required: ['expiresIn'],
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
  TwoFactorSetupResponse: {
    type: 'object',
    properties: {
      secret: { type: 'string' },
      qrCodeDataUrl: { type: 'string' },
    },
    required: ['secret', 'qrCodeDataUrl'],
  },
  TwoFactorTokenRequest: {
    type: 'object',
    properties: {
      token: { type: 'string', minLength: 1 },
    },
    required: ['token'],
  },
  TwoFactorBackupCodesResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      backupCodes: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['success', 'backupCodes'],
  },
  TwoFactorDisableRequest: {
    type: 'object',
    properties: {
      password: { type: 'string', minLength: 1 },
      token: { type: 'string', minLength: 1 },
    },
    required: ['password', 'token'],
  },
  TwoFactorDisableResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
    },
    required: ['success'],
  },
  BackupCodesCountRequest: {
    type: 'object',
    properties: {
      password: { type: 'string', minLength: 1 },
    },
    required: ['password'],
  },
  BackupCodesCountResponse: {
    type: 'object',
    properties: {
      remaining: { type: 'integer' },
    },
    required: ['remaining'],
  },
  TwoFactorBackupCodesRegenerateRequest: {
    type: 'object',
    properties: {
      password: { type: 'string', minLength: 1 },
      token: { type: 'string', minLength: 1 },
    },
    required: ['password', 'token'],
  },
  ChangePasswordRequest: {
    type: 'object',
    properties: {
      currentPassword: { type: 'string', minLength: 1 },
      newPassword: { type: 'string', minLength: 8 },
    },
    required: ['currentPassword', 'newPassword'],
  },
  AuthMessageResponse: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  VerifyEmailRequest: {
    type: 'object',
    properties: {
      token: { type: 'string', minLength: 1 },
    },
    required: ['token'],
  },
  VerifyEmailResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      email: { type: 'string', format: 'email' },
    },
    required: ['success', 'message', 'email'],
  },
  EmailResendResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      expiresAt: { type: 'string', format: 'date-time' },
    },
    required: ['success', 'message', 'expiresAt'],
  },
  UpdateEmailRequest: {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1 },
    },
    required: ['email', 'password'],
  },
  UpdateEmailResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      email: { type: 'string', format: 'email', nullable: true },
      emailVerified: { type: 'boolean' },
      verificationSent: { type: 'boolean' },
    },
    required: ['success', 'message', 'email', 'emailVerified', 'verificationSent'],
  },
  TelegramChatIdRequest: {
    type: 'object',
    properties: {
      botToken: { type: 'string', minLength: 1 },
    },
    required: ['botToken'],
  },
  TelegramChatIdResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      chatId: { type: 'string' },
      username: { type: 'string' },
    },
    required: ['success'],
  },
  TelegramTestRequest: {
    type: 'object',
    properties: {
      botToken: { type: 'string', minLength: 1 },
      chatId: { type: 'string', minLength: 1 },
    },
    required: ['botToken', 'chatId'],
  },
  TelegramTestResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
    },
    required: ['success', 'message'],
  },
  UserGroupSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      memberCount: { type: 'integer' },
      memberIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['id', 'name', 'memberCount', 'memberIds'],
  },
  UserSearchResult: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
    },
    required: ['id', 'username'],
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
