/**
 * Configuration Type Definitions
 *
 * Centralized types for all application configuration.
 */

export type NetworkType = 'mainnet' | 'testnet' | 'signet' | 'regtest';
export type ElectrumProtocol = 'tcp' | 'ssl';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  apiUrl: string;
  clientUrl: string;
}

export interface DatabaseConfig {
  url: string;
}

export interface RedisConfig {
  url: string;
  enabled: boolean;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshExpiresIn: string;
}

export interface SecurityConfig {
  jwt: JwtConfig;
  gatewaySecret: string;
  corsAllowedOrigins: string[];
  encryptionKey: string;
  encryptionSalt: string;
}

export interface RateLimitConfig {
  // Authentication policies
  loginAttempts: number;
  loginWindowSeconds: number;
  registerAttempts: number;
  registerWindowSeconds: number;
  twoFaAttempts: number;
  twoFaWindowSeconds: number;
  passwordChangeAttempts: number;
  passwordChangeWindowSeconds: number;
  emailVerifyAttempts: number;
  emailVerifyWindowSeconds: number;
  emailResendAttempts: number;
  emailResendWindowSeconds: number;
  emailUpdateAttempts: number;
  emailUpdateWindowSeconds: number;

  // API policies
  apiDefaultLimit: number;
  apiHeavyLimit: number;
  apiPublicLimit: number;

  // Sync policies
  syncTriggerLimit: number;
  syncBatchLimit: number;

  // Transaction policies
  txCreateLimit: number;
  txBroadcastLimit: number;

  // AI policies
  aiAnalyzeLimit: number;
  aiSummarizeLimit: number;
  aiWindowSeconds: number;

  // Admin policies
  adminDefaultLimit: number;

  // PayJoin policies
  payjoinCreateLimit: number;

  // WebSocket policies
  wsConnectLimit: number;
  wsMessageLimit: number;
}

export interface BitcoinRpcConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface ElectrumConfig {
  host: string;
  port: number;
  protocol: ElectrumProtocol;
}

export interface BitcoinConfig {
  network: NetworkType;
  rpc: BitcoinRpcConfig;
  electrum: ElectrumConfig;
}

export interface PriceApisConfig {
  mempool: string;
  coingecko: string;
  kraken: string;
}

export interface AiConfig {
  containerUrl: string;
  configSecret: string;
}

export interface MaintenanceConfig {
  auditLogRetentionDays: number;
  priceDataRetentionDays: number;
  feeEstimateRetentionDays: number;
  diskWarningThresholdPercent: number;
  // Intervals in milliseconds
  dailyCleanupIntervalMs: number;
  hourlyCleanupIntervalMs: number;
  initialDelayMs: number;
  weeklyMaintenanceIntervalMs: number;
  monthlyMaintenanceIntervalMs: number;
}

/**
 * Sync service configuration
 */
export interface SyncConfig {
  intervalMs: number;                    // Full sync check interval (default: 5 minutes)
  confirmationUpdateIntervalMs: number;  // Confirmation update interval (default: 2 minutes)
  staleThresholdMs: number;              // Consider wallet stale after this time (default: 10 minutes)
  staleBatchSize: number;               // Max stale wallets to queue per worker pass (default: 50)
  maxConcurrentSyncs: number;            // Max wallets syncing at once (default: 5)
  syncStaggerDelayMs: number;            // Delay between stale wallet sync jobs (default: 2s)
  startupCatchUpBatchSize: number;      // Startup stale-wallet catch-up batch size (default: 250)
  startupCatchUpDelayMs: number;        // Delay before startup catch-up begins (default: 10s)
  startupCatchUpStaggerDelayMs: number; // Delay between startup catch-up sync jobs (default: 250ms)
  maxRetryAttempts: number;              // Max retries on failure (default: 3)
  retryDelaysMs: number[];               // Exponential backoff delays
  maxSyncDurationMs: number;             // Max time for a single wallet sync (default: 30 minutes)
  transactionBatchSize: number;          // Batch size for transaction updates (default: 100)
  electrumSubscriptionsEnabled: boolean; // Enable server-side Electrum subscriptions
  workerHealthPollIntervalMs: number;   // How often to check worker health for polling mode (default: 30s)
}

/**
 * Electrum client configuration
 */
