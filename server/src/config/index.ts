/**
 * Server Configuration
 *
 * Centralized configuration management for all environment variables
 * and application settings. This is the single source of truth for
 * all configuration values.
 *
 * Usage:
 *   import { getConfig } from './config';
 *   const config = getConfig();
 *   console.log(config.server.port);
 */

import dotenv from 'dotenv';
import path from 'path';
import type { CombinedConfig, LogLevel, NetworkType, ElectrumProtocol } from './types';
import { loadFeatureFlags } from './features';
import { assertValidConfig } from './schema';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Singleton config instance
let configInstance: CombinedConfig | null = null;

/**
 * Get the application configuration
 * Loads and validates config on first call, returns cached instance after
 *
 * Returns combined config with both nested structure (new) and flat properties (legacy)
 */
export function getConfig(): CombinedConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Load configuration from environment variables
 * Called once at startup
 */
function loadConfig(): CombinedConfig {
  // Build nested config structure
  const jwtSecret = getJwtSecret();
  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';
  const jwtRefreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const gatewaySecret = getGatewaySecret();
  const corsAllowedOrigins = getCorsAllowedOrigins();
  const nodeEnv = parseNodeEnv();
  const port = parseInt(process.env.PORT || '3001', 10);
  const apiUrl = process.env.API_URL || 'http://localhost:3001';
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const databaseUrl = process.env.DATABASE_URL || '';
  const workerHealthPort = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
  const defaultWorkerHost = nodeEnv === 'production' ? 'worker' : 'localhost';
  const workerHealthUrl = process.env.WORKER_HEALTH_URL || `http://${defaultWorkerHost}:${workerHealthPort}/health`;
  const workerHealthTimeoutMs = parseInt(process.env.WORKER_HEALTH_TIMEOUT_MS || '3000', 10);
  const workerHealthCheckIntervalMs = parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL_MS || '10000', 10);

  const bitcoin = {
    network: parseBitcoinNetwork(),
    rpc: {
      host: process.env.BITCOIN_RPC_HOST || 'localhost',
      port: parseInt(process.env.BITCOIN_RPC_PORT || '8332', 10),
      user: process.env.BITCOIN_RPC_USER || '',
      password: process.env.BITCOIN_RPC_PASSWORD || '',
    },
    electrum: {
      host: process.env.ELECTRUM_HOST || 'electrum.blockstream.info',
      port: parseInt(process.env.ELECTRUM_PORT || '50002', 10),
      protocol: parseElectrumProtocol(),
    },
  };

  const priceApis = {
    mempool: process.env.MEMPOOL_API || 'https://mempool.space/api/v1',
    coingecko: process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3',
    kraken: process.env.KRAKEN_API || 'https://api.kraken.com/0/public',
  };

  const config: CombinedConfig = {
    // New nested structure
    server: {
      nodeEnv,
      port,
      apiUrl,
      clientUrl,
    },

    database: {
      url: databaseUrl,
    },

    redis: {
      url: process.env.REDIS_URL || '',
      enabled: !!process.env.REDIS_URL,
    },

    security: {
      jwt: {
        secret: jwtSecret,
        expiresIn: jwtExpiresIn,
        refreshExpiresIn: jwtRefreshExpiresIn,
      },
      gatewaySecret,
      corsAllowedOrigins,
      encryptionKey: getEncryptionKey(),
      encryptionSalt: process.env.ENCRYPTION_SALT || '',
    },

    rateLimit: {
      // Authentication policies
      loginAttempts: parseInt(process.env.RATE_LIMIT_LOGIN || '5', 10),
      loginWindowSeconds: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW || '900', 10), // 15 minutes
      registerAttempts: parseInt(process.env.RATE_LIMIT_REGISTER || '10', 10),
      registerWindowSeconds: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW || '3600', 10), // 1 hour
      twoFaAttempts: parseInt(process.env.RATE_LIMIT_2FA || '10', 10),
      twoFaWindowSeconds: parseInt(process.env.RATE_LIMIT_2FA_WINDOW || '900', 10), // 15 minutes
      passwordChangeAttempts: parseInt(process.env.RATE_LIMIT_PASSWORD_CHANGE || '5', 10),
      passwordChangeWindowSeconds: parseInt(process.env.RATE_LIMIT_PASSWORD_CHANGE_WINDOW || '900', 10), // 15 minutes
      emailVerifyAttempts: parseInt(process.env.RATE_LIMIT_EMAIL_VERIFY || '10', 10),
      emailVerifyWindowSeconds: parseInt(process.env.RATE_LIMIT_EMAIL_VERIFY_WINDOW || '900', 10), // 15 minutes
      emailResendAttempts: parseInt(process.env.RATE_LIMIT_EMAIL_RESEND || '5', 10),
      emailResendWindowSeconds: parseInt(process.env.RATE_LIMIT_EMAIL_RESEND_WINDOW || '3600', 10), // 1 hour
      emailUpdateAttempts: parseInt(process.env.RATE_LIMIT_EMAIL_UPDATE || '3', 10),
      emailUpdateWindowSeconds: parseInt(process.env.RATE_LIMIT_EMAIL_UPDATE_WINDOW || '3600', 10), // 1 hour

      // API policies (per minute unless specified)
      apiDefaultLimit: parseInt(process.env.RATE_LIMIT_API_DEFAULT || '1000', 10),
      apiHeavyLimit: parseInt(process.env.RATE_LIMIT_API_HEAVY || '100', 10),
      apiPublicLimit: parseInt(process.env.RATE_LIMIT_API_PUBLIC || '60', 10),

      // Sync policies (per minute)
      syncTriggerLimit: parseInt(process.env.RATE_LIMIT_SYNC_TRIGGER || '10', 10),
      syncBatchLimit: parseInt(process.env.RATE_LIMIT_SYNC_BATCH || '5', 10),

      // Transaction policies (per minute)
      txCreateLimit: parseInt(process.env.RATE_LIMIT_TX_CREATE || '30', 10),
      txBroadcastLimit: parseInt(process.env.RATE_LIMIT_TX_BROADCAST || '20', 10),

      // AI policies (per minute)
      aiAnalyzeLimit: parseInt(process.env.RATE_LIMIT_AI_ANALYZE || '20', 10),
      aiSummarizeLimit: parseInt(process.env.RATE_LIMIT_AI_SUMMARIZE || '10', 10),
      aiWindowSeconds: parseInt(process.env.RATE_LIMIT_AI_WINDOW || '60', 10),

      // Admin policies (per minute)
      adminDefaultLimit: parseInt(process.env.RATE_LIMIT_ADMIN_DEFAULT || '500', 10),

      // PayJoin policies (per minute)
      payjoinCreateLimit: parseInt(process.env.RATE_LIMIT_PAYJOIN_CREATE || '10', 10),

      // WebSocket policies (per minute)
      wsConnectLimit: parseInt(process.env.RATE_LIMIT_WS_CONNECT || '10', 10),
      wsMessageLimit: parseInt(process.env.RATE_LIMIT_WS_MESSAGE || '100', 10),
    },

    bitcoin,
    priceApis,

    ai: {
      containerUrl: process.env.AI_CONTAINER_URL || 'http://ai:3100',
      configSecret: process.env.AI_CONFIG_SECRET || '',
    },

    maintenance: {
      auditLogRetentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10),
      priceDataRetentionDays: parseInt(process.env.PRICE_DATA_RETENTION_DAYS || '30', 10),
      feeEstimateRetentionDays: parseInt(process.env.FEE_ESTIMATE_RETENTION_DAYS || '7', 10),
      diskWarningThresholdPercent: parseInt(process.env.DISK_WARNING_THRESHOLD_PERCENT || '80', 10),
      dailyCleanupIntervalMs: parseInt(process.env.MAINTENANCE_DAILY_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10),
      hourlyCleanupIntervalMs: parseInt(process.env.MAINTENANCE_HOURLY_INTERVAL_MS || String(60 * 60 * 1000), 10),
      initialDelayMs: parseInt(process.env.MAINTENANCE_INITIAL_DELAY_MS || String(60 * 1000), 10),
      weeklyMaintenanceIntervalMs: parseInt(process.env.MAINTENANCE_WEEKLY_INTERVAL_MS || String(7 * 24 * 60 * 60 * 1000), 10),
      monthlyMaintenanceIntervalMs: parseInt(process.env.MAINTENANCE_MONTHLY_INTERVAL_MS || String(30 * 24 * 60 * 60 * 1000), 10),
    },

    sync: {
      intervalMs: parseInt(process.env.SYNC_INTERVAL_MS || String(5 * 60 * 1000), 10),
      confirmationUpdateIntervalMs: parseInt(process.env.SYNC_CONFIRMATION_INTERVAL_MS || String(2 * 60 * 1000), 10),
      staleThresholdMs: parseInt(process.env.SYNC_STALE_THRESHOLD_MS || String(10 * 60 * 1000), 10),
      staleBatchSize: parseInt(process.env.SYNC_STALE_BATCH_SIZE || '50', 10),
      maxConcurrentSyncs: parseInt(process.env.SYNC_MAX_CONCURRENT || '5', 10),
      syncStaggerDelayMs: parseInt(process.env.SYNC_STAGGER_DELAY_MS || '2000', 10),
      startupCatchUpBatchSize: parseInt(process.env.SYNC_STARTUP_CATCH_UP_BATCH_SIZE || '250', 10),
      startupCatchUpDelayMs: parseInt(process.env.SYNC_STARTUP_CATCH_UP_DELAY_MS || '10000', 10),
      startupCatchUpStaggerDelayMs: parseInt(process.env.SYNC_STARTUP_CATCH_UP_STAGGER_DELAY_MS || '1000', 10),
      maxRetryAttempts: parseInt(process.env.SYNC_MAX_RETRIES || '3', 10),
      retryDelaysMs: (process.env.SYNC_RETRY_DELAYS_MS || '5000,15000,45000').split(',').map(s => parseInt(s.trim(), 10)),
      maxSyncDurationMs: parseInt(process.env.SYNC_MAX_DURATION_MS || String(30 * 60 * 1000), 10), // 30 minutes default
      transactionBatchSize: parseInt(process.env.SYNC_TRANSACTION_BATCH_SIZE || '100', 10),
      electrumSubscriptionsEnabled: process.env.SYNC_ELECTRUM_SUBSCRIPTIONS_ENABLED !== 'false',
      workerHealthPollIntervalMs: parseInt(process.env.SYNC_WORKER_HEALTH_POLL_MS || '30000', 10),
    },

    electrumClient: {
      requestTimeoutMs: parseInt(process.env.ELECTRUM_REQUEST_TIMEOUT_MS || '30000', 10),
      batchRequestTimeoutMs: parseInt(process.env.ELECTRUM_BATCH_TIMEOUT_MS || '60000', 10),
      connectionTimeoutMs: parseInt(process.env.ELECTRUM_CONNECTION_TIMEOUT_MS || '10000', 10),
      torTimeoutMultiplier: parseInt(process.env.ELECTRUM_TOR_TIMEOUT_MULTIPLIER || '3', 10),
    },

    websocket: {
      maxConnections: parseInt(process.env.MAX_WEBSOCKET_CONNECTIONS || '10000', 10),
      maxPerUser: parseInt(process.env.MAX_WEBSOCKET_PER_USER || '10', 10),
    },

    push: {
      fcm: {
        serviceAccountPath: process.env.FCM_SERVICE_ACCOUNT || '',
      },
      apns: {
        keyId: process.env.APNS_KEY_ID || '',
        teamId: process.env.APNS_TEAM_ID || '',
        keyPath: process.env.APNS_KEY_PATH || '',
        bundleId: process.env.APNS_BUNDLE_ID || '',
        isProduction: process.env.APNS_PRODUCTION === 'true',
      },
    },

    payjoin: {
      publicUrl: process.env.PAYJOIN_PUBLIC_URL || '',
    },

    mcp: {
      enabled: process.env.MCP_ENABLED === 'true',
      host: process.env.MCP_HOST || '127.0.0.1',
      port: parseInt(process.env.MCP_PORT || '3003', 10),
      allowedHosts: (process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1]')
        .split(',')
        .map(host => host.trim())
        .filter(host => host.length > 0),
      rateLimitPerMinute: parseInt(process.env.MCP_RATE_LIMIT_PER_MINUTE || process.env.MCP_RATE_LIMIT || '120', 10),
      defaultPageSize: parseInt(process.env.MCP_DEFAULT_PAGE_SIZE || '100', 10),
      maxPageSize: parseInt(process.env.MCP_MAX_PAGE_SIZE || '500', 10),
      maxDateRangeDays: parseInt(process.env.MCP_MAX_DATE_RANGE_DAYS || '365', 10),
    },

    docker: {
      proxyUrl: process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375',
    },

    worker: {
      healthPort: workerHealthPort,
      healthUrl: workerHealthUrl,
      healthTimeoutMs: workerHealthTimeoutMs,
      healthCheckIntervalMs: workerHealthCheckIntervalMs,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
    },

    logging: {
      level: parseLogLevel(),
    },

    monitoring: {
      grafanaPort: parseInt(process.env.GRAFANA_PORT || '3000', 10),
      prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9090', 10),
      jaegerPort: parseInt(process.env.JAEGER_UI_PORT || '16686', 10),
      tracingEnabled: process.env.OTEL_TRACING_ENABLED === 'true',
    },

    features: loadFeatureFlags(),

    // Legacy flat properties for backward compatibility
    nodeEnv,
    port,
    apiUrl,
    clientUrl,
    databaseUrl,
    jwtSecret,
    jwtExpiresIn,
    jwtRefreshExpiresIn,
    gatewaySecret,
    corsAllowedOrigins,
  };

  // Validate configuration
  validateConfig(config);

  return config;
}

