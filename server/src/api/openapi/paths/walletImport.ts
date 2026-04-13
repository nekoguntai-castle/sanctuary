/**
 * Wallet Import API Path Definitions
 *
 * OpenAPI path definitions for wallet import and XPUB validation endpoints.
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

export const walletImportPaths = {
  '/wallets/import/formats': {
    get: {
      tags: ['Wallets'],
      summary: 'List wallet import formats',
      description: 'Get available wallet import format handlers and file extension hints.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Wallet import formats', '#/components/schemas/WalletImportFormatsResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/import/validate': {
    post: {
      tags: ['Wallets'],
      summary: 'Validate wallet import data',
      description: 'Validate descriptor or JSON import data and preview the wallet/devices that would be imported.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/WalletImportValidateRequest'),
      responses: {
        200: jsonResponse('Wallet import validation result', '#/components/schemas/WalletImportValidationResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/import': {
    post: {
      tags: ['Wallets'],
      summary: 'Import wallet',
      description: 'Create a wallet from descriptor or supported JSON import data.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/WalletImportRequest'),
      responses: {
        201: jsonResponse('Wallet imported', '#/components/schemas/WalletImportResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/validate-xpub': {
    post: {
      tags: ['Wallets'],
      summary: 'Validate XPUB',
      description: 'Validate an extended public key and return a descriptor preview plus the first derived address.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/ValidateXpubRequest'),
      responses: {
        200: jsonResponse('XPUB validation result', '#/components/schemas/ValidateXpubResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
