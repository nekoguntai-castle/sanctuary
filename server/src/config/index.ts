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
import {
  buildElectrumClientConfig,
  buildMaintenanceConfig,
  buildMcpConfig,
  buildMonitoringConfig,
  buildPushConfig,
  buildRateLimitConfig,
  buildSyncConfig,
  buildWebsocketConfig,
  buildWorkerHealthConfig,
  parseIntegerEnv,
  parseStringEnv,
} from './envSections';

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
  const jwtSecret = getJwtSecret();
  const jwtExpiresIn = parseStringEnv('JWT_EXPIRES_IN', '1h');
  const jwtRefreshExpiresIn = parseStringEnv('JWT_REFRESH_EXPIRES_IN', '7d');
  const gatewaySecret = getGatewaySecret();
  const corsAllowedOrigins = getCorsAllowedOrigins();
  const nodeEnv = parseNodeEnv();
  const port = parseIntegerEnv('PORT', 3001);
  const apiUrl = parseStringEnv('API_URL', 'http://localhost:3001');
  const clientUrl = parseStringEnv('CLIENT_URL', 'http://localhost:3000');
  const databaseUrl = parseStringEnv('DATABASE_URL');
  const workerHealthPort = parseIntegerEnv('WORKER_HEALTH_PORT', 3002);
  const workerHealth = buildWorkerHealthConfig(nodeEnv, workerHealthPort);
  const bitcoin = buildBitcoinConfig();

  const config: CombinedConfig = {
    server: { nodeEnv, port, apiUrl, clientUrl },
    database: { url: databaseUrl },
    redis: buildRedisConfig(),
    security: buildSecurityConfig(jwtSecret, jwtExpiresIn, jwtRefreshExpiresIn, gatewaySecret, corsAllowedOrigins),
    rateLimit: buildRateLimitConfig(),
    bitcoin,
    priceApis: buildPriceApisConfig(),
    ai: buildAiConfig(),
    maintenance: buildMaintenanceConfig(),
    sync: buildSyncConfig(),
    electrumClient: buildElectrumClientConfig(),
    websocket: buildWebsocketConfig(),
    push: buildPushConfig(),
    payjoin: { publicUrl: parseStringEnv('PAYJOIN_PUBLIC_URL') },
    mcp: buildMcpConfig(),
    docker: { proxyUrl: parseStringEnv('DOCKER_PROXY_URL', 'http://docker-proxy:2375') },
    worker: {
      healthPort: workerHealthPort,
      ...workerHealth,
      concurrency: parseIntegerEnv('WORKER_CONCURRENCY', 5),
    },
    logging: { level: parseLogLevel() },
    monitoring: buildMonitoringConfig(),
    features: loadFeatureFlags(),
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

function buildRedisConfig() {
  const url = parseStringEnv('REDIS_URL');
  return { url, enabled: Boolean(url) };
}

function buildSecurityConfig(
  jwtSecret: string,
  jwtExpiresIn: string,
  jwtRefreshExpiresIn: string,
  gatewaySecret: string,
  corsAllowedOrigins: string[]
) {
  return {
    jwt: { secret: jwtSecret, expiresIn: jwtExpiresIn, refreshExpiresIn: jwtRefreshExpiresIn },
    gatewaySecret,
    corsAllowedOrigins,
    encryptionKey: getEncryptionKey(),
    encryptionSalt: parseStringEnv('ENCRYPTION_SALT'),
  };
}

function buildBitcoinConfig() {
  return {
    network: parseBitcoinNetwork(),
    rpc: {
      host: parseStringEnv('BITCOIN_RPC_HOST', 'localhost'),
      port: parseIntegerEnv('BITCOIN_RPC_PORT', 8332),
      user: parseStringEnv('BITCOIN_RPC_USER'),
      password: parseStringEnv('BITCOIN_RPC_PASSWORD'),
    },
    electrum: {
      host: parseStringEnv('ELECTRUM_HOST', 'electrum.blockstream.info'),
      port: parseIntegerEnv('ELECTRUM_PORT', 50002),
      protocol: parseElectrumProtocol(),
    },
  };
}

function buildPriceApisConfig() {
  return {
    mempool: parseStringEnv('MEMPOOL_API', 'https://mempool.space/api/v1'),
    coingecko: parseStringEnv('COINGECKO_API', 'https://api.coingecko.com/api/v3'),
    kraken: parseStringEnv('KRAKEN_API', 'https://api.kraken.com/0/public'),
  };
}

function buildAiConfig() {
  return {
    containerUrl: parseStringEnv('AI_CONTAINER_URL', 'http://ai:3100'),
    configSecret: parseStringEnv('AI_CONFIG_SECRET'),
  };
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