/**
 * Validate configuration using Zod schema
 * Provides detailed error messages for invalid configuration
 */
const validateConfig = (config: CombinedConfig): void => {
  // Run Zod schema validation
  assertValidConfig(config);

  validateProductionConfig(config);
  validateWorkerConfig(config);
};

const validateProductionConfig = (config: CombinedConfig): void => {
  if (config.server.nodeEnv === 'production') {
    requireDatabaseUrl(config);
    requireEncryptionSalt(config);
    requireGatewaySecret(config);
  }
};

const requireDatabaseUrl = (config: CombinedConfig): void => {
  if (!config.database.url) {
    throw new Error('DATABASE_URL is required in production');
  }
};

const requireEncryptionSalt = (config: CombinedConfig): void => {
  // M4: Require encryption salt in production for better security isolation.
  if (!config.security.encryptionSalt) {
    throw new Error(
      'ENCRYPTION_SALT is required in production. ' +
      'Generate one with: openssl rand -base64 16'
    );
  }
};

const requireGatewaySecret = (config: CombinedConfig): void => {
  // M6: Require gateway secret in production for authenticated internal communication.
  if (!config.security.gatewaySecret) {
    throw new Error(
      'GATEWAY_SECRET is required in production. ' +
      'Generate one with: openssl rand -base64 32'
    );
  }
};

