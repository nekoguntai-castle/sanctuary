import { nodeConfigRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { createLogger } from '../../../utils/logger';
import type {
  ElectrumPoolConfig,
  LoadBalancingStrategy,
  NetworkType,
  ProxyConfig,
  ServerConfig,
} from './types';

const log = createLogger('ELECTRUM_POOL:SVC_CONFIG');

interface PersistedServer {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  supportsVerbose: boolean | null;
  network: string;
}

interface PersistedPoolConfig {
  type: string;
  poolEnabled: boolean;
  poolMinConnections: number;
  poolMaxConnections: number;
  poolLoadBalancing: string;
  mainnetPoolMin: number | null;
  mainnetPoolMax: number | null;
  mainnetPoolLoadBalancing: string | null;
  testnetPoolMin: number | null;
  testnetPoolMax: number | null;
  testnetPoolLoadBalancing: string | null;
  signetPoolMin: number | null;
  signetPoolMax: number | null;
  signetPoolLoadBalancing: string | null;
  proxyEnabled: boolean | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
  servers: PersistedServer[];
}

function serverMatchesNetwork(server: PersistedServer, network: NetworkType): boolean {
  return server.enabled && server.network === network;
}

function toServerConfig(server: PersistedServer): ServerConfig {
  return {
    id: server.id,
    label: server.label,
    host: server.host,
    port: server.port,
    useSsl: server.useSsl,
    priority: server.priority,
    enabled: server.enabled,
    supportsVerbose: server.supportsVerbose,
  };
}

function buildNetworkServers(
  nodeConfig: PersistedPoolConfig,
  network: NetworkType
): ServerConfig[] {
  return nodeConfig.servers
    .filter(server => serverMatchesNetwork(server, network))
    /* v8 ignore start -- deterministic server priority comparator branch is a V8 coverage artifact */
    .sort((a, b) => a.priority - b.priority)
    /* v8 ignore stop */
    .map(toServerConfig);
}

function proxyConfigFromNodeConfig(nodeConfig: PersistedPoolConfig): ProxyConfig | null {
  if (!nodeConfig.proxyEnabled || !nodeConfig.proxyHost || !nodeConfig.proxyPort) {
    return null;
  }

  return {
    enabled: true,
    host: nodeConfig.proxyHost,
    port: nodeConfig.proxyPort,
    username: nodeConfig.proxyUsername ?? undefined,
    password: nodeConfig.proxyPassword ?? undefined,
  };
}

function optionalLoadBalancing(value: string | null | undefined): LoadBalancingStrategy | undefined {
  return value ? value as LoadBalancingStrategy : undefined;
}

interface NullablePoolOverrides {
  minConnections: number | null;
  maxConnections: number | null;
  loadBalancing: LoadBalancingStrategy | undefined;
}

function compactPoolOverrides(
  values: NullablePoolOverrides | undefined
): Partial<Pick<ElectrumPoolConfig, 'minConnections' | 'maxConnections' | 'loadBalancing'>> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([, value]) => value !== null && value !== undefined)
  ) as Partial<Pick<ElectrumPoolConfig, 'minConnections' | 'maxConnections' | 'loadBalancing'>>;
}

function getNetworkPoolOverrides(
  nodeConfig: PersistedPoolConfig,
  network: NetworkType
): Partial<Pick<ElectrumPoolConfig, 'minConnections' | 'maxConnections' | 'loadBalancing'>> {
  const overrides: Partial<Record<NetworkType, NullablePoolOverrides>> = {
    mainnet: {
      minConnections: nodeConfig.mainnetPoolMin,
      maxConnections: nodeConfig.mainnetPoolMax,
      loadBalancing: optionalLoadBalancing(nodeConfig.mainnetPoolLoadBalancing),
    },
    testnet: {
      minConnections: nodeConfig.testnetPoolMin,
      maxConnections: nodeConfig.testnetPoolMax,
      loadBalancing: optionalLoadBalancing(nodeConfig.testnetPoolLoadBalancing),
    },
    signet: {
      minConnections: nodeConfig.signetPoolMin,
      maxConnections: nodeConfig.signetPoolMax,
      loadBalancing: optionalLoadBalancing(nodeConfig.signetPoolLoadBalancing),
    },
  };

  return compactPoolOverrides(overrides[network]);
}

function poolConfigFromNodeConfig(
  nodeConfig: PersistedPoolConfig,
  network: NetworkType
): Partial<ElectrumPoolConfig> {
  return {
    enabled: nodeConfig.poolEnabled,
    minConnections: nodeConfig.poolMinConnections,
    maxConnections: nodeConfig.poolMaxConnections,
    loadBalancing: nodeConfig.poolLoadBalancing as LoadBalancingStrategy,
    ...getNetworkPoolOverrides(nodeConfig, network),
  };
}

/**
 * Load pool configuration from database for a specific network.
 * Returns empty config when database settings are unavailable.
 */
export async function loadPoolConfigFromDatabase(network: NetworkType = 'mainnet'): Promise<{
  config: Partial<ElectrumPoolConfig>;
  servers: ServerConfig[];
  proxy: ProxyConfig | null;
}> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefaultWithServers();

    if (nodeConfig && nodeConfig.type === 'electrum') {
      return {
        config: poolConfigFromNodeConfig(nodeConfig, network),
        servers: buildNetworkServers(nodeConfig, network),
        proxy: proxyConfigFromNodeConfig(nodeConfig),
      };
    }
  } catch (error) {
    log.warn('Failed to load pool config from database, using defaults', { error: getErrorMessage(error), network });
  }

  return { config: {}, servers: [], proxy: null };
}
