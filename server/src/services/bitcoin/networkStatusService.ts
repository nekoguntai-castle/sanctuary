import { getNodeClient, type NetworkModeConfig } from './nodeClient';
import { getElectrumPoolForNetwork, type NetworkType } from './electrumPool';
import type { PooledConnectionHandle } from './electrumPool/types';
import type { PoolStats as ElectrumPoolStats } from './electrumPool/types';
import { DEFAULT_CONFIRMATION_THRESHOLD, DEFAULT_DEEP_CONFIRMATION_THRESHOLD } from '../../constants';
import { systemSettingRepository } from '../../repositories';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import { createLogger } from '../../utils/logger';
import { SystemSettingSchemas } from '../../utils/safeJson';
import { getNetworkModeConfig } from './nodeClientConfig';

const log = createLogger('BITCOIN_NETWORK:SVC');

interface ConfiguredServer {
  id: string;
  label: string;
  host: string;
  port: number;
  network: string;
  enabled: boolean;
  priority?: number | null;
  lastHealthCheck?: Date | string | null;
  isHealthy?: boolean | null;
}

interface StatusNodeConfig {
  id: string;
  type: string;
  host: string;
  port: number;
  useSsl: boolean;
  explorerUrl: string | null;
  testnet3ExplorerUrl?: string | null;
  testnet4ExplorerUrl?: string | null;
  signetExplorerUrl?: string | null;
  servers?: ConfiguredServer[];
}

export interface BitcoinNetworkStatus {
  connected: true;
  server: string;
  protocol: string;
  blockHeight?: number;
  network: NetworkType;
  host?: string;
  useSsl?: boolean;
  explorerUrl: string;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  pool: {
    enabled: boolean;
    minConnections: number;
    maxConnections: number;
    configuredMin?: number;
    configuredMax?: number;
    stats: ElectrumPoolStats | null;
  } | null;
}

const NETWORK_DEFAULTS: Record<NetworkType, { host: string; port: number; useSsl: boolean }> = {
  mainnet: { host: 'electrum.blockstream.info', port: 50002, useSsl: true },
  testnet3: { host: 'electrum.blockstream.info', port: 60002, useSsl: true },
  testnet4: { host: '', port: 60002, useSsl: true },
  signet: { host: 'electrum.mutinynet.com', port: 50002, useSsl: true },
  regtest: { host: 'localhost', port: 50001, useSsl: false },
};

const DEFAULT_EXPLORER_URLS: Record<NetworkType, string> = {
  mainnet: 'https://mempool.space',
  testnet3: 'https://mempool.space/testnet',
  testnet4: 'https://mempool.space/testnet4',
  signet: 'https://mempool.space/signet',
  regtest: 'https://mempool.space',
};

const EXPLORER_URL_FIELDS: Record<NetworkType, keyof StatusNodeConfig> = {
  mainnet: 'explorerUrl',
  testnet3: 'testnet3ExplorerUrl',
  testnet4: 'testnet4ExplorerUrl',
  signet: 'signetExplorerUrl',
  regtest: 'explorerUrl',
};

function getExplorerUrl(
  nodeConfig: StatusNodeConfig | null,
  network: NetworkType,
): string {
  const value = nodeConfig?.[EXPLORER_URL_FIELDS[network]];
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_EXPLORER_URLS[network];
}

function getConfiguredServers(
  nodeConfig: StatusNodeConfig | null,
  network: NetworkType,
): ConfiguredServer[] {
  return (nodeConfig?.servers ?? [])
    .filter((server) => server.enabled && server.network === network)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

function toConfiguredServerStat(server: ConfiguredServer): ElectrumPoolStats['servers'][number] {
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
  };
}

