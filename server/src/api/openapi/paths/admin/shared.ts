import { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_STATS_DAYS } from '../../../../constants';
import { FEATURE_FLAG_KEYS } from '../../../../services/featureFlags/definitions';
import { browserOrBearerAuth as bearerAuth } from '../../security';

export { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_STATS_DAYS, bearerAuth, FEATURE_FLAG_KEYS };

export const AUDIT_LOG_LIMIT_MAX = 500;
export const ELECTRUM_NETWORK_VALUES = ['mainnet', 'testnet', 'signet', 'regtest'] as const;
export const DEAD_LETTER_CATEGORY_VALUES = ['sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other'] as const;
export const MONITORING_SERVICE_VALUES = ['grafana', 'prometheus', 'jaeger'] as const;

export const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

export const adminFeatureKeyParameter = {
  name: 'key',
  in: 'path',
  required: true,
  schema: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
} as const;

export const adminUserIdParameter = {
  name: 'userId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminGroupIdParameter = {
  name: 'groupId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminGroupMemberUserIdParameter = {
  name: 'userId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminPolicyIdParameter = {
  name: 'policyId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminElectrumNetworkPathParameter = {
  name: 'networkOrServerId',
  in: 'path',
  required: true,
  description: 'Electrum network name for GET requests.',
  schema: { type: 'string', enum: [...ELECTRUM_NETWORK_VALUES] },
} as const;

export const adminElectrumServerIdOnSharedPathParameter = {
  name: 'networkOrServerId',
  in: 'path',
  required: true,
  description: 'Electrum server ID for update and delete requests.',
  schema: { type: 'string' },
} as const;

export const adminElectrumServerIdParameter = {
  name: 'serverId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminDeadLetterIdParameter = {
  name: 'dlqId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const adminDeadLetterCategoryParameter = {
  name: 'category',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: [...DEAD_LETTER_CATEGORY_VALUES] },
} as const;

export const adminMonitoringServiceIdParameter = {
  name: 'serviceId',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: [...MONITORING_SERVICE_VALUES] },
} as const;

export const jsonRequestBody = (schemaRef: string) => ({
  required: true,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

export const optionalJsonRequestBody = (schemaRef: string) => ({
  required: false,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

export const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

export const jsonArrayResponse = (description: string, itemSchemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'array',
        items: { $ref: itemSchemaRef },
      },
    },
  },
});

export const jsonOneOfResponse = (description: string, schemaRefs: string[]) => ({
  description,
  content: {
    'application/json': {
      schema: {
        oneOf: schemaRefs.map((schemaRef) => ({ $ref: schemaRef })),
      },
    },
  },
});

export const jsonDownloadResponse = (description: string, schemaRef: string) => ({
  description,
  headers: {
    'Content-Disposition': {
      schema: { type: 'string' },
      description: 'Attachment filename for the generated JSON document.',
    },
  },
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

export const featureFlagResponse = jsonResponse('Feature flag', '#/components/schemas/AdminFeatureFlag');