const validateWorkerConfig = (config: CombinedConfig): void => {
  if (!config.worker.healthUrl) {
    throw new Error('WORKER_HEALTH_URL is required');
  }
};

// =============================================================================
// Environment Parsing Helpers
// =============================================================================

const parseNodeEnv = (): 'development' | 'production' | 'test' => {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' || env === 'test' || env === 'development') {
    return env;
  }
  return 'development';
};

const parseBitcoinNetwork = (): NetworkType => {
  const network = process.env.BITCOIN_NETWORK || 'mainnet';
  if (network === 'mainnet' || network === 'testnet' || network === 'signet' || network === 'regtest') {
    return network;
  }
  return 'mainnet';
};

const parseElectrumProtocol = (): ElectrumProtocol => {
  const protocol = process.env.ELECTRUM_PROTOCOL || 'ssl';
  if (protocol === 'tcp' || protocol === 'ssl') {
    return protocol;
  }
  return 'ssl';
};

const parseLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level === 'error' || level === 'warn' || level === 'info' || level === 'debug' || level === 'trace') {
    return level;
  }
  return 'info';
};

// =============================================================================
// Security Value Helpers (with validation)
// =============================================================================

/**
 * Get JWT secret with validation
 * Critical for security - never allow default in any environment
 */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('');
    console.error('================================================================================');
    console.error('FATAL SECURITY ERROR: JWT_SECRET environment variable is not set!');
    console.error('');
    console.error('The JWT_SECRET is required for secure authentication. Without it, tokens');
    console.error('could be forged by attackers, compromising all user accounts.');
    console.error('');
    console.error('To fix this:');
    console.error('  1. Generate a secure random secret (at least 32 characters):');
    console.error('     openssl rand -base64 32');
    console.error('');
    console.error('  2. Set it in your .env file or environment:');
    console.error('     JWT_SECRET=your-generated-secret-here');
    console.error('================================================================================');
    console.error('');
    throw new Error('JWT_SECRET environment variable is required but not set. See error above for instructions.');
  }

  if (secret.length < 32) {
    console.warn('');
    console.warn('SECURITY WARNING: JWT_SECRET is shorter than 32 characters.');
    console.warn('A longer secret provides better security. Generate one with:');
    console.warn('  openssl rand -base64 32');
    console.warn('');
  }

  return secret;
};