function configuredServerStats(
  nodeConfig: StatusNodeConfig | null,
  network: NetworkType,
): ElectrumPoolStats | null {
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

function getMainnetDisplayConnection(
  nodeConfig: StatusNodeConfig | null,
  modeConfig: NetworkModeConfig,
) {
  const defaults = NETWORK_DEFAULTS.mainnet;

  return {
    host: modeConfig.singletonHost || nodeConfig?.host || defaults.host,
    port: modeConfig.singletonPort || nodeConfig?.port || defaults.port,
    useSsl: modeConfig.singletonSsl ?? nodeConfig?.useSsl ?? defaults.useSsl,
  };
}

function getDefaultDisplayConnection(
  network: NetworkType,
  modeConfig: NetworkModeConfig,
) {
  const defaults = NETWORK_DEFAULTS[network];

  return {
    host: modeConfig.singletonHost || defaults.host,
    port: modeConfig.singletonPort || defaults.port,
    useSsl: modeConfig.singletonSsl ?? defaults.useSsl,
  };
}

function getDisplayConnection(
  nodeConfig: StatusNodeConfig | null,
  network: NetworkType,
  modeConfig: NetworkModeConfig,
) {
  if (network === 'mainnet') {
    return getMainnetDisplayConnection(nodeConfig, modeConfig);
  }

  return getDefaultDisplayConnection(network, modeConfig);
}

async function checkPoolStatus(network: NetworkType): Promise<{
  version: { server: string; protocol: string } | null;
  blockHeight?: number;
  poolStats: ElectrumPoolStats | null;
}> {
  let poolHandle: PooledConnectionHandle | null = null;
  const pool = await getElectrumPoolForNetwork(network);
  const poolStats = pool.isPoolInitialized() ? pool.getPoolStats() : null;

  try {
    if (poolStats && (poolStats.idleConnections > 0 || poolStats.activeConnections > 0)) {
      poolHandle = await pool.acquire({ purpose: 'status', timeoutMs: 5000 });
      const [version, blockHeight] = await Promise.all([
        poolHandle.client.getServerVersion(),
        poolHandle.client.getBlockHeight(),
      ]);
      return { version, blockHeight, poolStats };
    }
  } finally {
    if (poolHandle) {
      poolHandle.release();
    }
  }

  return { version: null, poolStats };
}

export async function getBitcoinNetworkStatus(
  network: NetworkType = 'mainnet',
): Promise<BitcoinNetworkStatus> {
  const nodeConfig = await nodeConfigRepository.findDefaultWithServers() as StatusNodeConfig | null;
  const modeConfig = await getNetworkModeConfig(network);

  let version: { server: string; protocol: string } | null = null;
  let blockHeight: number | undefined;
  let poolStats: ElectrumPoolStats | null = null;
  const usePool = nodeConfig?.type === 'electrum' && modeConfig.mode === 'pool';
  const displayConnection = getDisplayConnection(nodeConfig, network, modeConfig);

  if (usePool) {
    try {
      const poolStatus = await checkPoolStatus(network);
      version = poolStatus.version;
      blockHeight = poolStatus.blockHeight;
      poolStats = poolStatus.poolStats;
    } catch (poolError) {
      log.debug('Pool status check failed, falling back to singleton', { error: String(poolError) });
    }
  }

  if (!version) {
    const client = await getNodeClient(network);
    const [ver, height] = await Promise.all([
      client.getServerVersion(),
      client.getBlockHeight(),
    ]);
    version = ver;
    blockHeight = height;
  }

  if (!version) {
    throw new Error(`Unable to read ${network} Electrum server version`);
  }

  const [confirmationThreshold, deepConfirmationThreshold] = await Promise.all([
    systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, DEFAULT_CONFIRMATION_THRESHOLD),
    systemSettingRepository.getParsed('deepConfirmationThreshold', SystemSettingSchemas.number, DEFAULT_DEEP_CONFIRMATION_THRESHOLD),
  ]);

  return {
    connected: true,
    server: version.server,
    protocol: version.protocol,
    blockHeight,
    network,
    host: displayConnection.host,
    useSsl: displayConnection.useSsl,
    explorerUrl: getExplorerUrl(nodeConfig, network),
    confirmationThreshold,
    deepConfirmationThreshold,
    pool: nodeConfig?.type === 'electrum' ? {
      enabled: usePool,
      minConnections: modeConfig.poolMin ?? 1,
      maxConnections: modeConfig.poolMax ?? 5,
      configuredMin: modeConfig.poolMin,
      configuredMax: modeConfig.poolMax,
      stats: poolStats && poolStats.servers.length > 0
        ? poolStats
        : configuredServerStats(nodeConfig, network) ?? poolStats,
    } : null,
  };
}
