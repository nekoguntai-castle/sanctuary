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
import { PooledNodeClient } from './pooledNodeClient';
import { resolveConfiguredElectrumProxy } from './electrum/connectionConfigResolver';
import type { ProxyConfig } from './electrum/types';

export { resolveConfiguredElectrumProxy };

/** testNodeConfig failure kind: the saved proxy cannot be used, so nothing was dialled. */
const PROXY_CONFIGURATION_FAILURE = 'proxy_configuration' as const;

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
  // Accept a self-signed TLS certificate. Only set from an explicit operator
  // opt-in for the server being tested; omitted means certificates are verified.
  allowSelfSignedCert?: boolean;
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
  /** Raw-byte evidence path used by sync to avoid redundant main-thread projection. */
  getRawTransactionEvidence?(txid: string, options?: NodeRequestOptions): Promise<any>;
  getRawTransactionEvidenceBatch?(
    txids: string[],
    options?: NodeRequestOptions,
  ): Promise<Map<string, any>>;
}

// Cache for the active node configuration (legacy - for mainnet)
let activeConfig: NodeConfig | null = null;
let activeClient: NodeClientInterface | null = null;

// Per-network client cache
const networkClients = new Map<NetworkType, NodeClientInterface>();
const networkResetPromises = new Map<NetworkType, Promise<void>>();
let allNetworksResetPromise: Promise<void> | null = null;

/**
 * How long a singleton fallback cached after a pool failure is reused before
 * the pool is tried again. Without it the fallback stays pinned until its
 * socket drops, even after the pool recovers.
 */
export const POOL_FALLBACK_RETRY_MS = 30_000;
// Present only while the network's cached client is a pool-mode singleton fallback.
const poolFallbackRetryAt = new Map<NetworkType, number>();

/**
 * Overall bound for a background pool retry. The probe never uses a caller's
 * signal or deadline, so it needs its own.
 */
const POOL_RETRY_PROBE_TIMEOUT_MS = 15_000;
// The most recent background pool retry per network, kept so tests can await its exit.
const lastPoolRetryProbe = new Map<NetworkType, Promise<void>>();

/** Test hook: settles once the network's most recent background pool retry has exited. */
export async function waitForPoolRetryProbeForTests(network: NetworkType): Promise<void> {
  await lastPoolRetryProbe.get(network);
}

// Bumped by every reset, so an attempt that was in flight across one does not
// cache a client built against the pool that reset tore down.
let allNetworksResetGeneration = 0;
const networkResetGenerations = new Map<NetworkType, number>();

function resetGenerationOf(network: NetworkType): string {
  return `${allNetworksResetGeneration}:${networkResetGenerations.get(network) ?? 0}`;
}

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
  const cachedClient = networkClients.get(network);
  if (cachedClient?.isConnected()) {
    if (claimPoolRetry(network)) startPoolRetryProbe(network, cachedClient);
    return cachedClient;
  }
  const generation = resetGenerationOf(network);

  // Get the network-specific mode configuration
  const networkConfig = await awaitSharedConnection(
    getNetworkModeConfig(network),
    options?.signal,
  );

  log.debug(`Getting client for ${network}, mode: ${networkConfig.mode}`);

  let client: NodeClientInterface;
  let identityVerified = false;
  let usedPoolFallback = false;

  if (networkConfig.mode === 'pool') {
    // Pool mode uses a stable request facade over short-lived pool borrows.
    try {
      const pool = await awaitSharedConnection(
        getElectrumPoolForNetwork(network),
        options?.signal,
      );

      // Cache a stable facade, not a physical socket. Every ordinary request
      // borrows and releases a pool connection; the dedicated subscription
      // connection remains isolated for the worker's live event stream.
      client = new PooledNodeClient(pool, network);
      await verifyNodeClientNetwork(client, network, options);
      identityVerified = true;
      log.info(`Using Electrum connection pool for ${network}`);
    } catch (error) {
      options?.signal?.throwIfAborted();
      // Fall back to singleton if pool fails; the pool is retried after POOL_FALLBACK_RETRY_MS.
      log.warn(`Pool initialization failed for ${network}, falling back to singleton`, { error: getErrorMessage(error) });
      client = await connectSingleton(network, options);
      usedPoolFallback = true;
      log.info(`Using Electrum singleton fallback for ${network}`);
    }
  } else {
    // Singleton mode - use direct connection to configured host
    client = await connectSingleton(network, options);
    const host = networkConfig.singletonHost || 'default';
    const port = networkConfig.singletonPort || 50002;
    log.info(`Using Electrum singleton for ${network} at ${host}:${port}`);
  }

  if (!identityVerified) {
    try {
      await verifyNodeClientNetwork(client, network, options);
    } catch (error) {
      options?.signal?.throwIfAborted();
      disconnectQuietly(client, `Rejected ${network} client`);
      throw error;
    }
  }

  if (resetGenerationOf(network) === generation) {
    cacheNetworkClient(network, client, usedPoolFallback);
  } else {
    log.debug(`Not caching ${network} client: the node client was reset while it was being created`);
  }
  return client;
}

