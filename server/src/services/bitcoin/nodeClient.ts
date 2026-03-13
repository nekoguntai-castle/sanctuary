/**
 * Node Client Abstraction
 *
 * Provides a unified interface for communicating with Bitcoin nodes via Electrum protocol.
 * Supports per-network connection modes (singleton vs pool).
 */

import { ElectrumClient, getElectrumClientForNetwork, resetElectrumClient } from './electrum';
import {
  resetElectrumPool,
  getElectrumPool,
  getElectrumPoolForNetwork,
  resetElectrumPoolForNetwork,
  NetworkType,
} from './electrumPool';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const log = createLogger('NODE_CLIENT');

export interface NodeConfig {
  host: string;
  port: number;
  protocol?: 'tcp' | 'ssl';
  // Pool mode - when true, use multi-server pool; when false, use single server
  poolEnabled?: boolean;
}

/**
 * Per-network connection mode settings
 */
export interface NetworkModeConfig {
  mode: 'singleton' | 'pool';
  singletonHost?: string;
  singletonPort?: number;
  singletonSsl?: boolean;
  poolMin?: number;
  poolMax?: number;
  poolLoadBalancing?: 'round_robin' | 'least_connections' | 'failover_only';
}

export interface NodeClientInterface {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getBlockHeight(): Promise<number>;
  getBlockHeader(height: number): Promise<string>;
  getAddressHistory(address: string): Promise<Array<{ tx_hash: string; height: number }>>;
  getAddressBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }>;
  getAddressUTXOs(address: string): Promise<Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>;
  getTransaction(txid: string, verbose?: boolean): Promise<any>;
  broadcastTransaction(rawTx: string): Promise<string>;
  estimateFee(blocks: number): Promise<number>;
  subscribeAddress(address: string): Promise<string | null>;
  subscribeAddressBatch(addresses: string[]): Promise<Map<string, string | null>>;

  // Batch methods - send multiple requests in a single RPC call
  getAddressHistoryBatch(addresses: string[]): Promise<Map<string, Array<{ tx_hash: string; height: number }>>>;
  getAddressUTXOsBatch(addresses: string[]): Promise<Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>>;
  getTransactionsBatch(txids: string[], verbose?: boolean): Promise<Map<string, any>>;
}

// Cache for the active node configuration (legacy - for mainnet)
let activeConfig: NodeConfig | null = null;
let activeClient: NodeClientInterface | null = null;

// Per-network client cache
const networkClients = new Map<NetworkType, NodeClientInterface>();

/**
 * Load node configuration from database
 */
async function loadNodeConfig(): Promise<NodeConfig | null> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    if (nodeConfig) {
      return {
        host: nodeConfig.host,
        port: nodeConfig.port,
        protocol: nodeConfig.useSsl ? 'ssl' : 'tcp',
        poolEnabled: nodeConfig.poolEnabled,
      };
    }
  } catch (error) {
    log.error('Failed to load node config from database', { error });
  }

  return null;
}

/**
 * Save node configuration to database
 */
export async function saveNodeConfig(config: NodeConfig): Promise<void> {
  // First, unset any existing default
  await prisma.nodeConfig.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });

  // Upsert the new config
  await prisma.nodeConfig.upsert({
    where: { id: 'default' },
    update: {
      host: config.host,
      port: config.port,
      useSsl: config.protocol === 'ssl',
      isDefault: true,
    },
    create: {
      id: 'default',
      type: 'electrum', // Only Electrum is supported
      host: config.host,
      port: config.port,
      useSsl: config.protocol === 'ssl',
      isDefault: true,
    },
  });

  // Reset the active client when config changes
  activeConfig = config;
  activeClient = null;

  log.info(`Saved node config: Electrum at ${config.host}:${config.port}`);
}

/**
 * Get the default Electrum config
 */
function getDefaultElectrumConfig(): NodeConfig {
  return {
    host: process.env.ELECTRUM_HOST || 'electrum.blockstream.info',
    port: parseInt(process.env.ELECTRUM_PORT || '50002', 10),
    protocol: (process.env.ELECTRUM_PROTOCOL as 'tcp' | 'ssl') || 'ssl',
  };
}

/**
 * Get per-network mode configuration from database
 */
