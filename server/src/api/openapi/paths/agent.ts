import { agentBearerAuth } from '../security';

const fundingWalletIdParameter = {
  name: 'fundingWalletId',
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

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

export const agentPaths = {
  '/agent/wallets/{fundingWalletId}/summary': {
    get: {
      tags: ['Agent'],
      summary: 'Get linked wallet summary',
      description: 'Return minimal funding and operational wallet metadata for the scoped agent credential.',
      security: agentBearerAuth,
      parameters: [fundingWalletIdParameter],
      responses: {
        200: {
          description: 'Linked wallet summary',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AgentLinkedWalletSummary' },
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/agent/wallets/{fundingWalletId}/operational-address': {
    get: {
      tags: ['Agent'],
      summary: 'Get operational receive address',
      description: 'Return the next known unused receive address for the linked operational wallet.',
      security: agentBearerAuth,
      parameters: [fundingWalletIdParameter],
      responses: {
        200: {
          description: 'Operational receive address',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AgentOperationalAddress' },
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/agent/wallets/{fundingWalletId}/funding-drafts': {
    post: {
      tags: ['Agent'],
      summary: 'Submit agent funding draft',
      description: 'Submit an agent-signed funding draft for human multisig review. Drafts outside configured agent policy caps are rejected; agents cannot request or apply owner overrides.',
      security: agentBearerAuth,
      parameters: [fundingWalletIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AgentFundingDraftRequest' },
          },
        },
      },
      responses: {
        201: {
          description: 'Draft transaction',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DraftTransaction' },
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        409: apiErrorResponse,
      },
    },
  },
  '/agent/wallets/{fundingWalletId}/funding-drafts/{draftId}/signature': {
    patch: {
      tags: ['Agent'],
      summary: 'Update agent funding draft signature',
      description: 'Add or refresh the agent signature for one of the agent credential’s own funding drafts.',
      security: agentBearerAuth,
      parameters: [fundingWalletIdParameter, draftIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AgentFundingDraftSignatureRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Draft transaction',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DraftTransaction' },
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
