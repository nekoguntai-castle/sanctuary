/**
 * Admin OpenAPI Schemas
 *
 * Schema definitions for administrative endpoints.
 */

import {
  DEFAULT_AI_ENABLED,
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
  DEFAULT_DRAFT_EXPIRATION_DAYS,
  DEFAULT_DUST_THRESHOLD,
  DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS,
  DEFAULT_EMAIL_VERIFICATION_REQUIRED,
  DEFAULT_SMTP_FROM_NAME,
  DEFAULT_SMTP_PORT,
} from '../../../../constants';
import {
  AI_PROVIDER_TYPES,
  DEFAULT_AI_PROVIDER_CAPABILITIES,
  DEFAULT_AI_PROVIDER_PROFILE_ID,
} from '../../../../services/ai/providerProfile';
import { FEATURE_FLAG_KEYS } from '../../../../services/featureFlags/definitions';
import { ADMIN_GROUP_ROLE_VALUES } from '../../../admin/groupRoles';

const aiProviderCapabilitiesSchema = {
  type: 'object',
  properties: {
    chat: { type: 'boolean', default: DEFAULT_AI_PROVIDER_CAPABILITIES.chat },
    toolCalls: {
      type: 'boolean',
      default: DEFAULT_AI_PROVIDER_CAPABILITIES.toolCalls,
    },
    strictJson: {
      type: 'boolean',
      default: DEFAULT_AI_PROVIDER_CAPABILITIES.strictJson,
    },
  },
  required: ['chat', 'toolCalls', 'strictJson'],
  additionalProperties: false,
} as const;

const aiProviderProfileSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    providerType: { type: 'string', enum: [...AI_PROVIDER_TYPES] },
    endpoint: { type: 'string' },
    model: { type: 'string' },
    capabilities: aiProviderCapabilitiesSchema,
  },
  required: ['id', 'name', 'providerType', 'endpoint', 'model', 'capabilities'],
  additionalProperties: false,
} as const;

export const baseSettingsProperties = {
  registrationEnabled: { type: 'boolean', default: false },
  confirmationThreshold: { type: 'integer', default: DEFAULT_CONFIRMATION_THRESHOLD },
  deepConfirmationThreshold: { type: 'integer', default: DEFAULT_DEEP_CONFIRMATION_THRESHOLD },
  dustThreshold: { type: 'integer', default: DEFAULT_DUST_THRESHOLD },
  draftExpirationDays: { type: 'integer', default: DEFAULT_DRAFT_EXPIRATION_DAYS },
  aiEnabled: { type: 'boolean', default: DEFAULT_AI_ENABLED },
  aiEndpoint: { type: 'string', default: DEFAULT_AI_ENDPOINT },
  aiModel: { type: 'string', default: DEFAULT_AI_MODEL },
  aiProviderProfiles: {
    type: 'array',
    items: aiProviderProfileSchema,
    default: [],
  },
  aiActiveProviderProfileId: {
    type: 'string',
    default: DEFAULT_AI_PROVIDER_PROFILE_ID,
  },
  aiActiveProviderProfile: aiProviderProfileSchema,
  'email.verificationRequired': { type: 'boolean', default: DEFAULT_EMAIL_VERIFICATION_REQUIRED },
  'email.tokenExpiryHours': { type: 'integer', default: DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS },
  'smtp.host': { type: 'string', default: '' },
  'smtp.port': { type: 'integer', default: DEFAULT_SMTP_PORT },
  'smtp.secure': { type: 'boolean', default: false },
  'smtp.user': { type: 'string', default: '' },
  'smtp.fromAddress': { type: 'string', default: '' },
  'smtp.fromName': { type: 'string', default: DEFAULT_SMTP_FROM_NAME },
  'smtp.configured': { type: 'boolean', default: false },
} as const;

export const adminSettingsUpdateProperties = Object.fromEntries(
  Object.entries(baseSettingsProperties).filter(([key]) => key !== 'aiActiveProviderProfile'),
) as Omit<typeof baseSettingsProperties, 'aiActiveProviderProfile'>;

export const NODE_CONFIG_TYPE_VALUES = ['electrum'] as const;
export const NODE_CONNECTION_MODE_VALUES = ['singleton', 'pool'] as const;
export const NODE_LOAD_BALANCING_VALUES = ['round_robin', 'least_connections', 'failover_only'] as const;
export const NODE_MEMPOOL_ESTIMATOR_VALUES = ['simple', 'mempool_space'] as const;
export const ELECTRUM_NETWORK_VALUES = ['mainnet', 'testnet', 'signet', 'regtest'] as const;
export const DEAD_LETTER_CATEGORY_VALUES = ['sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other'] as const;
export const MONITORING_SERVICE_VALUES = ['grafana', 'prometheus', 'jaeger'] as const;

export const nodeConfigPortInputSchema = {
  oneOf: [
    { type: 'string', pattern: '^\\d+$' },
    { type: 'integer', minimum: 1, maximum: 65535 },
  ],
} as const;

export const nodeConfigCountInputSchema = {
  oneOf: [
    { type: 'string', pattern: '^\\d+$' },
    { type: 'integer', minimum: 0 },
  ],
} as const;

