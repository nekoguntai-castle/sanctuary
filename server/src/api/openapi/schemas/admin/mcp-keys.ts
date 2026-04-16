export const adminMcpKeySchemas = {
  AdminMcpApiKeyUser: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
      isAdmin: { type: 'boolean' },
    },
    required: ['id', 'username', 'isAdmin'],
  },
  AdminMcpApiKeyScope: {
    type: 'object',
    properties: {
      walletIds: { type: 'array', items: { type: 'string' } },
      allowAuditLogs: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  AdminMcpApiKey: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      createdByUserId: { type: 'string', nullable: true },
      name: { type: 'string' },
      keyPrefix: { type: 'string' },
      scope: { $ref: '#/components/schemas/AdminMcpApiKeyScope' },
      lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
      lastUsedIp: { type: 'string', nullable: true },
      lastUsedAgent: { type: 'string', nullable: true },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      revokedAt: { type: 'string', format: 'date-time', nullable: true },
      user: { $ref: '#/components/schemas/AdminMcpApiKeyUser' },
    },
    required: ['id', 'userId', 'name', 'keyPrefix', 'scope', 'createdAt'],
  },
  AdminCreateMcpApiKeyRequest: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      name: { type: 'string', minLength: 1, maxLength: 100 },
      walletIds: { type: 'array', items: { type: 'string' }, maxItems: 100 },
      allowAuditLogs: { type: 'boolean', default: false },
      expiresAt: { type: 'string', format: 'date-time' },
    },
    required: ['userId', 'name'],
    additionalProperties: false,
  },
  AdminCreateMcpApiKeyResponse: {
    allOf: [
      { $ref: '#/components/schemas/AdminMcpApiKey' },
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
