/**
 * Configuration Validation Schema
 *
 * Zod schemas for runtime validation of application configuration.
 * Provides detailed error messages when configuration is invalid.
 */

import { z } from 'zod';

// =============================================================================
// Basic Type Schemas
// =============================================================================

export const NetworkTypeSchema = z.enum(['mainnet', 'testnet', 'signet', 'regtest']);
export const ElectrumProtocolSchema = z.enum(['tcp', 'ssl']);
export const LogLevelSchema = z.enum(['error', 'warn', 'info', 'debug', 'trace']);
export const NodeEnvSchema = z.enum(['development', 'production', 'test']);

// =============================================================================
// Component Schemas
// =============================================================================

export const ServerConfigSchema = z.object({
  nodeEnv: NodeEnvSchema,
  port: z.number().int().min(1).max(65535),
  apiUrl: z.string().url().or(z.literal('')),
  clientUrl: z.string().url().or(z.literal('')),
});

export const DatabaseConfigSchema = z.object({
  url: z.string(),
});

export const RedisConfigSchema = z.object({
  url: z.string(),
  enabled: z.boolean(),
});

export const JwtConfigSchema = z.object({
  secret: z.string().min(1, 'JWT_SECRET is required'),
  expiresIn: z.string().min(1),
  refreshExpiresIn: z.string().min(1),
});

export const SecurityConfigSchema = z.object({
  jwt: JwtConfigSchema,
  gatewaySecret: z.string(),
  corsAllowedOrigins: z.array(z.string()),
  encryptionKey: z.string(),
  encryptionSalt: z.string(),
});

export const RateLimitConfigSchema = z.object({
  loginAttempts: z.number().int().min(1).max(100),
  loginWindowSeconds: z.number().int().min(1),
  registerAttempts: z.number().int().min(1).max(100),
  registerWindowSeconds: z.number().int().min(1),
  twoFaAttempts: z.number().int().min(1).max(100),
  twoFaWindowSeconds: z.number().int().min(1),
  passwordChangeAttempts: z.number().int().min(1).max(100),
  passwordChangeWindowSeconds: z.number().int().min(1),
  emailVerifyAttempts: z.number().int().min(1).max(100),
  emailVerifyWindowSeconds: z.number().int().min(1),
  emailResendAttempts: z.number().int().min(1).max(100),
  emailResendWindowSeconds: z.number().int().min(1),
  emailUpdateAttempts: z.number().int().min(1).max(100),
  emailUpdateWindowSeconds: z.number().int().min(1),
  apiDefaultLimit: z.number().int().min(1),
  apiHeavyLimit: z.number().int().min(1),
  apiPublicLimit: z.number().int().min(1),
  syncTriggerLimit: z.number().int().min(1),
  syncBatchLimit: z.number().int().min(1),
  txCreateLimit: z.number().int().min(1),
  txBroadcastLimit: z.number().int().min(1),
  aiAnalyzeLimit: z.number().int().min(1),
  aiSummarizeLimit: z.number().int().min(1),
  aiWindowSeconds: z.number().int().min(1),
  adminDefaultLimit: z.number().int().min(1),
  payjoinCreateLimit: z.number().int().min(1),
  wsConnectLimit: z.number().int().min(1),
  wsMessageLimit: z.number().int().min(1),
});

export const BitcoinRpcConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string(),
  password: z.string(),
});

export const ElectrumConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  protocol: ElectrumProtocolSchema,
});

export const BitcoinConfigSchema = z.object({
  network: NetworkTypeSchema,
  rpc: BitcoinRpcConfigSchema,
  electrum: ElectrumConfigSchema,
});

export const PriceApisConfigSchema = z.object({
  mempool: z.string().url(),
  coingecko: z.string().url(),
  kraken: z.string().url(),
});

export const AiConfigSchema = z.object({
  containerUrl: z.string(),
  configSecret: z.string(),
});

export const MaintenanceConfigSchema = z.object({
  auditLogRetentionDays: z.number().int().min(1).max(3650),
  priceDataRetentionDays: z.number().int().min(1).max(365),
  feeEstimateRetentionDays: z.number().int().min(1).max(365),
  diskWarningThresholdPercent: z.number().int().min(1).max(99),
  dailyCleanupIntervalMs: z.number().int().min(1000),
  hourlyCleanupIntervalMs: z.number().int().min(1000),
  initialDelayMs: z.number().int().min(0),
  weeklyMaintenanceIntervalMs: z.number().int().min(1000),
  monthlyMaintenanceIntervalMs: z.number().int().min(1000),
});

export const SyncConfigSchema = z.object({
  intervalMs: z.number().int().min(1000),
  confirmationUpdateIntervalMs: z.number().int().min(1000),
  staleThresholdMs: z.number().int().min(1000),
  staleBatchSize: z.number().int().min(1).max(5000),
  maxConcurrentSyncs: z.number().int().min(1).max(50),
  syncStaggerDelayMs: z.number().int().min(0).max(30000),
  startupCatchUpBatchSize: z.number().int().min(1).max(10000),
  startupCatchUpDelayMs: z.number().int().min(0).max(300000),
  startupCatchUpStaggerDelayMs: z.number().int().min(0).max(30000),
  maxRetryAttempts: z.number().int().min(0).max(10),
  retryDelaysMs: z.array(z.number().int().min(0)),
  maxSyncDurationMs: z.number().int().min(1000),
  transactionBatchSize: z.number().int().min(1).max(10000),
  electrumSubscriptionsEnabled: z.boolean(),
  workerHealthPollIntervalMs: z.number().int().min(1000).max(300000),
});

