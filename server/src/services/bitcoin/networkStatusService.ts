import { createHash } from 'node:crypto';
import { getElectrumPoolForNetwork, type NetworkType } from './electrumPool';
import type { PoolStats as ElectrumPoolStats } from './electrumPool/types';
import { DEFAULT_CONFIRMATION_THRESHOLD, DEFAULT_DEEP_CONFIRMATION_THRESHOLD } from '../../constants';
import { systemSettingRepository } from '../../repositories';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { SystemSettingSchemas } from '../../utils/safeJson';
import { buildNetworkModeConfig, getDefaultNetworkModeConfig } from './nodeClientConfig';
import type { NetworkModeConfig } from './nodeClient';
import { dbConnectionConfig, envConnectionConfig, type ResolvedConnectionConfig } from './electrum/connectionConfigResolver';
import { probePool, NETWORK_STATUS_PROBE_TIMEOUT_MS } from './networkStatus/poolProbe';
import { probeDirectSingleton } from './networkStatus/directClient';
import {
  getCachedNetworkStatusProbe,
  NETWORK_STATUS_FAILURE_TTL_MS,
  NETWORK_STATUS_SUCCESS_TTL_MS,
} from './networkStatus/statusProbeCache';
import { eligibleServersFor, toOperationalServerInputs, failoverRolesFor, type ConfiguredServerRow } from './networkStatus/topology';
import {
  projectNodeOperationalStatus,
  type NodeOperationalStatus,
  type NodeRouteObservation,
  type PoolFallbackReason,
} from './nodeOperationalStatus';
import {
  getNodeExternalServiceUrl,
  getNodeNetworkDefaults,
  type NodeNetworkConfigSource,
  type NodePoolLoadBalancing,
} from '@sanctuary/shared/constants/nodeConfig';

const log = createLogger('BITCOIN_NETWORK:SVC');

type StatusNodeConfig = Awaited<ReturnType<typeof nodeConfigRepository.findDefaultWithServers>>;
type ConfiguredNodeConfig = NonNullable<StatusNodeConfig>;

interface ElectrumVersion {
  server: string;
  protocol: string;
}

interface ConfirmationThresholds {
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
}

interface LegacyPoolStatus {
  enabled: boolean;
  minConnections: number;
  maxConnections: number;
  configuredMin?: number;
  configuredMax?: number;
  stats: ElectrumPoolStats | null;
}

interface CommonFields {
  network: NetworkType;
  explorerUrl: string;
  pool: LegacyPoolStatus | null;
  operational: NodeOperationalStatus;
}

export interface BitcoinNetworkStatus extends CommonFields {
  connected: true;
  server: string;
  protocol: string;
  blockHeight?: number;
  host?: string;
  useSsl?: boolean;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
}

export interface BitcoinNetworkDisconnectedStatus extends CommonFields {
  connected: false;
  error: string;
}

export type BitcoinNetworkStatusResult = BitcoinNetworkStatus | BitcoinNetworkDisconnectedStatus;

