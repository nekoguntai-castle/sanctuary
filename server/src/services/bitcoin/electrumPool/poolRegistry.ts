/**
 * Pool Registry
 *
 * Singleton pool instances and factory functions for managing
 * Electrum pools across networks. Provides backward-compatible
 * access patterns (sync and async) plus per-network pool management.
 */

import { createLogger } from '../../../utils/logger';
import { nodeConfigRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { ElectrumPool } from './electrumPool';
import type {
  ElectrumPoolConfig,
  ServerConfig,
  ProxyConfig,
  LoadBalancingStrategy,
  NetworkType,
} from './types';

const log = createLogger('ELECTRUM_POOL:SVC_REGISTRY');

// Singleton pool instance (legacy - for backward compatibility, uses mainnet)
let poolInstance: ElectrumPool | null = null;
// Lock to prevent concurrent initialization (race condition fix)
let poolInitPromise: Promise<ElectrumPool> | null = null;

// Per-network pool registry
const networkPools = new Map<NetworkType, ElectrumPool>();
const networkPoolInitPromises = new Map<NetworkType, Promise<ElectrumPool>>();

/**
 * Load pool configuration from database for a specific network
 * @param network Network to load config for (defaults to mainnet)
 */
async function loadPoolConfigFromDatabase(network: NetworkType = 'mainnet'): Promise<{
  config: Partial<ElectrumPoolConfig>;
  servers: ServerConfig[];
  proxy: ProxyConfig | null;
}> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefaultWithServers();

    if (nodeConfig && nodeConfig.type === 'electrum') {
      // Filter to enabled servers for the requested network
      const filteredServers = nodeConfig.servers
        .filter((s: { enabled: boolean; network: string }) => s.enabled && s.network === network)
        /* v8 ignore start -- deterministic server priority comparator branch is a V8 coverage artifact */
        .sort((a: { priority: number }, b: { priority: number }) => a.priority - b.priority);
        /* v8 ignore stop */
      const servers: ServerConfig[] = filteredServers.map((s: { id: string; label: string; host: string; port: number; useSsl: boolean; priority: number; enabled: boolean; supportsVerbose: boolean | null }) => ({
        id: s.id,
        label: s.label,
        host: s.host,
        port: s.port,
        useSsl: s.useSsl,
        priority: s.priority,
        enabled: s.enabled,
        supportsVerbose: s.supportsVerbose,
      }));

      // Load proxy config if enabled
      let proxy: ProxyConfig | null = null;
      if (nodeConfig.proxyEnabled && nodeConfig.proxyHost && nodeConfig.proxyPort) {
        proxy = {
          enabled: true,
          host: nodeConfig.proxyHost,
          port: nodeConfig.proxyPort,
          username: nodeConfig.proxyUsername ?? undefined,
          password: nodeConfig.proxyPassword ?? undefined,
        };
      }

      // Get per-network pool settings
      let minConnections = nodeConfig.poolMinConnections;
      let maxConnections = nodeConfig.poolMaxConnections;
      let loadBalancing = nodeConfig.poolLoadBalancing as LoadBalancingStrategy;

      // Use per-network settings if available (new schema)
      if (network === 'mainnet') {
        minConnections = nodeConfig.mainnetPoolMin ?? minConnections;
        maxConnections = nodeConfig.mainnetPoolMax ?? maxConnections;
        loadBalancing = (nodeConfig.mainnetPoolLoadBalancing as LoadBalancingStrategy) ?? loadBalancing;
      } else if (network === 'testnet') {
        minConnections = nodeConfig.testnetPoolMin ?? minConnections;
        maxConnections = nodeConfig.testnetPoolMax ?? maxConnections;
        loadBalancing = (nodeConfig.testnetPoolLoadBalancing as LoadBalancingStrategy) ?? loadBalancing;
      } else if (network === 'signet') {
        minConnections = nodeConfig.signetPoolMin ?? minConnections;
        maxConnections = nodeConfig.signetPoolMax ?? maxConnections;
        loadBalancing = (nodeConfig.signetPoolLoadBalancing as LoadBalancingStrategy) ?? loadBalancing;
      }

      return {
        config: {
          enabled: nodeConfig.poolEnabled,
          minConnections,
          maxConnections,
          loadBalancing,
        },
        servers,
        proxy,
      };
    }
  } catch (error) {
    log.warn('Failed to load pool config from database, using defaults', { error: getErrorMessage(error), network });
  }

  return { config: {}, servers: [], proxy: null };
}

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

    // Load config and servers from database for this specific network
    const { config: dbConfig, servers, proxy } = await loadPoolConfigFromDatabase(network);

    // Environment variables as fallback
    const envConfig = getEnvPoolConfig();

    // Database config takes precedence over environment variables
    const pool = new ElectrumPool({
      ...envConfig,
      ...dbConfig,
    });

    // Set the network for metrics
    pool.setNetwork(network);

    // Configure proxy if enabled
    if (proxy) {
      pool.setProxyConfig(proxy);
    }

    // Configure servers for this network
    if (servers.length > 0) {
      pool.setServers(servers);
    }

    // Initialize the pool (creates minimum connections)
    await pool.initialize();

    // Store in registry
    networkPools.set(network, pool);

    // Also set as the global pool instance if this is mainnet (backward compat)
    if (network === 'mainnet' && !poolInstance) {
      poolInstance = pool;
    }

    log.info(`Electrum pool for ${network} initialized with ${servers.length} servers`);

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
 * Reset the pool for a specific network (for testing or config changes)
 */
export async function resetElectrumPoolForNetwork(network: NetworkType): Promise<void> {
  const pool = networkPools.get(network);
  if (pool) {
    await pool.shutdown();
    networkPools.delete(network);
    log.info(`Electrum pool for ${network} has been reset`);
  }
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

  if (poolInstance) {
    await poolInstance.shutdown();
    poolInstance = null;
  }
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
export async function reloadElectrumServers(): Promise<void> {
  if (poolInstance) {
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
