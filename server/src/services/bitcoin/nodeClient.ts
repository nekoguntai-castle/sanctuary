/**
 * Node Client Abstraction
 *
 * Provides a unified interface for communicating with Bitcoin nodes via Electrum protocol.
 * Supports per-network connection modes (singleton vs pool).
 */

import { ElectrumClient, getElectrumClientForNetwork, resetElectrumClient } from './electrum';
import {
  resetElectrumPool,
  getElectrumPoolForNetwork,
  resetElectrumPoolForNetwork,
  type NetworkType,
} from './electrumPool';
import { nodeConfigRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getNetworkModeConfig } from './nodeClientConfig';
import { verifyNodeClientNetwork } from './networkIdentity';
import { getNodeNetworkDefaults } from '@sanctuary/shared/constants/nodeConfig';
import {
  normalizeElectrumCapabilityProfile,
  type ElectrumCapabilityProfile,
} from './electrum/capabilities';

const log = createLogger('BITCOIN:SVC_NODE_CLIENT');

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason ?? 'Node client request cancelled'));
}

async function awaitSharedConnection<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export interface NodeConfig {
  host: string;
  port: number;
  protocol?: 'tcp' | 'ssl';
  network?: NetworkType;
  // Pool mode - when true, use multi-server pool; when false, use single server
  poolEnabled?: boolean;
}

export interface NodeRequestOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
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
  getServerVersion(): Promise<{ server: string; protocol: string }>;
  getServerFeatures(): Promise<Record<string, unknown>>;
  getBlockHeight(options?: NodeRequestOptions): Promise<number>;
  getBlockHeader(height: number, options?: NodeRequestOptions): Promise<string>;
  getAddressHistory(address: string, options?: NodeRequestOptions): Promise<Array<{ tx_hash: string; height: number }>>;
  getAddressBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }>;
  getAddressUTXOs(address: string, options?: NodeRequestOptions): Promise<Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>;
  getTransaction(txid: string, verbose?: boolean, options?: NodeRequestOptions): Promise<any>;
  broadcastTransaction(rawTx: string): Promise<string>;
  estimateFee(blocks: number): Promise<number>;
  subscribeAddress(address: string): Promise<string | null>;
  subscribeAddressBatch(addresses: string[]): Promise<Map<string, string | null>>;

  // Batch methods - send multiple requests in a single RPC call
  getAddressHistoryBatch(addresses: string[], options?: NodeRequestOptions): Promise<Map<string, Array<{ tx_hash: string; height: number }>>>;
  getAddressUTXOsBatch(addresses: string[], options?: NodeRequestOptions): Promise<Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>>;
  getTransactionsBatch(txids: string[], verbose?: boolean, options?: NodeRequestOptions): Promise<Map<string, any>>;
}

// Cache for the active node configuration (legacy - for mainnet)
let activeConfig: NodeConfig | null = null;
let activeClient: NodeClientInterface | null = null;

// Per-network client cache
const networkClients = new Map<NetworkType, NodeClientInterface>();

function disconnectQuietly(client: Pick<NodeClientInterface, 'disconnect'>, context: string): void {
  try {
    client.disconnect();
  } catch (error) {
    log.debug(`${context} disconnect failed`, { error: getErrorMessage(error) });
  }
}

/**
 * Load node configuration from database
 */
async function loadNodeConfig(): Promise<NodeConfig | null> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefault();

    if (nodeConfig) {
      return {
        host: nodeConfig.host,
        port: nodeConfig.port,
        protocol: nodeConfig.useSsl ? 'ssl' : 'tcp',
        poolEnabled: nodeConfig.poolEnabled,
      };
    }
  } catch (error) {
    log.error('Failed to load node config from database', { error: getErrorMessage(error) });
  }

  return null;
}

/**
 * Save node configuration to database
 */
