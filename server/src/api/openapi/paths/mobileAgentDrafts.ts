/**
 * Mobile Agent Draft API Path Definitions
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const draftIdParameter = {
  name: 'draftId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const limitParameter = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
} as const;

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

function requestBody(schemaRef: string, required = true) {
  return {
    required,
    content: {
      'application/json': {
        schema: { $ref: schemaRef },
      },
    },
  } as const;
}

const draftResponse = {
  description: 'Agent funding draft review payload',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/MobileAgentFundingDraftResponse' },
    },
  },
} as const;

const decisionResponse = {
  description: 'Audited mobile review decision',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/MobileAgentFundingDraftDecisionResponse' },
    },
  },
} as const;

export const mobileAgentDraftPaths = {
  '/mobile/agent-funding-drafts': {
    get: {
      tags: ['Mobile Agent Drafts'],
      summary: 'List pending agent funding drafts for mobile review',
      description: 'List pending agent-submitted funding drafts visible to the authenticated mobile user.',
      security: bearerAuth,
      parameters: [limitParameter],
      responses: {
        200: {
          description: 'Pending agent funding drafts',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MobileAgentFundingDraftListResponse' },
            },
          },
        },
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
  },
  '/mobile/agent-funding-drafts/{draftId}': {
    get: {
      tags: ['Mobile Agent Drafts'],
      summary: 'Get one agent funding draft review payload',
      description: 'Get a decoded, mobile-friendly review payload for one pending agent funding draft.',
      security: bearerAuth,
      parameters: [draftIdParameter],
      responses: {
        200: draftResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/mobile/agent-funding-drafts/{draftId}/approve': {
    post: {
      tags: ['Mobile Agent Drafts'],
      summary: 'Record mobile approval intent for an agent draft',
      description: 'Record an audited human approval intent. Spending still requires a signed PSBT.',
      security: bearerAuth,
      parameters: [draftIdParameter],
      requestBody: requestBody('#/components/schemas/MobileAgentFundingDraftApproveRequest', false),
      responses: {
        200: decisionResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/mobile/agent-funding-drafts/{draftId}/comment': {
    post: {
      tags: ['Mobile Agent Drafts'],
      summary: 'Comment on an agent funding draft',
      description: 'Record an audited mobile review comment for an agent funding draft.',
      security: bearerAuth,
      parameters: [draftIdParameter],
      requestBody: requestBody('#/components/schemas/MobileAgentFundingDraftCommentRequest'),
      responses: {
        200: decisionResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/mobile/agent-funding-drafts/{draftId}/reject': {
    post: {
      tags: ['Mobile Agent Drafts'],
      summary: 'Reject an agent funding draft',
      description: 'Reject a pending agent funding draft so it is no longer offered for review.',
      security: bearerAuth,
      parameters: [draftIdParameter],
      requestBody: requestBody('#/components/schemas/MobileAgentFundingDraftRejectRequest'),
      responses: {
        200: decisionResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
  '/mobile/agent-funding-drafts/{draftId}/signature': {
    post: {
      tags: ['Mobile Agent Drafts'],
      summary: 'Submit a mobile signed PSBT for an agent draft',
      description: 'Submit a signed PSBT through the same draft update path used by web signing.',
      security: bearerAuth,
      parameters: [draftIdParameter],
      requestBody: requestBody('#/components/schemas/MobileAgentFundingDraftSignatureRequest'),
      responses: {
        200: draftResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
  },
} as const;