export const nodeConfigNullablePortInputSchema = { ...nodeConfigPortInputSchema, nullable: true } as const;
export const nodeConfigNullableCountInputSchema = { ...nodeConfigCountInputSchema, nullable: true } as const;
export const nodeConnectionModeSchema = { type: 'string', enum: [...NODE_CONNECTION_MODE_VALUES] } as const;
export const nodeLoadBalancingSchema = { type: 'string', enum: [...NODE_LOAD_BALANCING_VALUES] } as const;
export const nodeMempoolEstimatorSchema = { type: 'string', enum: [...NODE_MEMPOOL_ESTIMATOR_VALUES] } as const;

export const electrumServerMutableProperties = {
  label: { type: 'string', minLength: 1 },
  host: { type: 'string', minLength: 1 },
  port: nodeConfigPortInputSchema,
  useSsl: { type: 'boolean', default: true },
  priority: { type: 'integer', minimum: 0 },
  enabled: { type: 'boolean', default: true },
  network: { type: 'string', enum: [...ELECTRUM_NETWORK_VALUES], default: 'mainnet' },
} as const;

export const adminSuccessResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
} as const;

export const nodeConfigResponseProperties = {
  type: { type: 'string', enum: [...NODE_CONFIG_TYPE_VALUES] },
  host: { type: 'string' },
  port: { type: 'string' },
  useSsl: { type: 'boolean' },
  allowSelfSignedCert: { type: 'boolean' },
  user: { type: 'string', nullable: true },
  hasPassword: { type: 'boolean' },
  explorerUrl: { type: 'string', nullable: true },
  feeEstimatorUrl: { type: 'string', nullable: true },
  mempoolEstimator: nodeMempoolEstimatorSchema,
  poolEnabled: { type: 'boolean' },
  poolMinConnections: { type: 'integer', minimum: 0 },
  poolMaxConnections: { type: 'integer', minimum: 0 },
  poolLoadBalancing: nodeLoadBalancingSchema,
  mainnetMode: nodeConnectionModeSchema,
  mainnetSingletonHost: { type: 'string', nullable: true },
  mainnetSingletonPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  mainnetSingletonSsl: { type: 'boolean', nullable: true },
  mainnetPoolMin: { type: 'integer', nullable: true, minimum: 0 },
  mainnetPoolMax: { type: 'integer', nullable: true, minimum: 0 },
  mainnetPoolLoadBalancing: nodeLoadBalancingSchema,
  testnetEnabled: { type: 'boolean' },
  testnetMode: nodeConnectionModeSchema,
  testnetSingletonHost: { type: 'string', nullable: true },
  testnetSingletonPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  testnetSingletonSsl: { type: 'boolean', nullable: true },
  testnetPoolMin: { type: 'integer', nullable: true, minimum: 0 },
  testnetPoolMax: { type: 'integer', nullable: true, minimum: 0 },
  testnetPoolLoadBalancing: nodeLoadBalancingSchema,
  signetEnabled: { type: 'boolean' },
  signetMode: nodeConnectionModeSchema,
  signetSingletonHost: { type: 'string', nullable: true },
  signetSingletonPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  signetSingletonSsl: { type: 'boolean', nullable: true },
  signetPoolMin: { type: 'integer', nullable: true, minimum: 0 },
  signetPoolMax: { type: 'integer', nullable: true, minimum: 0 },
  signetPoolLoadBalancing: nodeLoadBalancingSchema,
  proxyEnabled: { type: 'boolean' },
  proxyHost: { type: 'string', nullable: true },
  proxyPort: { type: 'integer', nullable: true, minimum: 1, maximum: 65535 },
  proxyUsername: { type: 'string', nullable: true },
  proxyPassword: {
    type: 'string',
    nullable: true,
    description: 'Masked as ******** when a proxy password is configured.',
  },
  servers: {
    type: 'array',
    items: { $ref: '#/components/schemas/AdminElectrumServer' },
  },
} as const;

export const nodeConfigUpdateRequestProperties = {
  ...nodeConfigResponseProperties,
  port: nodeConfigPortInputSchema,
  user: { type: 'string', nullable: true },
  password: { type: 'string', format: 'password' },
  proxyPort: nodeConfigNullablePortInputSchema,
  proxyPassword: { type: 'string', format: 'password' },
  mainnetSingletonPort: nodeConfigNullablePortInputSchema,
  mainnetPoolMin: nodeConfigNullableCountInputSchema,
  mainnetPoolMax: nodeConfigNullableCountInputSchema,
  testnetSingletonPort: nodeConfigNullablePortInputSchema,
  testnetPoolMin: nodeConfigNullableCountInputSchema,
  testnetPoolMax: nodeConfigNullableCountInputSchema,
  signetSingletonPort: nodeConfigNullablePortInputSchema,
  signetPoolMin: nodeConfigNullableCountInputSchema,
  signetPoolMax: nodeConfigNullableCountInputSchema,
} as const;

export { FEATURE_FLAG_KEYS, ADMIN_GROUP_ROLE_VALUES };
