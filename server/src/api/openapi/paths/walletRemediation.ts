import { browserOrBearerAuth } from '../security';

const walletId = { name: 'walletId', in: 'path', required: true, schema: { type: 'string' } } as const;
const proposalId = {
  name: 'proposalId', in: 'path', required: true,
  schema: { type: 'string', pattern: '^wallet-remediation-v1:[0-9a-f]{64}$' },
} as const;
const error = { description: 'Error response', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } } as const;
const proposal = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/WalletRemediationProposal' } } },
});
const evidenceExport = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/WalletRemediationExport' } } },
});

export const walletRemediationPaths = {
  '/wallets/{walletId}/remediation/proposals': {
    post: {
      tags: ['Wallets'],
      summary: 'Create an immutable wallet metadata remediation preview',
      description: 'Owner-only. Creates a new attempt whose full immutable document is content-addressed for the exact current wallet. It never changes descriptors, keys, addresses, scripts, or spend conditions.',
      security: browserOrBearerAuth,
      parameters: [walletId],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } },
      },
      responses: { 201: proposal('Immutable preview'), 400: error, 401: error, 403: error, 404: error, 409: error, 500: error },
    },
  },
  '/wallets/{walletId}/remediation/proposals/{proposalId}/approve': {
    post: {
      tags: ['Wallets'],
      summary: 'Approve and apply one exact wallet metadata remediation proposal',
      description: 'Owner-only. Applies only the exact proposal ID and SHA-256 digest after a fresh proof in one serializable transaction. Stale or ambiguous proposals fail closed.',
      security: browserOrBearerAuth,
      parameters: [walletId, proposalId],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/WalletRemediationApprovalRequest' } } },
      },
      responses: { 200: proposal('Applied or idempotently replayed proposal'), 400: error, 401: error, 403: error, 404: error, 409: error, 500: error },
    },
  },
  '/wallets/{walletId}/remediation/proposals/{proposalId}/cancel': {
    post: {
      tags: ['Wallets'],
      summary: 'Cancel one exact wallet metadata remediation proposal',
      description: 'Owner-only. Appends immutable cancellation evidence without changing active wallet metadata. Applied proposals cannot be cancelled.',
      security: browserOrBearerAuth,
      parameters: [walletId, proposalId],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/WalletRemediationApprovalRequest' } } },
      },
      responses: { 200: proposal('Cancelled or idempotently replayed proposal'), 400: error, 401: error, 403: error, 404: error, 409: error, 500: error },
    },
  },
  '/wallets/{walletId}/remediation/proposals/{proposalId}/export': {
    get: {
      tags: ['Wallets'],
      summary: 'Export exact immutable wallet remediation evidence',
      description: 'Owner-only recovery export. No latest, list, or bulk lookup exists.',
      security: browserOrBearerAuth,
      parameters: [walletId, proposalId, {
        name: 'digest', in: 'query', required: true,
        schema: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      }],
      responses: { 200: evidenceExport('Recovery evidence export with original state and verified event chain'), 400: error, 401: error, 403: error, 404: error, 500: error },
    },
  },
} as const;
