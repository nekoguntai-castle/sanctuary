/**
 * Auth API Path Definitions
 *
 * OpenAPI path definitions for authentication endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

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

const sessionIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const authPaths = {
  '/auth/registration-status': {
    get: {
      tags: ['Auth'],
      summary: 'Get registration status',
      description: 'Check whether public self-registration is enabled.',
      responses: {
        200: jsonResponse('Registration status', '#/components/schemas/RegistrationStatusResponse'),
        500: apiErrorResponse,
      },
    },
  },
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
          description: 'Login successful, or 2FA verification required',
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
        403: apiErrorResponse,
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
        403: apiErrorResponse,
        409: apiErrorResponse,
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
  '/auth/2fa/setup': {
    post: {
      tags: ['Auth'],
      summary: 'Start 2FA setup',
      description: 'Generate a 2FA secret and QR code for the authenticated user.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('2FA setup details', '#/components/schemas/TwoFactorSetupResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/auth/2fa/enable': {
    post: {
      tags: ['Auth'],
      summary: 'Enable 2FA',
      description: 'Verify the setup token and enable 2FA for the authenticated user.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/TwoFactorTokenRequest'),
      responses: {
        200: jsonResponse('2FA enabled', '#/components/schemas/TwoFactorBackupCodesResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/auth/2fa/disable': {
    post: {
      tags: ['Auth'],
      summary: 'Disable 2FA',
      description: 'Disable 2FA after password and current 2FA token verification.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/TwoFactorDisableRequest'),
      responses: {
        200: jsonResponse('2FA disabled', '#/components/schemas/TwoFactorDisableResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/auth/2fa/backup-codes': {
    post: {
      tags: ['Auth'],
      summary: 'Get backup code count',
      description: 'Get the remaining 2FA backup code count after password verification.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/BackupCodesCountRequest'),
      responses: {
        200: jsonResponse('Remaining backup code count', '#/components/schemas/BackupCodesCountResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/auth/2fa/backup-codes/regenerate': {
    post: {
      tags: ['Auth'],
      summary: 'Regenerate backup codes',
      description: 'Generate new 2FA backup codes after password and current 2FA token verification.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/TwoFactorBackupCodesRegenerateRequest'),
      responses: {
        200: jsonResponse('New backup codes', '#/components/schemas/TwoFactorBackupCodesResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
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
  '/auth/me/groups': {
    get: {
      tags: ['Auth'],
      summary: 'List current user groups',
      description: 'List groups the authenticated user belongs to.',
      security: bearerAuth,
      responses: {
        200: arrayResponse('Current user groups', '#/components/schemas/UserGroupSummary'),
        401: apiErrorResponse,
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
  '/auth/me/change-password': {
    post: {
      tags: ['Auth'],
      summary: 'Change password',
      description: 'Change the authenticated user password after current password verification.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/ChangePasswordRequest'),
      responses: {
        200: jsonResponse('Password changed', '#/components/schemas/AuthMessageResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/auth/me/email': {
    put: {
      tags: ['Auth'],
      summary: 'Update email',
      description: 'Update the authenticated user email after password confirmation.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/UpdateEmailRequest'),
      responses: {
        200: jsonResponse('Email updated', '#/components/schemas/UpdateEmailResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
      },
    },
  },
  '/auth/users/search': {
    get: {
      tags: ['Auth'],
      summary: 'Search users',
      description: 'Search users by username for sharing flows.',
      security: bearerAuth,
      parameters: [
        {
          name: 'q',
          in: 'query',
          required: true,
          schema: { type: 'string', minLength: 2 },
        },
      ],
      responses: {
        200: arrayResponse('Matching users', '#/components/schemas/UserSearchResult'),
        400: apiErrorResponse,
        401: apiErrorResponse,
      },
    },
  },
  '/auth/email/verify': {
    post: {
      tags: ['Auth'],
      summary: 'Verify email',
      description: 'Verify an email address using a token from the verification email.',
      requestBody: jsonRequestBody('#/components/schemas/VerifyEmailRequest'),
      responses: {
        200: jsonResponse('Email verified', '#/components/schemas/VerifyEmailResponse'),
        400: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/auth/email/resend': {
    post: {
      tags: ['Auth'],
      summary: 'Resend verification email',
      description: 'Resend the verification email for the authenticated user.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Verification email sent', '#/components/schemas/EmailResendResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/auth/telegram/chat-id': {
    post: {
      tags: ['Auth'],
      summary: 'Fetch Telegram chat ID',
      description: 'Fetch a Telegram chat ID from recent bot messages for notification setup.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/TelegramChatIdRequest'),
      responses: {
        200: jsonResponse('Telegram chat ID', '#/components/schemas/TelegramChatIdResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/auth/telegram/test': {
    post: {
      tags: ['Auth'],
      summary: 'Test Telegram configuration',
      description: 'Send a test Telegram message using the supplied bot token and chat ID.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/TelegramTestRequest'),
      responses: {
        200: jsonResponse('Telegram test result', '#/components/schemas/TelegramTestResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
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
