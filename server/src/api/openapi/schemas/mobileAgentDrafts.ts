/**
 * Mobile Agent Draft OpenAPI Schemas
 */

const JsonSummaryValue = {
  nullable: true,
  oneOf: [
    { type: 'array', items: {} },
    { type: 'object', additionalProperties: true },
  ],
} as const;

const SatoshiString = {
  type: 'string',
  pattern: '^\\d+$',
  description: 'Amount in satoshis encoded as a decimal string.',
} as const;

export const mobileAgentDraftSchemas = {
  MobileAgentFundingDraftWallet: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      network: { type: 'string' },
    },
    required: ['id', 'name', 'type', 'network'],
  },
  MobileAgentFundingDraftSummary: {
    type: 'object',
    properties: {
      inputs: JsonSummaryValue,
      outputs: JsonSummaryValue,
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
      totalInputSats: SatoshiString,
      totalOutputSats: SatoshiString,
      changeAmountSats: SatoshiString,
      changeAddress: { type: 'string', nullable: true },
      effectiveAmountSats: SatoshiString,
      inputPaths: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'inputs',
      'outputs',
      'selectedUtxoIds',
      'totalInputSats',
      'totalOutputSats',
      'changeAmountSats',
      'changeAddress',
      'effectiveAmountSats',
      'inputPaths',
    ],
  },
  MobileAgentFundingDraftSigning: {
    type: 'object',
    properties: {
      canSign: { type: 'boolean' },
      signedDeviceIds: { type: 'array', items: { type: 'string' } },
      signatureEndpoint: { type: 'string' },
      signedPsbtUploadSupported: { type: 'boolean' },
      supportedSignerRequired: { type: 'boolean' },
    },
    required: [
      'canSign',
      'signedDeviceIds',
      'signatureEndpoint',
      'signedPsbtUploadSupported',
      'supportedSignerRequired',
    ],
  },
  MobileAgentFundingDraftReviewActions: {
    type: 'object',
    properties: {
      canApprove: { type: 'boolean' },
      canReject: { type: 'boolean' },
      canComment: { type: 'boolean' },
      approveEndpoint: { type: 'string' },
      rejectEndpoint: { type: 'string' },
      commentEndpoint: { type: 'string' },
    },
    required: [
      'canApprove',
      'canReject',
      'canComment',
      'approveEndpoint',
      'rejectEndpoint',
      'commentEndpoint',
    ],
  },
  MobileAgentFundingDraftDeepLink: {
    type: 'object',
    properties: {
      scheme: { type: 'string' },
      webPath: { type: 'string' },
      apiPath: { type: 'string' },
      notificationPayload: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['agent_funding_draft'] },
          walletId: { type: 'string' },
          draftId: { type: 'string' },
          agentId: { type: 'string' },
        },
        required: ['type', 'walletId', 'draftId', 'agentId'],
      },
    },
    required: ['scheme', 'webPath', 'apiPath', 'notificationPayload'],
  },
  MobileAgentFundingDraft: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string' },
      wallet: { $ref: '#/components/schemas/MobileAgentFundingDraftWallet' },
      agentId: { type: 'string' },
      agentOperationalWalletId: { type: 'string', nullable: true },
      recipient: { type: 'string' },
      amountSats: SatoshiString,
      feeSats: SatoshiString,
      feeRate: { type: 'number' },
      status: { type: 'string', enum: ['unsigned', 'partial', 'signed'] },
      approvalStatus: { type: 'string' },
      label: { type: 'string', nullable: true },
      memo: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
      summary: { $ref: '#/components/schemas/MobileAgentFundingDraftSummary' },
      signing: { $ref: '#/components/schemas/MobileAgentFundingDraftSigning' },
      review: { $ref: '#/components/schemas/MobileAgentFundingDraftReviewActions' },
      deepLink: { $ref: '#/components/schemas/MobileAgentFundingDraftDeepLink' },
    },
    required: [
      'id',
      'walletId',
      'wallet',
      'agentId',
      'agentOperationalWalletId',
      'recipient',
      'amountSats',
      'feeSats',
      'feeRate',
      'status',
      'approvalStatus',
      'label',
      'memo',
      'createdAt',
      'updatedAt',
      'expiresAt',
      'summary',
      'signing',
      'review',
      'deepLink',
    ],
  },
  MobileAgentFundingDraftListResponse: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        items: { $ref: '#/components/schemas/MobileAgentFundingDraft' },
      },
    },
    required: ['drafts'],
  },
  MobileAgentFundingDraftResponse: {
    type: 'object',
    properties: {
      draft: { $ref: '#/components/schemas/MobileAgentFundingDraft' },
    },
    required: ['draft'],
  },
  MobileAgentFundingDraftApproveRequest: {
    type: 'object',
    properties: {
      comment: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    additionalProperties: false,
  },
  MobileAgentFundingDraftCommentRequest: {
    type: 'object',
    properties: {
      comment: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    required: ['comment'],
    additionalProperties: false,
  },
  MobileAgentFundingDraftRejectRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  MobileAgentFundingDraftSignatureRequest: {
    type: 'object',
    properties: {
      signedPsbtBase64: { type: 'string', minLength: 1 },
      signedDeviceId: { type: 'string', minLength: 1, maxLength: 200 },
      status: { type: 'string', enum: ['unsigned', 'partial', 'signed'] },
    },
    required: ['signedPsbtBase64', 'signedDeviceId'],
    additionalProperties: false,
  },
  MobileAgentFundingDraftDecisionResponse: {
    type: 'object',
    properties: {
      draft: { $ref: '#/components/schemas/MobileAgentFundingDraft' },
      decision: { type: 'string', enum: ['approve', 'comment', 'reject'] },
      comment: { type: 'string', nullable: true },
      nextAction: { type: 'string', enum: ['sign', 'none'] },
    },
    required: ['draft', 'decision', 'comment', 'nextAction'],
  },
} as const;
