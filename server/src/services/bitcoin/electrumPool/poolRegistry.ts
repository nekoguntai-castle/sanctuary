/**
 * Pool Registry
 *
 * Singleton pool instances and factory functions for managing
 * Electrum pools across networks. Provides backward-compatible
 * access patterns (sync and async) plus per-network pool management.
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { ElectrumPool } from './electrumPool';
import { loadPoolConfigFromDatabase } from './poolConfig';
import {
  normalizeRequiredFeatures,
  resolveFeaturePoolUsage,
} from '../electrum/capabilities';
import type {
  ElectrumFeature,
  ElectrumServerUsage,
} from '../electrum/capabilities';
import type {
  ElectrumPoolConfig,
  ElectrumPoolFeatureScope,
  ServerConfig,
  NetworkType,
} from './types';
import type { ElectrumClient } from '../electrum';

const log = createLogger('ELECTRUM_POOL:SVC_REGISTRY');

// Singleton pool instance (legacy - for backward compatibility, uses mainnet)
let poolInstance: ElectrumPool | null = null;
// Lock to prevent concurrent initialization (race condition fix)
let poolInitPromise: Promise<ElectrumPool> | null = null;

// Per-network pool registry
const networkPools = new Map<NetworkType, ElectrumPool>();
const networkPoolInitPromises = new Map<NetworkType, Promise<ElectrumPool>>();

// Feature-scoped pool registry. These pools are filtered by network, usage,
// and required capability set before any connections are opened.
const featurePools = new Map<string, ElectrumPool>();
const featurePoolInitPromises = new Map<string, Promise<ElectrumPool>>();
const MAX_FEATURE_POOL_INSTANCES = 16;

/**
 * Parse environment variables for pool configuration
 */
function getEnvPoolConfig(): Partial<ElectrumPoolConfig> {
  return {
    enabled: process.env.ELECTRUM_POOL_ENABLED !== 'false',
    minConnections: parseInt(process.env.ELECTRUM_POOL_MIN_CONNECTIONS || '2', 10),
    maxConnections: parseInt(process.env.ELECTRUM_POOL_MAX_CONNECTIONS || '10', 10),
    idleTimeoutMs: parseInt(process.env.ELECTRUM_POOL_IDLE_TIMEOUT_MS || '300000', 10),
    healthCheckIntervalMs: parseInt(
      process.env.ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS || '30000',
      10
    ),
    acquisitionTimeoutMs: parseInt(
      process.env.ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS || '5000',
      10
    ),
    keepaliveIntervalMs: parseInt(
      process.env.ELECTRUM_POOL_KEEPALIVE_INTERVAL_MS || '15000',
      10
    ),
  };
}

function buildFeaturePoolKey(
  network: NetworkType,
  requiredFeatures: readonly ElectrumFeature[],
  serverUsage: ElectrumServerUsage,
  capabilityStaleAfterMs?: number,
): string {
  const features = normalizeRequiredFeatures(requiredFeatures).join(',');
  return `${network}:${serverUsage}:${features}:${capabilityStaleAfterMs ?? 'default'}`;
}

async function shutdownPoolSafely(
  pool: ElectrumPool,
  context: Record<string, unknown>,
): Promise<void> {
  const shutdownError = await pool.shutdown().then(
    () => null,
    (error: unknown) => error,
  );
  if (shutdownError) {
    log.warn('Electrum pool shutdown failed', {
      ...context,
      error: getErrorMessage(shutdownError),
    });
  }
}

async function shutdownFeaturePoolEntries(
  entries: Array<[string, ElectrumPool]>,
): Promise<void> {
  await Promise.all(entries.map(async ([key, pool]) => {
    const shutdownError = await pool.shutdown().then(
      () => null,
      (error: unknown) => error,
    );
    if (shutdownError) {
      log.warn('Feature-scoped Electrum pool shutdown failed', {
        key,
        error: getErrorMessage(shutdownError),
      });
    }
    if (featurePools.get(key) === pool) {
      featurePools.delete(key);
    }
  }));
}

async function trimFeaturePoolRegistry(maxPools: number): Promise<void> {
  if (featurePools.size <= maxPools) {
    return;
  }

  const entriesToEvict = [...featurePools.entries()].slice(
    0,
    featurePools.size - maxPools,
  );
  await shutdownFeaturePoolEntries(entriesToEvict);
}

async function createPool(
  network: NetworkType,
  scope: ElectrumPoolFeatureScope = {},
): Promise<{ pool: ElectrumPool; serverCount: number }> {
  const { config: dbConfig, servers, proxy } = await loadPoolConfigFromDatabase(
    network,
    scope,
  );
  const envConfig = getEnvPoolConfig();
  const pool = new ElectrumPool({
    ...envConfig,
    ...dbConfig,
  });

  pool.setNetwork(network);

  if (proxy) {
    pool.setProxyConfig(proxy);
  }

  if (servers.length > 0) {
    pool.setServers(servers);
  }

  await pool.initialize();
  return { pool, serverCount: servers.length };
}