/**
 * Claim the pool retry for a cached pool fallback whose retry window has
 * elapsed. Moving the deadline forward first means one caller claims each
 * retry; the fallback stays cached either way.
 */
function claimPoolRetry(network: NetworkType): boolean {
  const retryAt = poolFallbackRetryAt.get(network);
  if (retryAt === undefined) return false;
  const now = Date.now();
  if (now < retryAt) return false;

  poolFallbackRetryAt.set(network, now + POOL_FALLBACK_RETRY_MS);
  log.info(`Retrying Electrum pool for ${network} after singleton fallback window`);
  return true;
}

/**
 * Retry the pool behind the cached, verified fallback, so the claiming caller
 * is not held up by it or failed by its own signal or deadline. A failed probe
 * keeps the fallback (whose deadline the claim already moved). The fallback
 * singleton is never disconnected: it is process-shared.
 */
function startPoolRetryProbe(network: NetworkType, fallback: NodeClientInterface): void {
  const generation = resetGenerationOf(network);
  const probe = probePoolRecovery(network, fallback, generation).catch((error: unknown) => {
    log.warn(`Background Electrum pool retry failed for ${network}; keeping singleton fallback`, {
      error: getErrorMessage(error),
    });
  });
  lastPoolRetryProbe.set(network, probe);
}

async function probePoolRecovery(
  network: NetworkType,
  fallback: NodeClientInterface,
  generation: string,
): Promise<void> {
  // A reset, or a caller that replaced a dropped fallback, wins over the probe.
  const isStale = (): boolean =>
    resetGenerationOf(network) !== generation || networkClients.get(network) !== fallback;
  const signal = AbortSignal.timeout(POOL_RETRY_PROBE_TIMEOUT_MS);
  const networkConfig = await awaitSharedConnection(getNetworkModeConfig(network), signal);
  // Checked before the pool getter so a probe never creates a pool after a reset tore it down.
  if (isStale()) {
    log.debug(`Discarding stale Electrum pool retry for ${network}`);
    return;
  }
  if (networkConfig.mode !== 'pool') {
    // The fallback is now the configured singleton; stop retrying the pool.
    poolFallbackRetryAt.delete(network);
    return;
  }

  const pool = await awaitSharedConnection(getElectrumPoolForNetwork(network), signal);
  const client = new PooledNodeClient(pool, network);
  await verifyNodeClientNetwork(client, network, { signal });

  if (isStale()) {
    log.debug(`Discarding stale Electrum pool retry for ${network}`);
    return;
  }
  cacheNetworkClient(network, client, false);
  log.info(`Electrum pool recovered for ${network}; replacing singleton fallback`);
}

async function connectSingleton(
  network: NetworkType,
  options?: NodeRequestOptions,
): Promise<ElectrumClient> {
  const electrumClient = getElectrumClientForNetwork(network);
  if (!electrumClient.isConnected()) {
    await awaitSharedConnection(electrumClient.connect(), options?.signal);
  }
  return electrumClient;
}

