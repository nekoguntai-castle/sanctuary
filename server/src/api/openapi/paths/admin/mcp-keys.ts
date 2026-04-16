import {
  apiErrorResponse,
  bearerAuth,
  jsonArrayResponse,
  jsonRequestBody,
  jsonResponse,
} from './shared';

const adminMcpKeyIdParameter = {
  name: 'keyId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminMcpKeyPaths = {
  '/admin/mcp-keys': {
    get: {
      tags: ['Admin'],
      summary: 'List MCP API keys',
      description: 'List metadata for scoped MCP API keys. Full tokens and key hashes are never returned.',
      security: bearerAuth,
      responses: {
        200: jsonArrayResponse('MCP API key metadata', '#/components/schemas/AdminMcpApiKey'),
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create MCP API key',
      description: 'Create a scoped read-only MCP API key. The full token is returned once.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminCreateMcpApiKeyRequest'),
      responses: {
        201: jsonResponse('Created MCP API key with one-time token', '#/components/schemas/AdminCreateMcpApiKeyResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/admin/mcp-keys/{keyId}': {
    delete: {
      tags: ['Admin'],
      summary: 'Revoke MCP API key',
      description: 'Soft-revoke a scoped MCP API key.',
      security: bearerAuth,
      parameters: [adminMcpKeyIdParameter],
      responses: {
        200: jsonResponse('Revoked MCP API key metadata', '#/components/schemas/AdminMcpApiKey'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