/**
 * Get or create an Electrum pool for a specific network
 * This loads settings from the database and filters servers by network.
 * @param network Network to get pool for
 */
export async function getElectrumPoolForNetwork(network: NetworkType): Promise<ElectrumPool> {
  // Fast path: pool already exists for this network
  const existingPool = networkPools.get(network);
  if (existingPool) {
    return existingPool;
  }

  // Another caller is already initializing this network's pool - wait for their result
  const existingPromise = networkPoolInitPromises.get(network);
  if (existingPromise) {
    return existingPromise;
  }

  // We're the first caller for this network - create and store the init promise
  const initPromise = (async () => {
    // Double-check in case of race
    const poolCheck = networkPools.get(network);
    if (poolCheck) {
      return poolCheck;
    }

    log.info(`Initializing Electrum pool for network: ${network}`);

    const { pool, serverCount } = await createPool(network, {
      serverUsage: 'general',
    });

    // Store in registry
    networkPools.set(network, pool);

    // Also set as the global pool instance if this is mainnet (backward compat)
    if (network === 'mainnet' && !poolInstance) {
      poolInstance = pool;
    }

    log.info(`Electrum pool for ${network} initialized with ${serverCount} servers`);

    return pool;
  })();

  networkPoolInitPromises.set(network, initPromise);

  try {
    return await initPromise;
  } finally {
    // Clear the init promise once resolved
    networkPoolInitPromises.delete(network);
  }
}

/**
 * Get or create a feature-scoped Electrum pool for a network.
 */
export async function getElectrumPoolForNetworkAndFeatures(
  network: NetworkType,
  requiredFeatures: ElectrumFeature[],
  scope: Omit<ElectrumPoolFeatureScope, 'requiredFeatures'> = {},
): Promise<ElectrumPool> {
  const normalizedFeatures = normalizeRequiredFeatures(requiredFeatures);
  const serverUsage = resolveFeaturePoolUsage(
    normalizedFeatures,
    scope.serverUsage,
  );

  const onlyBaseElectrum = normalizedFeatures.every(
    (feature) => feature === 'base_electrum',
  );
  if (serverUsage === 'general' && (normalizedFeatures.length === 0 || onlyBaseElectrum)) {
    return getElectrumPoolForNetwork(network);
  }

  const key = buildFeaturePoolKey(
    network,
    normalizedFeatures,
    serverUsage,
    scope.capabilityStaleAfterMs,
  );
  const existingPool = featurePools.get(key);
  if (existingPool) {
    return existingPool;
  }

  const existingPromise = featurePoolInitPromises.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const initPromise = (async () => {
    const poolCheck = featurePools.get(key);
    if (poolCheck) {
      return poolCheck;
    }

    log.info('Initializing feature-scoped Electrum pool', {
      network,
      requiredFeatures: normalizedFeatures,
      serverUsage,
    });

    const { pool, serverCount } = await createPool(network, {
      ...scope,
      requiredFeatures: normalizedFeatures,
      serverUsage,
    });
    await trimFeaturePoolRegistry(MAX_FEATURE_POOL_INSTANCES - 1);
    featurePools.set(key, pool);
    log.info('Feature-scoped Electrum pool initialized', {
      network,
      requiredFeatures: normalizedFeatures,
      serverUsage,
      serverCount,
    });
    return pool;
  })();

  featurePoolInitPromises.set(key, initPromise);

  try {
    return await initPromise;
  } finally {
    featurePoolInitPromises.delete(key);
  }
}

/**
 * Get a subscription connection from a feature-scoped pool.
 */
export async function getSubscriptionConnectionForFeatures(
  network: NetworkType,
  requiredFeatures: ElectrumFeature[],
  scope: Omit<ElectrumPoolFeatureScope, 'requiredFeatures'> = {},
): Promise<ElectrumClient> {
  const pool = await getElectrumPoolForNetworkAndFeatures(
    network,
    requiredFeatures,
    scope,
  );
  return pool.getSubscriptionConnection();
}

/**
 * Reset the pool for a specific network (for testing or config changes)
 */
export async function resetElectrumPoolForNetwork(network: NetworkType): Promise<void> {
  const pool = networkPools.get(network);
  if (pool) {
    await shutdownPoolSafely(pool, { network, scope: 'network' });
    networkPools.delete(network);
    if (poolInstance === pool) {
      poolInstance = null;
    }
    log.info(`Electrum pool for ${network} has been reset`);
  }
  const featureEntries = [...featurePools.entries()]
    .filter(([key]) => key.startsWith(`${network}:`));
  const featureInitKeys = [...featurePoolInitPromises.keys()]
    .filter((key) => key.startsWith(`${network}:`));
  for (const key of featureInitKeys) {
    featurePoolInitPromises.delete(key);
  }
  await shutdownFeaturePoolEntries(featureEntries);
}