function getConfiguredServers(nodeConfig: StatusNodeConfig | null, network: NetworkType): ConfiguredServerRow[] {
  return (nodeConfig?.servers ?? [])
    .filter((server) => server.enabled && server.network === network)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

function toConfiguredServerStat(server: ConfiguredServerRow) {
  return {
    serverId: server.id,
    label: server.label,
    host: server.host,
    port: server.port,
    connectionCount: 0,
    healthyConnections: 0,
    totalRequests: 0,
    failedRequests: 0,
    isHealthy: server.isHealthy ?? false,
    lastHealthCheck: server.lastHealthCheck ? new Date(server.lastHealthCheck) : null,
    consecutiveFailures: 0,
    backoffLevel: 0,
    cooldownUntil: null,
    weight: 1,
    healthHistory: [],
    serverUsage: (server.serverUsage ?? 'general') as 'general' | 'silent_payments' | 'both',
    supportsVerbose: server.supportsVerbose ?? null,
    supportsSilentPaymentsV0: server.supportsSilentPaymentsV0 ?? null,
    lastCapabilityCheck: server.lastCapabilityCheck ? new Date(server.lastCapabilityCheck) : null,
    lastCapabilityError: server.lastCapabilityError ?? null,
  };
}

function configuredServerStats(nodeConfig: StatusNodeConfig | null, network: NetworkType) {
  const servers = getConfiguredServers(nodeConfig, network);
  if (servers.length === 0) return null;

  return {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    waitingRequests: 0,
    totalAcquisitions: 0,
    averageAcquisitionTimeMs: 0,
    healthCheckFailures: 0,
    serverCount: servers.length,
    servers: servers.map(toConfiguredServerStat),
  };
}

function selectPoolStats(
  nodeConfig: StatusNodeConfig | null,
  network: NetworkType,
  poolStats: ElectrumPoolStats | null,
): ElectrumPoolStats | null {
  if (poolStats && poolStats.servers.length > 0) return poolStats;
  return configuredServerStats(nodeConfig, network) ?? poolStats;
}

function buildLegacyPoolStatus(
  nodeConfig: StatusNodeConfig | null,
  network: NetworkType,
  modeConfig: NetworkModeConfig,
  usePool: boolean,
  poolStats: ElectrumPoolStats | null,
): LegacyPoolStatus | null {
  if (nodeConfig?.type !== 'electrum') return null;

  return {
    enabled: usePool,
    minConnections: modeConfig.poolMin ?? 1,
    maxConnections: modeConfig.poolMax ?? 5,
    configuredMin: modeConfig.poolMin,
    configuredMax: modeConfig.poolMax,
    stats: selectPoolStats(nodeConfig, network, poolStats),
  };
}

function getMainnetDisplayConnection(nodeConfig: StatusNodeConfig | null, modeConfig: NetworkModeConfig) {
  const defaults = getNodeNetworkDefaults('mainnet');
  return {
    host: modeConfig.singletonHost || nodeConfig?.host || defaults.singletonHost,
    port: modeConfig.singletonPort || nodeConfig?.port || defaults.singletonPort,
    useSsl: modeConfig.singletonSsl ?? nodeConfig?.useSsl ?? defaults.singletonSsl,
  };
}

function getDisplayConnection(nodeConfig: StatusNodeConfig | null, network: NetworkType, modeConfig: NetworkModeConfig) {
  if (network === 'mainnet') return getMainnetDisplayConnection(nodeConfig, modeConfig);
  const defaults = getNodeNetworkDefaults(network);
  return {
    host: modeConfig.singletonHost || defaults.singletonHost,
    port: modeConfig.singletonPort || defaults.singletonPort,
    useSsl: modeConfig.singletonSsl ?? defaults.singletonSsl,
  };
}

function getExplorerUrl(nodeConfig: StatusNodeConfig | null, network: NetworkType): string {
  return getNodeExternalServiceUrl(nodeConfig as NodeNetworkConfigSource | null, network, 'explorer');
}

async function loadConfirmationThresholds(): Promise<ConfirmationThresholds> {
  const [confirmationThreshold, deepConfirmationThreshold] = await Promise.all([
    systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, DEFAULT_CONFIRMATION_THRESHOLD),
    systemSettingRepository.getParsed('deepConfirmationThreshold', SystemSettingSchemas.number, DEFAULT_DEEP_CONFIRMATION_THRESHOLD),
  ]);
  return { confirmationThreshold, deepConfirmationThreshold };
}

/** Live per-server health used both for the legacy stats and the operational topology. */
function liveStatsFromPoolStats(poolStats: ElectrumPoolStats) {
  const map = new Map<string, { isHealthy: boolean; lastHealthCheck: Date | null; cooldownUntil: Date | null; consecutiveFailures?: number }>();
  for (const server of poolStats.servers) {
    map.set(server.serverId, {
      isHealthy: server.isHealthy,
      lastHealthCheck: server.lastHealthCheck,
      cooldownUntil: server.cooldownUntil,
      consecutiveFailures: server.consecutiveFailures,
    });
  }
  return map;
}

interface AttemptRoute {
  route: NodeRouteObservation | null;
  version: ElectrumVersion | null;
  blockHeight?: number;
  liveServerStats: Map<string, { isHealthy: boolean; lastHealthCheck: Date | null; cooldownUntil: Date | null; consecutiveFailures?: number }>;
  poolStatsForLegacy: ElectrumPoolStats | null;
}

/**
 * Attempt a direct singleton connection and emit the corresponding route
 * observation: the plain `singleton` transport when `fallbackReason` is
 * omitted (configured non-pool mode), or `singleton_fallback` with that
 * reason when the pool transport was attempted first and failed.
 */
