export const agentSchemas = {
  AgentLinkedWalletSummary: {
    type: 'object',
    properties: {
      agent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string' },
          signerDeviceId: { type: 'string', nullable: true },
        },
        required: ['id', 'name', 'status', 'signerDeviceId'],
      },
      fundingWallet: { $ref: '#/components/schemas/AgentWalletSummary' },
      operationalWallet: { $ref: '#/components/schemas/AgentWalletSummary' },
      allowedActions: { type: 'array', items: { type: 'string' } },
    },
    required: ['agent', 'fundingWallet', 'operationalWallet', 'allowedActions'],
  },
  AgentWalletSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      network: { type: 'string' },
      balance: { type: 'string' },
    },
    required: ['id', 'name', 'type', 'network', 'balance'],
  },
  AgentOperationalAddress: {
    type: 'object',
    properties: {
      walletId: { type: 'string' },
      address: { type: 'string' },
      derivationPath: { type: 'string' },
      index: { type: 'integer' },
      generated: {
        type: 'boolean',
        description: 'True when Sanctuary derived and stored a fresh receive-address gap for this response.',
      },
    },
    required: ['walletId', 'address', 'derivationPath', 'index', 'generated'],
  },
  AgentOperationalAddressVerifyRequest: {
    type: 'object',
    properties: {
      address: { type: 'string', minLength: 1 },
    },
    required: ['address'],
    additionalProperties: false,
  },
  AgentOperationalAddressVerification: {
    type: 'object',
    properties: {
      walletId: { type: 'string' },
      address: { type: 'string' },
      verified: { type: 'boolean' },
      derivationPath: { type: 'string', nullable: true },
      index: { type: 'integer', nullable: true },
    },
    required: ['walletId', 'address', 'verified', 'derivationPath', 'index'],
  },
  AgentFundingDraftRequest: {
    type: 'object',
    properties: {
      operationalWalletId: { type: 'string' },
      recipient: { type: 'string', minLength: 1 },
      amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      feeRate: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      selectedUtxoIds: { type: 'array', items: { type: 'string' } },
      enableRBF: { type: 'boolean' },
      subtractFees: { type: 'boolean' },
      sendMax: { type: 'boolean' },
      decoyOutputs: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          count: { type: 'integer', minimum: 2, maximum: 4 },
        },
        required: ['enabled', 'count'],
        additionalProperties: false,
      },
      label: { type: 'string', nullable: true },
      memo: { type: 'string', nullable: true },
    },
    required: ['operationalWalletId', 'recipient', 'amount', 'feeRate'],
    additionalProperties: false,
  },
  AgentFundingDraftSignatureRequest: {
    type: 'object',
    properties: {
      signedPsbtBase64: { type: 'string', minLength: 1 },
    },
    required: ['signedPsbtBase64'],
    additionalProperties: false,
  },
} as const;