function cacheNetworkClient(
  network: NetworkType,
  client: NodeClientInterface,
  usedPoolFallback: boolean,
): void {
  networkClients.set(network, client);
  if (usedPoolFallback) {
    poolFallbackRetryAt.set(network, Date.now() + POOL_FALLBACK_RETRY_MS);
  } else {
    poolFallbackRetryAt.delete(network);
  }

  // Also set as the legacy active client if this is mainnet
  if (network === 'mainnet') {
    activeClient = client;
  }
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
async function resetOneNetwork(network: NetworkType): Promise<void> {
  networkResetGenerations.set(network, (networkResetGenerations.get(network) ?? 0) + 1);
  const client = networkClients.get(network);
  if (client) {
    client.disconnect();
    networkClients.delete(network);
  }
  poolFallbackRetryAt.delete(network);
  await resetElectrumPoolForNetwork(network);

  if (network === 'mainnet' && activeClient === client) {
    activeClient = null;
    activeConfig = null;
  }

  log.debug(`Client reset for ${network}`);
}

function resetNodeClientForNetwork(network: NetworkType): Promise<void> {
  const existing = networkResetPromises.get(network);
  if (existing) return existing;

  const reset = resetOneNetwork(network).finally(() => {
    networkResetPromises.delete(network);
  });
  networkResetPromises.set(network, reset);
  return reset;
}

function resetAllNodeClients(): Promise<void> {
  if (allNetworksResetPromise) return allNetworksResetPromise;

  allNetworksResetGeneration += 1;
  const reset = (async () => {
    await Promise.all(networkResetPromises.values());
    await Promise.all(
      [...networkClients.keys()].map(net => resetNodeClientForNetwork(net)),
    );

    activeClient = null;
    activeConfig = null;
    poolFallbackRetryAt.clear();
    resetElectrumClient();
    await resetElectrumPool();

    log.debug('All clients reset');
  })().finally(() => {
    allNetworksResetPromise = null;
  });
  allNetworksResetPromise = reset;
  return reset;
}

export async function resetNodeClient(network?: NetworkType): Promise<void> {
  if (!network) {
    await resetAllNodeClients();
    return;
  }
  if (allNetworksResetPromise) {
    await allNetworksResetPromise;
    return;
  }
  await resetNodeClientForNetwork(network);
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
  if (networkClient && !(networkClient instanceof PooledNodeClient)) {
    return networkClient as ElectrumClient;
  }

  // Preserve legacy mainnet fallback for callers that still rely on activeClient.
  /* v8 ignore next -- legacy fallback is unreachable through public reset APIs because mainnet cache and activeClient are now mutated together. */
  if (
    network === 'mainnet'
    && activeClient
    && !(activeClient instanceof PooledNodeClient)
  ) {
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
  /** Set when the saved proxy cannot be used; no connection was attempted. */
  failureKind?: typeof PROXY_CONFIGURATION_FAILURE;
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
    // Dial the way runtime will: through the saved Tor proxy. A proxy that
    // cannot be used fails the test closed instead of falling back to a
    // direct connection.
    let proxy: ProxyConfig | undefined;
    try {
      proxy = await resolveConfiguredElectrumProxy();
    } catch (proxyError) {
      log.warn('Saved Electrum proxy cannot be used for the connection test', {
        error: getErrorMessage(proxyError),
      });
      return {
        success: false,
        message: `Proxy configuration error: ${getErrorMessage(proxyError)}`,
        failureKind: PROXY_CONFIGURATION_FAILURE,
      };
    }

    const ElectrumClientClass = (await import('./electrum/index.js')).ElectrumClient;
    testClient = new ElectrumClientClass({
      host: config.host,
      port: config.port,
      protocol: config.protocol || 'ssl',
      network: config.network,
      allowSelfSignedCert: config.allowSelfSignedCert,
      ...(proxy?.enabled ? { proxy } : {}),
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