export const ElectrumClientConfigSchema = z.object({
  requestTimeoutMs: z.number().int().min(1000).max(300000),
  batchRequestTimeoutMs: z.number().int().min(1000).max(600000),
  connectionTimeoutMs: z.number().int().min(1000).max(120000),
  torTimeoutMultiplier: z.number().int().min(1).max(10),
});

export const WebSocketConfigSchema = z.object({
  maxConnections: z.number().int().min(1).max(100000),
  maxPerUser: z.number().int().min(1).max(100),
});

export const FcmConfigSchema = z.object({
  serviceAccountPath: z.string(),
});

export const ApnsConfigSchema = z.object({
  keyId: z.string(),
  teamId: z.string(),
  keyPath: z.string(),
  bundleId: z.string(),
  isProduction: z.boolean(),
});

export const PushNotificationConfigSchema = z.object({
  fcm: FcmConfigSchema,
  apns: ApnsConfigSchema,
});

export const PayjoinConfigSchema = z.object({
  publicUrl: z.string(),
});

export const DockerConfigSchema = z.object({
  proxyUrl: z.string(),
});

export const WorkerConfigSchema = z.object({
  healthPort: z.number().int().min(1).max(65535),
  healthUrl: z.string().min(1),
  healthTimeoutMs: z.number().int().min(100).max(60000),
  healthCheckIntervalMs: z.number().int().min(1000).max(300000),
  concurrency: z.number().int().min(1).max(50),
});

export const LoggingConfigSchema = z.object({
  level: LogLevelSchema,
});

export const ExperimentalFeaturesSchema = z.object({
  taprootAddresses: z.boolean(),
  silentPayments: z.boolean(),
  coinJoin: z.boolean(),
});

export const FeatureFlagsSchema = z.object({
  hardwareWalletSigning: z.boolean(),
  qrCodeSigning: z.boolean(),
  multisigWallets: z.boolean(),
  batchSync: z.boolean(),
  payjoinSupport: z.boolean(),
  batchTransactions: z.boolean(),
  rbfTransactions: z.boolean(),
  priceAlerts: z.boolean(),
  aiAssistant: z.boolean(),
  telegramNotifications: z.boolean(),
  treasuryAutopilot: z.boolean(),
  treasuryIntelligence: z.boolean(),
  websocketV2Events: z.boolean(),
  experimental: ExperimentalFeaturesSchema,
});

export const MonitoringConfigSchema = z.object({
  grafanaPort: z.number().int().min(1).max(65535),
  prometheusPort: z.number().int().min(1).max(65535),
  jaegerPort: z.number().int().min(1).max(65535),
  tracingEnabled: z.boolean(),
});

// =============================================================================
// Main Config Schema
// =============================================================================

export const AppConfigSchema = z.object({
  server: ServerConfigSchema,
  database: DatabaseConfigSchema,
  redis: RedisConfigSchema,
  security: SecurityConfigSchema,
  rateLimit: RateLimitConfigSchema,
  bitcoin: BitcoinConfigSchema,
  priceApis: PriceApisConfigSchema,
  ai: AiConfigSchema,
  maintenance: MaintenanceConfigSchema,
  sync: SyncConfigSchema,
  electrumClient: ElectrumClientConfigSchema,
  websocket: WebSocketConfigSchema,
  push: PushNotificationConfigSchema,
  payjoin: PayjoinConfigSchema,
  docker: DockerConfigSchema,
  worker: WorkerConfigSchema,
  logging: LoggingConfigSchema,
  monitoring: MonitoringConfigSchema,
  features: FeatureFlagsSchema,
});

// Legacy flat properties schema
export const LegacyConfigSchema = z.object({
  nodeEnv: z.string(),
  port: z.number(),
  apiUrl: z.string(),
  clientUrl: z.string(),
  databaseUrl: z.string(),
  jwtSecret: z.string(),
  jwtExpiresIn: z.string(),
  jwtRefreshExpiresIn: z.string(),
  gatewaySecret: z.string(),
  corsAllowedOrigins: z.array(z.string()),
  bitcoin: BitcoinConfigSchema,
  priceApis: PriceApisConfigSchema,
});

// Combined config schema
export const CombinedConfigSchema = AppConfigSchema.merge(LegacyConfigSchema);

// =============================================================================
// Validation Functions
// =============================================================================

export type ConfigValidationResult = {
  success: boolean;
  errors: string[];
};

/**
 * Validate configuration and return detailed errors
 */
export function validateConfigSchema(config: unknown): ConfigValidationResult {
  const result = CombinedConfigSchema.safeParse(config);

  if (result.success) {
    return { success: true, errors: [] };
  }

  // Format Zod errors into readable messages
  const errors = result.error.issues.map((issue: z.ZodIssue) => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });

  return { success: false, errors };
}

/**
 * Validate configuration and throw if invalid
 */
export function assertValidConfig(config: unknown): asserts config is z.infer<typeof CombinedConfigSchema> {
  const result = validateConfigSchema(config);

  if (!result.success) {
    console.error('');
    console.error('================================================================================');
    console.error('CONFIGURATION VALIDATION FAILED');
    console.error('================================================================================');
    console.error('');
    console.error('The following configuration errors were found:');
    console.error('');
    for (const error of result.errors) {
      console.error(`  • ${error}`);
    }
    console.error('');
    console.error('Please check your .env file and environment variables.');
    console.error('================================================================================');
    console.error('');

    throw new Error(`Configuration validation failed: ${result.errors.join('; ')}`);
  }
}

// Type inference from schema
export type ValidatedConfig = z.infer<typeof CombinedConfigSchema>;
