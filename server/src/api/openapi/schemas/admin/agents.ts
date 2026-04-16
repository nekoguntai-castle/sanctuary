const agentPolicyProperties = {
  maxFundingAmountSats: { type: 'string', nullable: true },
  maxOperationalBalanceSats: { type: 'string', nullable: true },
  dailyFundingLimitSats: { type: 'string', nullable: true },
  weeklyFundingLimitSats: { type: 'string', nullable: true },
  cooldownMinutes: { type: 'integer', nullable: true },
  requireHumanApproval: { type: 'boolean' },
  notifyOnOperationalSpend: { type: 'boolean' },
  pauseOnUnexpectedSpend: { type: 'boolean' },
} as const;

export const adminAgentSchemas = {
  AdminWalletAgentWalletSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      network: { type: 'string' },
    },
    required: ['id', 'name', 'type', 'network'],
  },
  AdminWalletAgentSignerDevice: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      fingerprint: { type: 'string' },
    },
    required: ['id', 'label', 'fingerprint'],
  },
  AdminAgentApiKeyScope: {
    type: 'object',
    properties: {
      allowedActions: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  AdminAgentApiKey: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      agentId: { type: 'string' },
      createdByUserId: { type: 'string', nullable: true },
      name: { type: 'string' },
      keyPrefix: { type: 'string' },
      scope: { $ref: '#/components/schemas/AdminAgentApiKeyScope' },
      lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
      lastUsedIp: { type: 'string', nullable: true },
      lastUsedAgent: { type: 'string', nullable: true },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      revokedAt: { type: 'string', format: 'date-time', nullable: true },
    },
    required: ['id', 'agentId', 'name', 'keyPrefix', 'scope', 'createdAt'],
  },
  AdminWalletAgent: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused', 'revoked'] },
      fundingWalletId: { type: 'string' },
      operationalWalletId: { type: 'string' },
      signerDeviceId: { type: 'string' },
      ...agentPolicyProperties,
      lastFundingDraftAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      revokedAt: { type: 'string', format: 'date-time', nullable: true },
      user: { $ref: '#/components/schemas/AdminMcpApiKeyUser' },
      fundingWallet: { $ref: '#/components/schemas/AdminWalletAgentWalletSummary' },
      operationalWallet: { $ref: '#/components/schemas/AdminWalletAgentWalletSummary' },
      signerDevice: { $ref: '#/components/schemas/AdminWalletAgentSignerDevice' },
      apiKeys: { type: 'array', items: { $ref: '#/components/schemas/AdminAgentApiKey' } },
    },
    required: ['id', 'userId', 'name', 'status', 'fundingWalletId', 'operationalWalletId', 'signerDeviceId', 'createdAt', 'updatedAt'],
  },
  AdminCreateWalletAgentRequest: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      name: { type: 'string', minLength: 1, maxLength: 100 },
      fundingWalletId: { type: 'string' },
      operationalWalletId: { type: 'string' },
      signerDeviceId: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused', 'revoked'], default: 'active' },
      ...agentPolicyProperties,
    },
    required: ['userId', 'name', 'fundingWalletId', 'operationalWalletId', 'signerDeviceId'],
    additionalProperties: false,
  },
  AdminUpdateWalletAgentRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      status: { type: 'string', enum: ['active', 'paused', 'revoked'] },
      ...agentPolicyProperties,
    },
    additionalProperties: false,
  },
  AdminCreateAgentApiKeyRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      allowedActions: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      expiresAt: { type: 'string', format: 'date-time' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  AdminCreateAgentApiKeyResponse: {
    allOf: [
      { $ref: '#/components/schemas/AdminAgentApiKey' },
      {
        type: 'object',
        properties: {
          apiKey: { type: 'string' },
        },
        required: ['apiKey'],
      },
    ],
  },
} as const;