/**
 * Get gateway secret for internal communication
 */
const getGatewaySecret = (): string => {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret) {
    console.warn('');
    console.warn('SECURITY WARNING: GATEWAY_SECRET is not set.');
    console.warn('Internal gateway communication will not be authenticated.');
    console.warn('Generate one with: openssl rand -base64 32');
    console.warn('');
    return '';
  }
  if (secret.length < 32) {
    console.warn('');
    console.warn('SECURITY WARNING: GATEWAY_SECRET is shorter than 32 characters.');
    console.warn('A longer secret provides better security.');
    console.warn('');
  }
  return secret;
};

/**
 * Get encryption key with validation
 */
const getEncryptionKey = (): string => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    console.warn('');
    console.warn('SECURITY WARNING: ENCRYPTION_KEY is not set.');
    console.warn('Sensitive data encryption will not work properly.');
    console.warn('Generate one with: openssl rand -base64 32');
    console.warn('');
    return '';
  }
  return key;
};

/**
 * Parse CORS allowed origins from environment
 */
const getCorsAllowedOrigins = (): string[] => {
  const origins = process.env.CORS_ALLOWED_ORIGINS;
  if (!origins) {
    return [];
  }
  return origins.split(',').map(o => o.trim()).filter(o => o.length > 0);
};

// =============================================================================
// Legacy Compatibility Export
// =============================================================================

/**
 * Default export for backward compatibility
 * Prefer using getConfig() for new code
 */
const config = getConfig();
export default config;

// Re-export types
export type { AppConfig, CombinedConfig, FeatureFlags, ExperimentalFeatures, FeatureFlagKey, NetworkType, LogLevel } from './types';
export { defaultFeatureFlags } from './features';

// Re-export validation utilities
export { validateConfigSchema, assertValidConfig } from './schema';
