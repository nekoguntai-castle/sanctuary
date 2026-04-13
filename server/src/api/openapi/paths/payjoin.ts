/**
 * Payjoin API Path Definitions
 *
 * OpenAPI path definitions for BIP78 Payjoin management and receiver endpoints.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const addressIdParameter = {
  name: 'addressId',
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

const payjoinTextErrorResponse = {
  description: 'BIP78 text error response',
  content: {
    'text/plain': {
      schema: { $ref: '#/components/schemas/PayjoinReceiverError' },
    },
  },
} as const;

export const payjoinPaths = {
  '/payjoin/status': {
    get: {
      tags: ['Payjoin'],
      summary: 'Get Payjoin status',
      description: 'Check whether Payjoin support is enabled and configured.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Payjoin status', '#/components/schemas/PayjoinStatusResponse'),
        401: apiErrorResponse,
      },
    },
  },
  '/payjoin/eligibility/{walletId}': {
    get: {
      tags: ['Payjoin'],
      summary: 'Get wallet Payjoin eligibility',
      description: 'Check whether a wallet has eligible UTXOs for receiving Payjoin transactions.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Payjoin eligibility', '#/components/schemas/PayjoinEligibilityResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/payjoin/address/{addressId}/uri': {
    get: {
      tags: ['Payjoin'],
      summary: 'Generate Payjoin BIP21 URI',
      description: 'Generate a BIP21 URI with a Payjoin receiver URL for a wallet address.',
      security: bearerAuth,
      parameters: [
        addressIdParameter,
        {
          name: 'amount',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, description: 'Amount in satoshis' },
        },
        {
          name: 'label',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'message',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: jsonResponse('Payjoin BIP21 URI', '#/components/schemas/PayjoinUriResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/payjoin/parse-uri': {
    post: {
      tags: ['Payjoin'],
      summary: 'Parse BIP21 URI',
      description: 'Parse a BIP21 URI and detect whether it includes a Payjoin endpoint.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/PayjoinParseUriRequest'),
      responses: {
        200: jsonResponse('Parsed BIP21 URI', '#/components/schemas/PayjoinParseUriResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/payjoin/attempt': {
    post: {
      tags: ['Payjoin'],
      summary: 'Attempt Payjoin send',
      description: 'Submit an original PSBT to a Payjoin receiver and return the proposal result.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/PayjoinAttemptRequest'),
      responses: {
        200: jsonResponse('Payjoin attempt result', '#/components/schemas/PayjoinAttemptResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/payjoin/{addressId}': {
    post: {
      tags: ['Payjoin'],
      summary: 'BIP78 Payjoin receiver endpoint',
      description: 'Unauthenticated BIP78 receiver endpoint that accepts an original PSBT and returns a proposal PSBT.',
      parameters: [
        addressIdParameter,
        {
          name: 'v',
          in: 'query',
          required: true,
          schema: { type: 'string', enum: ['1'] },
          description: 'BIP78 protocol version.',
        },
        {
          name: 'minfeerate',
          in: 'query',
          required: false,
          schema: { type: 'number', minimum: 0 },
          description: 'Minimum fee rate in sat/vB.',
        },
        {
          name: 'maxadditionalfeecontribution',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0 },
          description: 'Maximum additional fee contribution in satoshis.',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'text/plain': {
            schema: { type: 'string', minLength: 1, description: 'Original PSBT in base64 format' },
          },
        },
      },
      responses: {
        200: {
          description: 'Proposal PSBT in base64 format',
          content: {
            'text/plain': {
              schema: { type: 'string', minLength: 1 },
            },
          },
        },
        400: payjoinTextErrorResponse,
        403: payjoinTextErrorResponse,
        429: payjoinTextErrorResponse,
        500: payjoinTextErrorResponse,
      },
    },
  },
} as const;