/**
 * Get the Electrum pool instance (sync version, uses env vars only)
 */
export function getElectrumPool(config?: Partial<ElectrumPoolConfig>): ElectrumPool {
  if (!poolInstance) {
    // ELECTRUM_POOL_ENABLED defaults to true; set to 'false' for single-connection mode
    const envConfig = getEnvPoolConfig();

    poolInstance = new ElectrumPool({
      ...envConfig,
      ...config,
    });
  }
  return poolInstance;
}

/**
 * Get or create the Electrum pool with database config (async)
 * This loads settings from the database, falling back to environment variables
 */
export async function getElectrumPoolAsync(): Promise<ElectrumPool> {
  // Fast path: pool already exists
  if (poolInstance) {
    return poolInstance;
  }

  // Another caller is already initializing - wait for their result
  if (poolInitPromise) {
    return poolInitPromise;
  }

  // We're the first caller - create and store the init promise
  poolInitPromise = (async () => {
    // Load config and servers from database
    const { config: dbConfig, servers, proxy } = await loadPoolConfigFromDatabase();

    // Environment variables as fallback
    const envConfig = getEnvPoolConfig();

    // Database config takes precedence over environment variables
    poolInstance = new ElectrumPool({
      ...envConfig,
      ...dbConfig,
    });

    // Set proxy config if loaded from database
    if (proxy) {
      poolInstance.setProxyConfig(proxy);
      log.info('Electrum pool configured with Tor proxy', {
        host: proxy.host,
        port: proxy.port,
      });
    }

    // Set servers if any were loaded from database
    if (servers.length > 0) {
      poolInstance.setServers(servers);
      log.info('Electrum pool configured with servers from database', {
        serverCount: servers.length,
        servers: servers.map(s => `${s.label} (${s.host}:${s.port})`),
      });
    }

    // Initialize the pool (creates minimum connections)
    await poolInstance.initialize();

    log.info('Electrum pool initialized', {
      enabled: poolInstance['config'].enabled,
      minConnections: poolInstance['config'].minConnections,
      maxConnections: poolInstance['config'].maxConnections,
      loadBalancing: poolInstance['config'].loadBalancing,
      proxyEnabled: proxy?.enabled ?? false,
    });

    return poolInstance;
  })();

  try {
    return await poolInitPromise;
  } finally {
    // Clear the promise after completion (success or failure)
    // This allows retry on failure
    poolInitPromise = null;
  }
}

/**
 * Initialize the Electrum pool (loads config from database)
 */
export async function initializeElectrumPool(
  config?: Partial<ElectrumPoolConfig>
): Promise<ElectrumPool> {
  // If config provided, use sync version; otherwise load from database
  const pool = config ? getElectrumPool(config) : await getElectrumPoolAsync();
  await pool.initialize();
  return pool;
}

/**
 * Shutdown the Electrum pool
 */
export async function shutdownElectrumPool(): Promise<void> {
  // Clear init promise to prevent new initialization during shutdown
  poolInitPromise = null;
  networkPoolInitPromises.clear();
  featurePoolInitPromises.clear();

  if (poolInstance) {
    await shutdownPoolSafely(poolInstance, { scope: 'global' });
    poolInstance = null;
  }
  const networkEntries = [...networkPools.entries()];
  await Promise.all(networkEntries.map(async ([network, pool]) => {
    await shutdownPoolSafely(pool, { network, scope: 'network' });
    if (networkPools.get(network) === pool) {
      networkPools.delete(network);
    }
  }));
  await shutdownFeaturePoolEntries([...featurePools.entries()]);
}

/**
 * Reset the Electrum pool (for testing or config changes)
 */
export async function resetElectrumPool(): Promise<void> {
  await shutdownElectrumPool();
}

/**
 * Get current pool configuration (for admin UI)
 */
export function getPoolConfig(): ElectrumPoolConfig | null {
  if (!poolInstance) return null;
  return { ...poolInstance['config'] };
}

/**
 * Check if pool is currently enabled
 */
export function isPoolEnabled(): boolean {
  if (!poolInstance) return true; // Default is enabled
  return poolInstance['config'].enabled;
}

/**
 * Reload servers from database (call after adding/removing servers)
 */
export async function reloadElectrumServers(network?: NetworkType): Promise<void> {
  if (network) {
    await resetElectrumPoolForNetwork(network);
    return;
  }

  const networks = [...networkPools.keys()];
  for (const poolNetwork of networks) {
    await resetElectrumPoolForNetwork(poolNetwork);
  }

  await shutdownFeaturePoolEntries([...featurePools.entries()]);

  if (poolInstance && networks.length === 0) {
    await poolInstance.reloadServers();
  }
}

/**
 * Get the list of configured servers
 */
export function getElectrumServers(): ServerConfig[] {
  if (!poolInstance) return [];
  return poolInstance.getServers();
}