async function getNetworkModeConfig(network: NetworkType): Promise<NetworkModeConfig> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    if (!nodeConfig) {
      // Default to pool mode for mainnet, singleton for others
      return { mode: network === 'mainnet' ? 'pool' : 'singleton' };
    }

    // Extract per-network settings based on network
    switch (network) {
      case 'mainnet':
        return {
          mode: (nodeConfig.mainnetMode as 'singleton' | 'pool') || 'pool',
          singletonHost: nodeConfig.mainnetSingletonHost ?? undefined,
          singletonPort: nodeConfig.mainnetSingletonPort ?? undefined,
          singletonSsl: nodeConfig.mainnetSingletonSsl ?? true,
          poolMin: nodeConfig.mainnetPoolMin ?? 1,
          poolMax: nodeConfig.mainnetPoolMax ?? 5,
          poolLoadBalancing: (nodeConfig.mainnetPoolLoadBalancing as NetworkModeConfig['poolLoadBalancing']) ?? 'round_robin',
        };
      case 'testnet':
        // Check if testnet is enabled
        if (!nodeConfig.testnetEnabled) {
          throw new Error('Testnet is not enabled');
        }
        return {
          mode: (nodeConfig.testnetMode as 'singleton' | 'pool') || 'singleton',
          singletonHost: nodeConfig.testnetSingletonHost ?? undefined,
          singletonPort: nodeConfig.testnetSingletonPort ?? undefined,
          singletonSsl: nodeConfig.testnetSingletonSsl ?? true,
          poolMin: nodeConfig.testnetPoolMin ?? 1,
          poolMax: nodeConfig.testnetPoolMax ?? 3,
          poolLoadBalancing: (nodeConfig.testnetPoolLoadBalancing as NetworkModeConfig['poolLoadBalancing']) ?? 'round_robin',
        };
      case 'signet':
        // Check if signet is enabled
        if (!nodeConfig.signetEnabled) {
          throw new Error('Signet is not enabled');
        }
        return {
          mode: (nodeConfig.signetMode as 'singleton' | 'pool') || 'singleton',
          singletonHost: nodeConfig.signetSingletonHost ?? undefined,
          singletonPort: nodeConfig.signetSingletonPort ?? undefined,
          singletonSsl: nodeConfig.signetSingletonSsl ?? true,
          poolMin: nodeConfig.signetPoolMin ?? 1,
          poolMax: nodeConfig.signetPoolMax ?? 3,
          poolLoadBalancing: (nodeConfig.signetPoolLoadBalancing as NetworkModeConfig['poolLoadBalancing']) ?? 'round_robin',
        };
      case 'regtest':
        // Regtest uses legacy config (singleton mode)
        return {
          mode: 'singleton',
          singletonHost: nodeConfig.host,
          singletonPort: nodeConfig.port,
          singletonSsl: nodeConfig.useSsl,
        };
      default:
        return { mode: 'pool' };
    }
  } catch (error) {
    log.warn(`Failed to load network mode config for ${network}`, { error: String(error) });
    return { mode: network === 'mainnet' ? 'pool' : 'singleton' };
  }
}

/**
 * Get the node client based on active configuration
 * @param network Network parameter (mainnet, testnet, signet, or regtest)
 */
export async function getNodeClient(network: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'): Promise<NodeClientInterface> {
  // Check if we have a cached client for this network
  const cachedClient = networkClients.get(network);
  if (cachedClient && cachedClient.isConnected()) {
    return cachedClient;
  }

  // Get the network-specific mode configuration
  const networkConfig = await getNetworkModeConfig(network);

  log.debug(`Getting client for ${network}, mode: ${networkConfig.mode}`);

  let client: NodeClientInterface;

  if (networkConfig.mode === 'pool') {
    // Pool mode - use dedicated subscription connection from the pool
    // This connection is long-lived and doesn't need to be released
    try {
      const pool = await getElectrumPoolForNetwork(network);

      // Use getSubscriptionConnection() for long-lived cached clients
      // This returns a dedicated connection that stays active for the pool's lifetime
      // Do NOT use pool.acquire() here - that requires release() which we can't do with caching
      client = await pool.getSubscriptionConnection();
      log.info(`Using Electrum connection pool for ${network}`);
    } catch (error) {
      // Fall back to singleton if pool fails
      log.warn(`Pool initialization failed for ${network}, falling back to singleton`, { error: String(error) });
      const electrumClient = getElectrumClientForNetwork(network);

      if (!electrumClient.isConnected()) {
        await electrumClient.connect();
      }

      client = electrumClient;
      log.info(`Using Electrum singleton fallback for ${network}`);
    }
  } else {
    // Singleton mode - use direct connection to configured host
    const electrumClient = getElectrumClientForNetwork(network);

    if (!electrumClient.isConnected()) {
      await electrumClient.connect();
    }

    client = electrumClient;
    const host = networkConfig.singletonHost || 'default';
    const port = networkConfig.singletonPort || 50002;
    log.info(`Using Electrum singleton for ${network} at ${host}:${port}`);
  }

  // Cache the client
  networkClients.set(network, client);

  // Also set as the legacy active client if this is mainnet
  if (network === 'mainnet') {
    activeClient = client;
  }

  return client;
}

