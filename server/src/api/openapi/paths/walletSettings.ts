/**
 * Wallet Settings API Path Definitions
 *
 * OpenAPI path definitions for per-wallet Telegram and Autopilot settings endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
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

export const walletSettingsPaths = {
  '/wallets/{walletId}/telegram': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet Telegram settings',
      description: 'Get per-wallet Telegram notification settings for the authenticated user.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet Telegram settings', '#/components/schemas/WalletTelegramSettingsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Wallets'],
      summary: 'Update wallet Telegram settings',
      description: 'Update per-wallet Telegram notification settings for the authenticated user.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UpdateWalletTelegramSettingsRequest'),
      responses: {
        200: jsonResponse('Wallet Telegram settings updated', '#/components/schemas/WalletSettingsUpdateResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/autopilot': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet Autopilot settings',
      description: 'Get per-wallet Treasury Autopilot settings. Requires the treasuryAutopilot feature flag.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet Autopilot settings', '#/components/schemas/WalletAutopilotSettingsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Wallets'],
      summary: 'Update wallet Autopilot settings',
      description: 'Update per-wallet Treasury Autopilot settings. Requires the treasuryAutopilot feature flag.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UpdateWalletAutopilotSettingsRequest'),
      responses: {
        200: jsonResponse('Wallet Autopilot settings updated', '#/components/schemas/WalletSettingsUpdateResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/autopilot/status': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet Autopilot status',
      description: 'Get UTXO health and fee analysis for Treasury Autopilot. Requires the treasuryAutopilot feature flag.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet Autopilot status', '#/components/schemas/WalletAutopilotStatusResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
