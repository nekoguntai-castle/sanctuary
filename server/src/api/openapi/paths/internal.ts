/**
 * Internal API Path Definitions
 *
 * OpenAPI path definitions for root-mounted internal gateway and AI container endpoints.
 */

const bearerAuth = [{ bearerAuth: [] }] as const;
const gatewayHmacAuth = [{ gatewaySignature: [], gatewayTimestamp: [] }] as const;

const internalRootServers = [
  {
    url: '/',
    description: 'Application root for internal and gateway-only routes',
  },
] as const;

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const transactionIdParameter = {
  name: 'id',
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

const internalErrorResponse = {
  description: 'Internal endpoint error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/InternalSimpleErrorResponse' },
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

const internalOnly = {
  servers: internalRootServers,
  'x-internal': true,
} as const;

export const internalPaths = {
  '/internal/mobile-permissions/check': {
    ...internalOnly,
    post: {
      tags: ['Internal'],
      summary: 'Check mobile permission for gateway',
      description: 'Gateway-only HMAC-authenticated route that checks whether a user may perform a mobile action on a wallet.',
      security: gatewayHmacAuth,
      requestBody: jsonRequestBody('#/components/schemas/InternalMobilePermissionCheckRequest'),
      responses: {
        200: jsonResponse('Gateway permission check result', '#/components/schemas/InternalMobilePermissionCheckResponse'),
        400: apiErrorResponse,
        403: internalErrorResponse,
        503: internalErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/internal/ai/pull-progress': {
    ...internalOnly,
    post: {
      tags: ['Internal'],
      summary: 'Receive AI model pull progress',
      description: 'Internal-network-only callback from the AI container that broadcasts model download progress to connected clients.',
      requestBody: jsonRequestBody('#/components/schemas/InternalAIPullProgressRequest'),
      responses: {
        200: jsonResponse('Pull progress accepted', '#/components/schemas/InternalAIPullProgressResponse'),
        400: internalErrorResponse,
        403: internalErrorResponse,
        500: internalErrorResponse,
      },
    },
  },
  '/internal/ai/tx/{id}': {
    ...internalOnly,
    get: {
      tags: ['Internal'],
      summary: 'Get sanitized AI transaction context',
      description: 'Internal AI container route that returns sanitized transaction metadata without txid or address fields.',
      security: bearerAuth,
      parameters: [transactionIdParameter],
      responses: {
        200: jsonResponse('Sanitized transaction context', '#/components/schemas/InternalAITransactionContext'),
        401: apiErrorResponse,
        403: internalErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/internal/ai/wallet/{walletId}/labels': {
    ...internalOnly,
    get: {
      tags: ['Internal'],
      summary: 'Get sanitized AI wallet label context',
      description: 'Internal AI container route that returns recent label names for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet label context', '#/components/schemas/InternalAIWalletLabelsResponse'),
        401: apiErrorResponse,
        403: internalErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/internal/ai/wallet/{walletId}/context': {
    ...internalOnly,
    get: {
      tags: ['Internal'],
      summary: 'Get sanitized AI wallet context',
      description: 'Internal AI container route that returns labels and aggregate counts without balances, addresses, or txids.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Wallet context', '#/components/schemas/InternalAIWalletContextResponse'),
        401: apiErrorResponse,
        403: internalErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/internal/ai/wallet/{walletId}/utxo-health': {
    ...internalOnly,
    get: {
      tags: ['Internal'],
      summary: 'Get sanitized AI UTXO health',
      description: 'Internal AI container route that returns aggregate UTXO health without addresses or txids.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('UTXO health profile', '#/components/schemas/InternalAIUtxoHealthResponse'),
        401: apiErrorResponse,
        403: internalErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/internal/ai/wallet/{walletId}/fee-history': {
    ...internalOnly,
    get: {
      tags: ['Internal'],
      summary: 'Get sanitized AI fee history',
      description: 'Internal AI container route that returns recent fee snapshots and trend information for treasury analysis.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Fee history summary', '#/components/schemas/InternalAIFeeHistoryResponse'),
        401: apiErrorResponse,
        403: internalErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/internal/ai/wallet/{walletId}/spending-velocity': {
    ...internalOnly,
    get: {
      tags: ['Internal'],
      summary: 'Get sanitized AI spending velocity',
      description: 'Internal AI container route that returns aggregate spending counts and totals for fixed time windows.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('Spending velocity summary', '#/components/schemas/InternalAISpendingVelocityResponse'),
        401: apiErrorResponse,
        403: internalErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/internal/ai/wallet/{walletId}/utxo-age-profile': {
    ...internalOnly,
    get: {
      tags: ['Internal'],
      summary: 'Get sanitized AI UTXO age profile',
      description: 'Internal AI container route that returns aggregate UTXO tax-age buckets and upcoming long-term milestones.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: jsonResponse('UTXO age profile', '#/components/schemas/InternalAIUtxoAgeProfileResponse'),
        401: apiErrorResponse,
        403: internalErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