async function attemptSingleton(
  nodeConfig: ConfiguredNodeConfig,
  network: NetworkType,
  now: string,
  fallbackReason?: PoolFallbackReason,
): Promise<AttemptRoute> {
  const connectionConfig: ResolvedConnectionConfig = dbConnectionConfig(nodeConfig, network);
  const result = await probeDirectSingleton(connectionConfig, network, {
    timeoutMs: NETWORK_STATUS_PROBE_TIMEOUT_MS,
  });
  if (!result.ok || !result.version) {
    return { route: null, version: null, liveServerStats: new Map(), poolStatsForLegacy: null };
  }
  const route: NodeRouteObservation = fallbackReason
    ? { transport: 'singleton_fallback', observedAt: now, serverId: null, fallbackReason }
    : { transport: 'singleton', observedAt: now, serverId: null };
  return {
    route,
    version: result.version,
    blockHeight: result.blockHeight,
    liveServerStats: new Map(),
    poolStatsForLegacy: null,
  };
}

/** Attempt the pool transport; falls back to the explicit singleton path on any failure. */
async function attemptPool(
  nodeConfig: ConfiguredNodeConfig,
  network: NetworkType,
  now: string,
): Promise<AttemptRoute> {
  const pool = await getElectrumPoolForNetwork(network);

  // Any unexpected throw from the pool's own health/circuit accessors (not
  // just a rejected probe) is treated as a failed pool attempt: fall back to
  // the explicit singleton path rather than letting an internal pool error
  // surface as a top-level configuration-read failure.
  let poolStatsForLegacy: ElectrumPoolStats | null = null;
  try {
    if (pool.getCircuitHealth().state === 'open') {
      return await attemptSingleton(nodeConfig, network, now, 'pool_circuit_open');
    }

    if (!pool.isPoolInitialized()) {
      return await attemptSingleton(nodeConfig, network, now, 'pool_uninitialized');
    }

    poolStatsForLegacy = pool.getPoolStats();

    const probe = await probePool(pool);
    if (probe.ok && probe.version && probe.serverId) {
      return {
        route: { transport: 'pool', observedAt: now, serverId: probe.serverId },
        version: probe.version,
        blockHeight: probe.blockHeight,
        liveServerStats: liveStatsFromPoolStats(poolStatsForLegacy),
        poolStatsForLegacy,
      };
    }
  } catch (poolError) {
    log.debug('Pool status probe failed, falling back to singleton', { error: getErrorMessage(poolError) });
  }

  const fallback = await attemptSingleton(nodeConfig, network, now, 'pool_probe_failed');
  return { ...fallback, poolStatsForLegacy };
}

function shouldUsePool(nodeConfig: StatusNodeConfig | null, modeConfig: NetworkModeConfig): boolean {
  return nodeConfig?.type === 'electrum' && modeConfig.mode === 'pool';
}

interface BuildOperationalStatusOptions {
  configuredMode: 'singleton' | 'pool';
  attemptedAt: string;
  route: NodeRouteObservation | null;
  eligibleServers: ConfiguredServerRow[];
  liveServerStats: AttemptRoute['liveServerStats'];
  strategy: NodePoolLoadBalancing | null;
  healthCheckIntervalMs: number;
  now: number;
}

function buildOperationalStatus(options: BuildOperationalStatusOptions): NodeOperationalStatus {
  const { configuredMode, attemptedAt, route, eligibleServers, liveServerStats, strategy, healthCheckIntervalMs, now } = options;
  const roles = failoverRolesFor(eligibleServers, liveServerStats, now);
  return projectNodeOperationalStatus({
    now,
    configuredMode,
    attemptedAt,
    route,
    strategy,
    servers: toOperationalServerInputs(eligibleServers, liveServerStats),
    healthCheckIntervalMs,
    primaryServerId: roles.primaryServerId,
    preferredServerId: roles.preferredServerId,
    nextAfter: roles.nextAfter,
  });
}

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30000;

interface PoolAttemptOutcome {
  attempt: AttemptRoute;
  healthCheckIntervalMs: number;
  strategy: NodePoolLoadBalancing;
}

