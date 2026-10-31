/**
 * Draft API Path Definitions
 *
 * OpenAPI path definitions for gateway-exposed draft transaction routes.
 */

import { browserOrBearerAuth as bearerAuth } from '../security';

const walletIdParameter = {
  name: 'walletId',
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

const draftResponse = {
  description: 'Draft transaction',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/DraftTransaction' },
    },
  },
} as const;

export const draftPaths = {
  '/wallets/{walletId}/drafts': {
    get: {
      tags: ['Drafts'],
      summary: 'List wallet drafts',
      description: 'Get draft transactions for a wallet the user can view.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      responses: {
        200: {
          description: 'Wallet drafts',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/DraftTransaction' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
      },
    },
    post: {
      tags: ['Drafts'],
      summary: 'Create draft',
      description: 'Create a draft transaction for a wallet the user can edit.',
      security: bearerAuth,
      parameters: [walletIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateDraftRequest' },
          },
        },
      },
      responses: {
        201: draftResponse,
        400: {
          ...apiErrorResponse,
          description:
            'Invalid request, or details.reason metadata_mismatch when the draft does not match its signing intent: '
            + 'selectedUtxoIds (omitted counts as []) must be exactly the intent inputs, fee (omitted counts as 0) '
            + 'must be inputs minus outputs, recipient must be the first external output and effectiveAmount '
            + '(or amount) the net external spend (no sendMax/subtractFees exemption), non-zero totalInput/'
            + 'totalOutput must equal the intent sums, and isRBF requires an intent with a replacement target, '
            + 'outputs must be distinct intent outputs covering every external output (required when the intent '
            + 'pays more than one; amount equal, or 0 on the one sendMax entry, or on a subtractFees draft above '
            + 'it by at most the fee in total), each decoy and the change address a further distinct wallet-owned '
            + 'intent output with its amount (changeAmount 0 without a change address), '
            + 'supplied inputs exactly the intent inputs with their prevout address and amount, a consolidation\'s '
            + 'recipient one of its outputs, and amount equal to the effective amount',
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        409: {
          ...apiErrorResponse,
          description:
            'details.reason payjoin_intent_not_draftable: a payjoin replacement intent, or an original a payjoin '
            + 'proposal was minted from, cannot be saved as a draft; intent_broadcast_in_flight: the signing '
            + 'intent\'s broadcast has already been claimed (in flight, uncertain or accepted), so it cannot be '
            + 'saved as a draft',
        },
      },
    },
  },
  '/wallets/{walletId}/drafts/{draftId}': {
    get: {
      tags: ['Drafts'],
      summary: 'Get draft',
      description: 'Get a specific draft transaction for a wallet the user can view.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter],
      responses: {
        200: draftResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Drafts'],
      summary: 'Delete draft',
      description:
        'Delete an actionable draft transaction. The creator or wallet owner may delete it; broadcasted drafts '
        + 'are retained.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter],
      responses: {
        204: { description: 'Draft deleted' },
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: {
          ...apiErrorResponse,
          description:
            'details.reason draft_retained: the draft was broadcast (or is no longer actionable) and is kept',
        },
      },
    },
    patch: {
      tags: ['Drafts'],
      summary: 'Update draft',
      description: 'Update draft transaction signing state or metadata.',
      security: bearerAuth,
      parameters: [walletIdParameter, draftIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateDraftRequest' },
          },
        },
      },
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