/**
 * Get the current node config
 */
export async function getActiveNodeConfig(): Promise<NodeConfig> {
  if (!activeConfig) {
    activeConfig = await loadNodeConfig();
  }
  return activeConfig || getDefaultElectrumConfig();
}

/**
 * Reset the active client (for reconnection or config change)
 * @param network Optional network to reset. If not specified, resets all networks.
 */
export async function resetNodeClient(network?: NetworkType): Promise<void> {
  if (network) {
    // Reset specific network
    const client = networkClients.get(network);
    if (client) {
      client.disconnect();
      networkClients.delete(network);
    }
    await resetElectrumPoolForNetwork(network);

    // Reset legacy active client if it was the mainnet client
    if (network === 'mainnet' && activeClient === client) {
      activeClient = null;
      activeConfig = null;
    }

    log.debug(`Client reset for ${network}`);
  } else {
    // Reset all networks
    for (const [net, client] of networkClients) {
      client.disconnect();
      await resetElectrumPoolForNetwork(net);
    }
    networkClients.clear();

    activeClient = null;
    activeConfig = null;
    resetElectrumClient();
    await resetElectrumPool();

    log.debug('All clients reset');
  }
}

/**
 * Get the underlying Electrum client for subscriptions
 * Used for subscribing to real-time notifications
 * Returns the dedicated subscription connection from the pool
 */
export async function getElectrumClientIfActive(): Promise<ElectrumClient | null> {
  if (!activeConfig) {
    activeConfig = await loadNodeConfig();
  }

  // Only use pool for subscriptions if pool mode is enabled
  if (activeConfig?.poolEnabled) {
    try {
      const pool = getElectrumPool();
      if (pool.isPoolInitialized()) {
        // Return the dedicated subscription connection
        return await pool.getSubscriptionConnection();
      }
    } catch {
      // Pool not available, fall back to singleton
    }
  }

  // Fall back to singleton client (or use singleton when pool disabled)
  if (activeClient) {
    return activeClient as ElectrumClient;
  }
  return null;
}

/**
 * Test a node configuration without activating it
 * Returns connection status and capability info (including verbose transaction support)
 */
export async function testNodeConfig(config: NodeConfig): Promise<{
  success: boolean;
  message: string;
  info?: {
    blockHeight: number;
    supportsVerbose?: boolean;
  };
}> {
  try {
    const ElectrumClientClass = (await import('./electrum')).ElectrumClient;
    const testClient = new ElectrumClientClass({
      host: config.host,
      port: config.port,
      protocol: config.protocol || 'ssl',
    });

    await testClient.connect();
    const height = await testClient.getBlockHeight();

    // Test verbose transaction support
    let supportsVerbose: boolean | undefined;
    try {
      supportsVerbose = await testClient.testVerboseSupport();
      log.debug(`Server ${config.host}:${config.port} verbose support: ${supportsVerbose}`);
    } catch (capabilityError) {
      // Capability check failed, leave as unknown
      log.debug(`Could not determine verbose capability for ${config.host}:${config.port}: ${getErrorMessage(capabilityError)}`);
    }

    testClient.disconnect();

    const verboseStatus = supportsVerbose === true ? ' (verbose: yes)' :
                          supportsVerbose === false ? ' (verbose: no)' : '';

    return {
      success: true,
      message: `Connected to Electrum server at block ${height}${verboseStatus}`,
      info: { blockHeight: height, supportsVerbose },
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${getErrorMessage(error)}`,
    };
  }
}