/** The pool branch of an attempt: empty-pool direct fallback, or a live pool probe. */
async function runPoolAttempt(
  nodeConfig: ConfiguredNodeConfig,
  network: NetworkType,
  attemptedAt: string,
  modeConfig: NetworkModeConfig,
  eligibleServers: ConfiguredServerRow[],
): Promise<PoolAttemptOutcome> {
  // The pool projection's strategy/interval are part of configured mode, not
  // of whether a pool attempt actually ran: an empty pool still reports a
  // (necessarily empty) pool projection rather than none.
  // v8 ignore reason: this function only runs when `usePool` is true, which
  // requires `modeConfig` to have come from `buildRuntimeModeConfig` (every
  // non-regtest network) -- that path always sets `poolLoadBalancing` via
  // `getNodeNetworkPoolLoadBalancing`, which itself always returns a network
  // default rather than undefined. Regtest is always forced to singleton
  // mode, so `usePool` can never be true when `poolLoadBalancing` is unset.
  /* v8 ignore next -- see reason above; the `?? 'round_robin'` fallback is unreachable given TypeScript's NetworkType union */
  const fallbackStrategy = (modeConfig.poolLoadBalancing ?? 'round_robin') as NodePoolLoadBalancing;
  if (eligibleServers.length === 0) {
    const attempt = await attemptSingleton(nodeConfig, network, attemptedAt, 'pool_empty');
    return { attempt, healthCheckIntervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS, strategy: fallbackStrategy };
  }

  const pool = await getElectrumPoolForNetwork(network);
  const configSnapshot = pool.getOperationalConfigSnapshot();
  const healthCheckIntervalMs = configSnapshot.healthCheckIntervalMs || DEFAULT_HEALTH_CHECK_INTERVAL_MS;
  /* v8 ignore next -- same unreachable fallback as fallbackStrategy above: modeConfig.poolLoadBalancing is always set whenever usePool is true */
  const strategy = (modeConfig.poolLoadBalancing ?? configSnapshot.loadBalancing) as NodePoolLoadBalancing;
  const attempt = await attemptPool(nodeConfig, network, attemptedAt);
  return { attempt, healthCheckIntervalMs, strategy };
}

/** No configured node row at all: still attempt the environment-default singleton connection. */
async function runNoConfigAttempt(network: NetworkType, attemptedAt: string): Promise<AttemptRoute> {
  const result = await probeDirectSingleton(envConnectionConfig(), network, {
    timeoutMs: NETWORK_STATUS_PROBE_TIMEOUT_MS,
  });
  if (!result.ok || !result.version) {
    return { route: null, version: null, liveServerStats: new Map(), poolStatsForLegacy: null };
  }
  return {
    route: { transport: 'singleton', observedAt: attemptedAt, serverId: null },
    version: result.version,
    blockHeight: result.blockHeight,
    liveServerStats: new Map(),
    poolStatsForLegacy: null,
  };
}

interface StatusProbeOutcome {
  attemptedAt: string;
  attempt: AttemptRoute;
  healthCheckIntervalMs: number;
  strategy: NodePoolLoadBalancing | null;
}

/** The live part of a status read: one pool, direct-singleton, or env-default probe. */
async function runStatusProbe(
  nodeConfig: StatusNodeConfig | null,
  network: NetworkType,
  modeConfig: NetworkModeConfig,
  usePool: boolean,
  eligibleServers: ConfiguredServerRow[],
): Promise<StatusProbeOutcome> {
  const attemptedAt = new Date().toISOString();
  if (usePool && nodeConfig) {
    const outcome = await runPoolAttempt(nodeConfig, network, attemptedAt, modeConfig, eligibleServers);
    return { attemptedAt, ...outcome };
  }
  const attempt = nodeConfig
    ? await attemptSingleton(nodeConfig, network, attemptedAt)
    : await runNoConfigAttempt(network, attemptedAt);
  return { attemptedAt, attempt, healthCheckIntervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS, strategy: null };
}

/**
 * Hash of every configuration input that changes the probe: the network's
 * resolved mode, singleton connection and pool sizing (`modeConfig`), the
 * node_config connection, TLS and proxy fields, its updatedAt, and the
 * eligible servers' identity/routing fields. Server health columns are
 * excluded so health-check writes do not churn the key. Hashed so no proxy
 * credential is held in a cache key.
 */
