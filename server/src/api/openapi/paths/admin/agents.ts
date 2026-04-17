import {
  apiErrorResponse,
  bearerAuth,
  jsonArrayResponse,
  jsonRequestBody,
  jsonResponse,
} from './shared';

const adminAgentIdParameter = {
  name: 'agentId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const adminAgentKeyIdParameter = {
  name: 'keyId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminAgentPaths = {
  '/admin/agents/options': {
    get: {
      tags: ['Admin'],
      summary: 'List wallet agent form options',
      description: 'Return admin-visible users, wallets, and signer devices for wallet agent registration forms.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Wallet agent form options', '#/components/schemas/AdminAgentOptions'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/admin/agents': {
    get: {
      tags: ['Admin'],
      summary: 'List wallet agents',
      description: 'List linked wallet agent metadata and scoped key metadata. Full tokens and key hashes are never returned.',
      security: bearerAuth,
      parameters: [
        {
          name: 'walletId',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'uuid' },
          description: 'Filter agents linked to this funding or operational wallet.',
        },
      ],
      responses: {
        200: jsonArrayResponse('Wallet agent metadata', '#/components/schemas/AdminWalletAgent'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create wallet agent',
      description: 'Register a linked funding-wallet and operational-wallet agent profile.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminCreateWalletAgentRequest'),
      responses: {
        201: jsonResponse('Created wallet agent metadata', '#/components/schemas/AdminWalletAgent'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/admin/agents/{agentId}': {
    patch: {
      tags: ['Admin'],
      summary: 'Update wallet agent',
      description: 'Update wallet agent status and funding policy settings.',
      security: bearerAuth,
      parameters: [adminAgentIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateWalletAgentRequest'),
      responses: {
        200: jsonResponse('Updated wallet agent metadata', '#/components/schemas/AdminWalletAgent'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Revoke wallet agent',
      description: 'Soft-revoke a linked wallet agent profile.',
      security: bearerAuth,
      parameters: [adminAgentIdParameter],
      responses: {
        200: jsonResponse('Revoked wallet agent metadata', '#/components/schemas/AdminWalletAgent'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/admin/agents/{agentId}/alerts': {
    get: {
      tags: ['Admin'],
      summary: 'List agent alerts',
      description: 'List persisted operational monitoring alerts for a wallet agent.',
      security: bearerAuth,
      parameters: [
        adminAgentIdParameter,
        {
          name: 'status',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] },
        },
        {
          name: 'type',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      ],
      responses: {
        200: jsonArrayResponse('Agent alert metadata', '#/components/schemas/AdminAgentAlert'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/admin/agents/{agentId}/keys': {
    get: {
      tags: ['Admin'],
      summary: 'List agent API keys',
      description: 'List scoped agent API key metadata for a wallet agent.',
      security: bearerAuth,
      parameters: [adminAgentIdParameter],
      responses: {
        200: jsonArrayResponse('Agent API key metadata', '#/components/schemas/AdminAgentApiKey'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create agent API key',
      description: 'Create a scoped agent API key. The full token is returned once.',
      security: bearerAuth,
      parameters: [adminAgentIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminCreateAgentApiKeyRequest'),
      responses: {
        201: jsonResponse('Created agent API key with one-time token', '#/components/schemas/AdminCreateAgentApiKeyResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/admin/agents/{agentId}/keys/{keyId}': {
    delete: {
      tags: ['Admin'],
      summary: 'Revoke agent API key',
      description: 'Soft-revoke a scoped agent API key.',
      security: bearerAuth,
      parameters: [adminAgentIdParameter, adminAgentKeyIdParameter],
      responses: {
        200: jsonResponse('Revoked agent API key metadata', '#/components/schemas/AdminAgentApiKey'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
