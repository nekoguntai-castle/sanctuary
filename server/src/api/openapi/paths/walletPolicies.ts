/**
 * Wallet Policy API Path Definitions
 *
 * OpenAPI path definitions for wallet-scoped vault policies and approvals.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const policyIdParameter = {
  name: 'policyId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const draftIdParameter = {
  name: 'draftId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const requestIdParameter = {
  name: 'requestId',
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

const policyEventQueryParameters = [
  {
    name: 'policyId',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  },
  {
    name: 'eventType',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  },
  {
    name: 'from',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date-time' },
  },
  {
    name: 'to',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date-time' },
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  },
  {
    name: 'offset',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 0, default: 0 },
  },
] as const;

export const walletPolicyPaths = {
  '/approvals/pending': {
    get: {
      tags: ['Wallets'],
      summary: 'List pending approvals',
      description: 'List pending approval requests across wallets where the authenticated user has owner or approver access.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Pending approvals', '#/components/schemas/PendingApprovalsResponse'),
        401: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/policies/events': {
    get: {
      tags: ['Wallets'],
      summary: 'List wallet policy events',
      description: 'Get policy event log entries for a wallet.',
      security: bearerAuth,
      parameters: [walletIdParameter, ...policyEventQueryParameters],
      responses: {
        200: jsonResponse('Policy events', '#/components/schemas/PolicyEventsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/policies/evaluate': {
    post: {
      tags: ['Wallets'],
      summary: 'Preview policy evaluation',
      description: 'Evaluate which wallet policies would trigger for transaction details without creating events.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/PolicyEvaluationRequest'),
      responses: {
        200: jsonResponse('Policy evaluation result', '#/components/schemas/PolicyEvaluationResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/policies': {
    get: {
      tags: ['Wallets'],
      summary: 'List wallet policies',
      description: 'List wallet policies, including inherited policies by default.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        {
          name: 'includeInherited',
          in: 'query',
          required: false,
          schema: { type: 'boolean', default: true },
        },
      ],
      responses: {
        200: jsonResponse('Wallet policies', '#/components/schemas/VaultPolicyListResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Wallets'],
      summary: 'Create wallet policy',
      description: 'Create a wallet-level vault policy. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/CreateVaultPolicyRequest'),
      responses: {
        201: jsonResponse('Wallet policy created', '#/components/schemas/VaultPolicyResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/policies/{policyId}': {
    get: {
      tags: ['Wallets'],
      summary: 'Get wallet policy',
      description: 'Get a policy in wallet context.',
      security: bearerAuth,
      parameters: [walletIdParameter, policyIdParameter],
      responses: {
        200: jsonResponse('Wallet policy', '#/components/schemas/VaultPolicyResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Wallets'],
      summary: 'Update wallet policy',
      description: 'Update a wallet-level vault policy. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter, policyIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UpdateVaultPolicyRequest'),
      responses: {
        200: jsonResponse('Wallet policy updated', '#/components/schemas/VaultPolicyResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Wallets'],
      summary: 'Delete wallet policy',
      description: 'Delete a wallet-level vault policy. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter, policyIdParameter],
      responses: {
        200: jsonResponse('Wallet policy deleted', '#/components/schemas/WalletPolicyDeleteResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/policies/{policyId}/addresses': {
    get: {
      tags: ['Wallets'],
      summary: 'List policy addresses',
      description: 'List allow/deny addresses for an address-control policy.',
      security: bearerAuth,
      parameters: [
        walletIdParameter,
        policyIdParameter,
        {
          name: 'listType',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['allow', 'deny'] },
        },
      ],
      responses: {
        200: jsonResponse('Policy addresses', '#/components/schemas/PolicyAddressListResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Wallets'],
      summary: 'Add policy address',
      description: 'Add an allow/deny address to an address-control policy. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter, policyIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/CreatePolicyAddressRequest'),
      responses: {
        201: jsonResponse('Policy address created', '#/components/schemas/PolicyAddressResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/policies/{policyId}/addresses/{addressId}': {
    delete: {
      tags: ['Wallets'],
      summary: 'Remove policy address',
      description: 'Remove an address from an address-control policy. Owner access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter, policyIdParameter, addressIdParameter],
      responses: {
        200: jsonResponse('Policy address removed', '#/components/schemas/WalletPolicyDeleteResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/drafts/{draftId}/approvals': {
    get: {
      tags: ['Wallets'],
      summary: 'List draft approvals',
      description: 'List approval requests for a draft transaction.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter],
      responses: {
        200: jsonResponse('Draft approvals', '#/components/schemas/WalletApprovalsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/drafts/{draftId}/approvals/{requestId}/vote': {
    post: {
      tags: ['Wallets'],
      summary: 'Vote on draft approval',
      description: 'Cast an approval, rejection, or veto vote. Owner or approver access is required.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter, requestIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/ApprovalVoteRequest'),
      responses: {
        200: jsonResponse('Approval vote result', '#/components/schemas/ApprovalVoteResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/wallets/{walletId}/drafts/{draftId}/override': {
    post: {
      tags: ['Wallets'],
      summary: 'Override draft approvals',
      description: 'Owner force-approve pending approvals for a draft transaction.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/OwnerOverrideRequest'),
      responses: {
        200: jsonResponse('Approvals overridden', '#/components/schemas/WalletSettingsUpdateResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