function statusProbeFingerprint(
  nodeConfig: StatusNodeConfig | null,
  modeConfig: NetworkModeConfig,
  eligibleServers: ConfiguredServerRow[],
): string {
  if (!nodeConfig) return 'env-default';
  const nodeConfigFields = [
    nodeConfig.id,
    nodeConfig.type,
    nodeConfig.host,
    nodeConfig.port,
    nodeConfig.useSsl,
    nodeConfig.allowSelfSignedCert,
    nodeConfig.proxyEnabled,
    nodeConfig.proxyHost,
    nodeConfig.proxyPort,
    nodeConfig.proxyUsername,
    nodeConfig.proxyPassword,
    nodeConfig.updatedAt,
  ];
  const servers = eligibleServers.map((server) => [
    server.id,
    server.host,
    server.port,
    serverUseSsl(server),
    server.priority,
    server.serverUsage,
  ]);
  return createHash('sha256').update(JSON.stringify({ modeConfig, nodeConfigFields, servers })).digest('hex');
}

/** ConfiguredServerRow omits useSsl, but the persisted rows the status read loads carry it. */
function serverUseSsl(server: ConfiguredServerRow): boolean | undefined {
  return (server as ConfiguredServerRow & { useSsl?: boolean }).useSsl;
}

function isProbeConnected(outcome: StatusProbeOutcome): boolean {
  return Boolean(outcome.attempt.route && outcome.attempt.version);
}

/** Connected probes live at most one pool health-check interval; failed ones are re-dialled sooner. */
function statusProbeTtlMs(outcome: StatusProbeOutcome): number {
  return isProbeConnected(outcome)
    ? Math.min(NETWORK_STATUS_SUCCESS_TTL_MS, outcome.healthCheckIntervalMs)
    : NETWORK_STATUS_FAILURE_TTL_MS;
}

export async function getBitcoinNetworkStatus(network: NetworkType = 'mainnet'): Promise<BitcoinNetworkStatusResult> {
  // One immutable configuration snapshot for this attempt: a single
  // repository read feeds mode/strategy, display connection, and the direct
  // singleton connection config. No second read happens anywhere below.
  const [nodeConfig, thresholds] = (await Promise.all([
    nodeConfigRepository.findDefaultWithServers(),
    loadConfirmationThresholds(),
  ])) as [StatusNodeConfig | null, ConfirmationThresholds];
  const modeConfig = nodeConfig ? buildNetworkModeConfig(network, nodeConfig) : getDefaultNetworkModeConfig(network);
  const usePool = shouldUsePool(nodeConfig, modeConfig);
  const displayConnection = getDisplayConnection(nodeConfig, network, modeConfig);
  const eligibleServers = eligibleServersFor(nodeConfig?.servers, network);

  // The probe outcome (not the response) is cached and single-flighted so
  // public status traffic cannot open a node connection per request or feed
  // the pool breaker; thresholds and the freshness projection stay per call.
  const { attemptedAt, attempt, healthCheckIntervalMs, strategy } = await getCachedNetworkStatusProbe(
    network,
    statusProbeFingerprint(nodeConfig, modeConfig, eligibleServers),
    () => runStatusProbe(nodeConfig, network, modeConfig, usePool, eligibleServers),
    statusProbeTtlMs,
  );
  const now = Date.now();

  const configuredMode: 'singleton' | 'pool' = usePool ? 'pool' : 'singleton';
  const operational = buildOperationalStatus({
    configuredMode,
    attemptedAt,
    route: attempt.route,
    eligibleServers,
    liveServerStats: attempt.liveServerStats,
    strategy,
    healthCheckIntervalMs,
    now,
  });

  const legacyPool = buildLegacyPoolStatus(nodeConfig, network, modeConfig, usePool, attempt.poolStatsForLegacy);
  const explorerUrl = getExplorerUrl(nodeConfig, network);

  if (!attempt.route || !attempt.version) {
    return {
      connected: false,
      error: `Unable to read ${network} Electrum server status`,
      network,
      explorerUrl,
      pool: legacyPool,
      operational,
    };
  }

  return {
    connected: true,
    server: attempt.version.server,
    protocol: attempt.version.protocol,
    blockHeight: attempt.blockHeight,
    network,
    host: displayConnection.host,
    useSsl: displayConnection.useSsl,
    explorerUrl,
    confirmationThreshold: thresholds.confirmationThreshold,
    deepConfirmationThreshold: thresholds.deepConfirmationThreshold,
    pool: legacyPool,
    operational,
  };
}