export interface ElectrumClientConfig {
  requestTimeoutMs: number;       // Per-request timeout (default: 30s)
  batchRequestTimeoutMs: number;  // Batch request timeout (default: 60s)
  connectionTimeoutMs: number;    // Connection/handshake timeout (default: 10s)
  torTimeoutMultiplier: number;   // Timeout multiplier for Tor connections (default: 3)
}

export interface WebSocketConfig {
  maxConnections: number;
  maxPerUser: number;
}

export interface PushNotificationConfig {
  fcm: {
    serviceAccountPath: string;
  };
  apns: {
    keyId: string;
    teamId: string;
    keyPath: string;
    bundleId: string;
    isProduction: boolean;
  };
}

export interface PayjoinConfig {
  publicUrl: string;
}

export interface McpConfig {
  enabled: boolean;
  host: string;
  port: number;
  allowedHosts: string[];
  rateLimitPerMinute: number;
  defaultPageSize: number;
  maxPageSize: number;
  maxDateRangeDays: number;
}

export interface DockerConfig {
  proxyUrl: string;
}

/**
 * Background worker configuration
 */
export interface WorkerConfig {
  /** Health check endpoint port (default: 3002) */
  healthPort: number;
  /** Worker health endpoint URL (default: http://worker:3002/health in production) */
  healthUrl: string;
  /** Worker health request timeout in milliseconds */
  healthTimeoutMs: number;
  /** Worker health monitor interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Job processing concurrency (default: 5) */
  concurrency: number;
}

export interface LoggingConfig {
  level: LogLevel;
}

/**
 * Monitoring stack configuration (Grafana, Prometheus, Jaeger)
 */
export interface MonitoringConfig {
  grafanaPort: number;
  prometheusPort: number;
  jaegerPort: number;
  tracingEnabled: boolean;
}

/**
 * Experimental features that may change or be removed
 */
export interface ExperimentalFeatures {
  taprootAddresses: boolean;
  silentPayments: boolean;
  coinJoin: boolean;
}

/**
 * Feature flags for runtime feature toggling
 *
 * Categories:
 * - Core: Essential wallet functionality
 * - Integration: External service integrations
 * - Experimental: Unstable features for testing
 */
export interface FeatureFlags {
  // Core wallet features
  hardwareWalletSigning: boolean;
  qrCodeSigning: boolean;
  multisigWallets: boolean;
  batchSync: boolean;

  // Transaction features
  payjoinSupport: boolean;
  batchTransactions: boolean;
  rbfTransactions: boolean;

  // Integration features
  priceAlerts: boolean;
  aiAssistant: boolean;
  telegramNotifications: boolean;
  treasuryAutopilot: boolean;
  treasuryIntelligence: boolean;

  // Protocol features
  websocketV2Events: boolean;

  // Experimental (nested for clarity)
  experimental: ExperimentalFeatures;
}

/**
 * Feature flag key type for middleware
 */
export type FeatureFlagKey = keyof Omit<FeatureFlags, 'experimental'> | `experimental.${keyof ExperimentalFeatures}`;

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  security: SecurityConfig;
  rateLimit: RateLimitConfig;
  bitcoin: BitcoinConfig;
  priceApis: PriceApisConfig;
  ai: AiConfig;
  maintenance: MaintenanceConfig;
  sync: SyncConfig;
  electrumClient: ElectrumClientConfig;
  websocket: WebSocketConfig;
  push: PushNotificationConfig;
  payjoin: PayjoinConfig;
  mcp: McpConfig;
  docker: DockerConfig;
  worker: WorkerConfig;
  logging: LoggingConfig;
  monitoring: MonitoringConfig;
  features: FeatureFlags;
}

/**
 * Legacy flat config interface for backward compatibility
 * @deprecated Use AppConfig with nested structure for new code
 */
export interface LegacyConfig {
  // Server (flat)
  nodeEnv: string;
  port: number;
  apiUrl: string;
  clientUrl: string;

  // Database
  databaseUrl: string;

  // JWT (flat)
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshExpiresIn: string;

  // Gateway
  gatewaySecret: string;

  // CORS
  corsAllowedOrigins: string[];

  // Bitcoin (nested - unchanged)
  bitcoin: BitcoinConfig;

  // Price APIs (nested - unchanged)
  priceApis: PriceApisConfig;
}

/**
 * Combined config that includes both new nested and legacy flat properties
 */
export type CombinedConfig = AppConfig & LegacyConfig;