export async function saveNodeConfig(config: NodeConfig): Promise<void> {
  await nodeConfigRepository.saveAsDefault({
    host: config.host,
    port: config.port,
    useSsl: config.protocol === 'ssl',
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
  const defaults = getNodeNetworkDefaults('mainnet');
  return {
    host: process.env.ELECTRUM_HOST || defaults.singletonHost,
    port: parseInt(process.env.ELECTRUM_PORT || String(defaults.singletonPort), 10),
    protocol: (process.env.ELECTRUM_PROTOCOL as 'tcp' | 'ssl') || 'ssl',
  };
}

/**
 * Get the node client based on active configuration
 * @param network Network parameter (mainnet, testnet3, testnet4, signet, or regtest)
 */
export async function getNodeClient(
  network: NetworkType = 'mainnet',
  options?: NodeRequestOptions,
): Promise<NodeClientInterface> {
  options?.signal?.throwIfAborted();
  // Check if we have a cached client for this network
  const cachedClient = networkClients.get(network);
  if (cachedClient && cachedClient.isConnected()) {
    return cachedClient;
  }

  // Get the network-specific mode configuration
  const networkConfig = await awaitSharedConnection(
    getNetworkModeConfig(network),
    options?.signal,
  );

  log.debug(`Getting client for ${network}, mode: ${networkConfig.mode}`);

  let client: NodeClientInterface;

  if (networkConfig.mode === 'pool') {
    // Pool mode - use dedicated subscription connection from the pool
    // This connection is long-lived and doesn't need to be released
    try {
      const pool = await awaitSharedConnection(
        getElectrumPoolForNetwork(network),
        options?.signal,
      );

      // Use getSubscriptionConnection() for long-lived cached clients
      // This returns a dedicated connection that stays active for the pool's lifetime
      // Do NOT use pool.acquire() here - that requires release() which we can't do with caching
      client = await awaitSharedConnection(
        pool.getSubscriptionConnection(),
        options?.signal,
      );
      log.info(`Using Electrum connection pool for ${network}`);
    } catch (error) {
      options?.signal?.throwIfAborted();
      // Fall back to singleton if pool fails
      log.warn(`Pool initialization failed for ${network}, falling back to singleton`, { error: getErrorMessage(error) });
      const electrumClient = getElectrumClientForNetwork(network);

      if (!electrumClient.isConnected()) {
        await awaitSharedConnection(electrumClient.connect(), options?.signal);
      }

      client = electrumClient;
      log.info(`Using Electrum singleton fallback for ${network}`);
    }
  } else {
    // Singleton mode - use direct connection to configured host
    const electrumClient = getElectrumClientForNetwork(network);

    if (!electrumClient.isConnected()) {
      await awaitSharedConnection(electrumClient.connect(), options?.signal);
    }

    client = electrumClient;
    const host = networkConfig.singletonHost || 'default';
    const port = networkConfig.singletonPort || 50002;
    log.info(`Using Electrum singleton for ${network} at ${host}:${port}`);
  }

  try {
    await verifyNodeClientNetwork(client, network, options);
  } catch (error) {
    options?.signal?.throwIfAborted();
    disconnectQuietly(client, `Rejected ${network} client`);
    throw error;
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
 * Get the underlying Electrum client for subscriptions on a network.
 * Used for subscribing to real-time notifications
 * Returns the dedicated subscription connection from the pool
 */
export async function getElectrumClientIfActive(
  network: NetworkType = 'mainnet'
): Promise<ElectrumClient | null> {
  const networkConfig = await getNetworkModeConfig(network);

  // Only use pool for subscriptions if pool mode is enabled
  if (networkConfig.mode === 'pool') {
    try {
      const pool = await getElectrumPoolForNetwork(network);
      if (pool.isPoolInitialized()) {
        // Return the dedicated subscription connection
        return await pool.getSubscriptionConnection();
      }
    } catch (error) {
      log.debug('Pool not available, falling back to singleton', { error: String(error) });
    }
  }

  // Fall back to singleton client (or use singleton when pool disabled)
  const networkClient = networkClients.get(network);
  if (networkClient) {
    return networkClient as ElectrumClient;
  }

  // Preserve legacy mainnet fallback for callers that still rely on activeClient.
  /* v8 ignore next -- legacy fallback is unreachable through public reset APIs because mainnet cache and activeClient are now mutated together. */
  if (network === 'mainnet' && activeClient) {
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
    serverFeatures?: Record<string, unknown> | null;
    serverVersion?: string | null;
    protocolVersion?: string | null;
    silentPaymentVersions?: number[];
    supportsSilentPaymentsV0?: boolean;
    capabilityProfileKey?: string;
    lastCapabilityError?: string | null;
  };
}> {
  type CapabilityProbeClient = NodeClientInterface & {
    testVerboseSupport?: () => Promise<boolean>;
    getServerFeatures?: () => Promise<Record<string, unknown>>;
  };
  let testClient: CapabilityProbeClient | null = null;
  try {
    const ElectrumClientClass = (await import('./electrum')).ElectrumClient;
    testClient = new ElectrumClientClass({
      host: config.host,
      port: config.port,
      protocol: config.protocol || 'ssl',
      network: config.network,
    }) as CapabilityProbeClient;

    await testClient.connect();
    const version = await testClient.getServerVersion();
    const height = await testClient.getBlockHeight();
    if (config.network) {
      await verifyNodeClientNetwork(testClient, config.network);
    }

    // Test verbose transaction support
    let supportsVerbose: boolean | undefined;
    try {
      supportsVerbose = await testClient.testVerboseSupport?.();
      log.debug(`Server ${config.host}:${config.port} verbose support: ${supportsVerbose}`);
    } catch (capabilityError) {
      // Capability check failed, leave as unknown
      log.debug(`Could not determine verbose capability for ${config.host}:${config.port}: ${getErrorMessage(capabilityError)}`);
    }

    const capabilityProfile = await probeServerFeatures(testClient, {
      host: config.host,
      port: config.port,
      version,
      supportsVerbose,
    });

    const verboseStatus = supportsVerbose === true ? ' (verbose: yes)' :
                          supportsVerbose === false ? ' (verbose: no)' : '';
    const silentPaymentsStatus = getSilentPaymentsStatusSuffix(capabilityProfile);

    return {
      success: true,
      message: `Connected to Electrum server at block ${height}${verboseStatus}${silentPaymentsStatus}`,
      info: {
        blockHeight: height,
        supportsVerbose,
        serverFeatures: capabilityProfile.serverFeatures,
        serverVersion: capabilityProfile.serverVersion,
        protocolVersion: capabilityProfile.protocolVersion,
        silentPaymentVersions: capabilityProfile.silentPaymentVersions,
        supportsSilentPaymentsV0: capabilityProfile.supportsSilentPaymentsV0,
        capabilityProfileKey: capabilityProfile.capabilityProfileKey,
        lastCapabilityError: capabilityProfile.lastCapabilityError,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${getErrorMessage(error)}`,
    };
  } finally {
    if (testClient) {
      disconnectQuietly(testClient, `Test client ${config.host}:${config.port}`);
    }
  }
}

async function probeServerFeatures(
  client: {
    getServerFeatures?: () => Promise<Record<string, unknown>>;
  },
  context: {
    host: string;
    port: number;
    version: { server: string; protocol: string };
    supportsVerbose: boolean | undefined;
  },
): Promise<ElectrumCapabilityProfile> {
  const { serverFeatures, lastCapabilityError } = await getServerFeaturesResult(
    client,
    context,
  );

  return normalizeElectrumCapabilityProfile({
    serverFeatures,
    serverVersion: context.version.server,
    protocolVersion: context.version.protocol,
    supportsVerbose: context.supportsVerbose,
    lastCapabilityError,
  });
}

function getServerFeaturesResult(
  client: {
    getServerFeatures?: () => Promise<Record<string, unknown>>;
  },
  context: { host: string; port: number },
): Promise<{
  serverFeatures: Record<string, unknown> | null;
  lastCapabilityError: string | null;
}> {
  if (!client.getServerFeatures) {
    return Promise.resolve({ serverFeatures: null, lastCapabilityError: null });
  }

  return client.getServerFeatures().then(
    (serverFeatures) => ({ serverFeatures, lastCapabilityError: null }),
    (capabilityError) => {
      const lastCapabilityError = getErrorMessage(capabilityError);
      log.debug(`Could not determine server.features for ${context.host}:${context.port}: ${lastCapabilityError}`);
      return { serverFeatures: null, lastCapabilityError };
    },
  );
}

function getSilentPaymentsStatusSuffix(
  profile: Pick<ElectrumCapabilityProfile, 'supportsSilentPaymentsV0' | 'lastCapabilityError'>,
): string {
  if (profile.lastCapabilityError) {
    return ' (silent payments: unknown)';
  }

  return profile.supportsSilentPaymentsV0
    ? ' (silent payments: yes)'
    : ' (silent payments: no)';
}
