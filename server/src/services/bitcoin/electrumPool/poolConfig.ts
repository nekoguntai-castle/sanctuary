import { nodeConfigRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { createLogger } from '../../../utils/logger';
import {
  projectNodeProxyConfig,
  isNodePoolLoadBalancing,
  readNodeNetworkPositiveInteger,
  readNodeNetworkString,
  type NodeNetworkConfigSource,
} from '@sanctuary/shared/constants/nodeConfig';
import type {
  ElectrumPoolFeatureScope,
  ElectrumPoolConfig,
  LoadBalancingStrategy,
  NetworkType,
  ProxyConfig,
  ServerConfig,
} from './types';
import {
  normalizeServerUsage,
  parseSilentPaymentVersionsValue,
  resolveFeaturePoolUsage,
  serverSatisfiesRequiredFeatures,
  serverUsageMatchesPool,
} from '../electrum/capabilities';
import type {
  ElectrumFeature,
  ElectrumServerUsage,
} from '../electrum/capabilities';

const log = createLogger('ELECTRUM_POOL:SVC_CONFIG');

interface PersistedServer {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  serverUsage?: string | null;
  supportsVerbose: boolean | null;
  silentPaymentVersions?: unknown;
  supportsSilentPaymentsV0?: boolean | null;
  capabilityProfileKey?: string | null;
  lastCapabilityCheck?: Date | null;
  lastCapabilityError?: string | null;
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
  testnet3PoolMin: number | null;
  testnet3PoolMax: number | null;
  testnet3PoolLoadBalancing: string | null;
  testnet4PoolMin: number | null;
  testnet4PoolMax: number | null;
  testnet4PoolLoadBalancing: string | null;
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

interface BuildNetworkServersOptions {
  requiredFeatures: ElectrumFeature[];
  serverUsage: ElectrumServerUsage;
  capabilityStaleAfterMs?: number;
}

function serverMatchesNetwork(server: PersistedServer, network: NetworkType): boolean {
  return server.enabled && server.network === network;
}

function serverMatchesFeatureScope(
  server: PersistedServer,
  options: BuildNetworkServersOptions,
): boolean {
  return serverUsageMatchesPool(server.serverUsage, options.serverUsage) &&
    serverSatisfiesRequiredFeatures(
      {
        supportsVerbose: server.supportsVerbose,
        supportsSilentPaymentsV0: server.supportsSilentPaymentsV0,
        lastCapabilityCheck: server.lastCapabilityCheck,
        lastCapabilityError: server.lastCapabilityError,
      },
      options.requiredFeatures,
      { capabilityStaleAfterMs: options.capabilityStaleAfterMs },
    );
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
    network: server.network as NetworkType,
    serverUsage: normalizeServerUsage(server.serverUsage),
    supportsVerbose: server.supportsVerbose,
    supportsSilentPaymentsV0: server.supportsSilentPaymentsV0,
    silentPaymentVersions: parseSilentPaymentVersionsValue(server.silentPaymentVersions),
    capabilityProfileKey: server.capabilityProfileKey ?? null,
    lastCapabilityCheck: server.lastCapabilityCheck ?? null,
    lastCapabilityError: server.lastCapabilityError ?? null,
  };
}

function buildNetworkServers(
  nodeConfig: PersistedPoolConfig,
  network: NetworkType,
  options: BuildNetworkServersOptions
): ServerConfig[] {
  return nodeConfig.servers
    .filter(server => serverMatchesNetwork(server, network))
    .filter(server => serverMatchesFeatureScope(server, options))
    /* v8 ignore start -- deterministic server priority comparator branch is a V8 coverage artifact */
    .sort((a, b) => a.priority - b.priority)
    /* v8 ignore stop */
    .map(toServerConfig);
}

function proxyConfigFromNodeConfig(nodeConfig: PersistedPoolConfig): ProxyConfig | null {
  return projectNodeProxyConfig(
    nodeConfig as unknown as NodeNetworkConfigSource,
  );
}

function optionalLoadBalancing(value: string | null | undefined): LoadBalancingStrategy | undefined {
  return isNodePoolLoadBalancing(value)
    ? value as LoadBalancingStrategy
    : undefined;
}

interface NullablePoolOverrides {
  minConnections: number | null;
  maxConnections: number | null;
  loadBalancing: LoadBalancingStrategy | undefined;
}

function compactPoolOverrides(
  values: NullablePoolOverrides
): Partial<Pick<ElectrumPoolConfig, 'minConnections' | 'maxConnections' | 'loadBalancing'>> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined)
  ) as Partial<Pick<ElectrumPoolConfig, 'minConnections' | 'maxConnections' | 'loadBalancing'>>;
}

function getNetworkPoolOverrides(
  nodeConfig: PersistedPoolConfig,
  network: NetworkType
): Partial<Pick<ElectrumPoolConfig, 'minConnections' | 'maxConnections' | 'loadBalancing'>> {
  const source = nodeConfig as unknown as NodeNetworkConfigSource;
  return compactPoolOverrides({
    minConnections:
      readNodeNetworkPositiveInteger(source, network, 'poolMin') ?? null,
    maxConnections:
      readNodeNetworkPositiveInteger(source, network, 'poolMax') ?? null,
    loadBalancing: optionalLoadBalancing(
      readNodeNetworkString(source, network, 'poolLoadBalancing'),
    ),
  });
}

function poolConfigFromNodeConfig(
  nodeConfig: PersistedPoolConfig
): Partial<ElectrumPoolConfig> {
  const config: Partial<ElectrumPoolConfig> = {
    ...compactPoolOverrides({
      minConnections: nodeConfig.poolMinConnections,
      maxConnections: nodeConfig.poolMaxConnections,
      loadBalancing: optionalLoadBalancing(nodeConfig.poolLoadBalancing),
    }),
  };

  if (typeof nodeConfig.poolEnabled === 'boolean') {
    config.enabled = nodeConfig.poolEnabled;
  }

  return config;
}

function scopedPoolConfigFromNodeConfig(
  nodeConfig: PersistedPoolConfig,
  network: NetworkType
): Partial<ElectrumPoolConfig> {
  return {
    ...poolConfigFromNodeConfig(nodeConfig),
    ...getNetworkPoolOverrides(nodeConfig, network),
  };
}

/**
 * Load pool configuration from database for a specific network.
 * Returns empty config when database settings are unavailable.
 */
export async function loadPoolConfigFromDatabase(network?: NetworkType): Promise<{
  config: Partial<ElectrumPoolConfig>;
  servers: ServerConfig[];
  proxy: ProxyConfig | null;
}>;
export async function loadPoolConfigFromDatabase(
  network: NetworkType,
  featureScope: ElectrumPoolFeatureScope,
): Promise<{
  config: Partial<ElectrumPoolConfig>;
  servers: ServerConfig[];
  proxy: ProxyConfig | null;
}>;
export async function loadPoolConfigFromDatabase(
  network: NetworkType = 'mainnet',
  featureScope: ElectrumPoolFeatureScope = {},
): Promise<{
  config: Partial<ElectrumPoolConfig>;
  servers: ServerConfig[];
  proxy: ProxyConfig | null;
}> {
  const requiredFeatures = featureScope.requiredFeatures ?? [];
  const serverUsage = resolveFeaturePoolUsage(
    requiredFeatures,
    featureScope.serverUsage,
  );
  try {
    const nodeConfig = await nodeConfigRepository.findDefaultWithServers();

    if (nodeConfig && nodeConfig.type === 'electrum') {
      return {
        config: scopedPoolConfigFromNodeConfig(nodeConfig, network),
        servers: buildNetworkServers(nodeConfig, network, {
          requiredFeatures,
          serverUsage,
          capabilityStaleAfterMs: featureScope.capabilityStaleAfterMs,
        }),
        proxy: proxyConfigFromNodeConfig(nodeConfig),
      };
    }
  } catch (error) {
    log.warn('Failed to load pool config from database, using defaults', { error: getErrorMessage(error), network });
  }

  return { config: {}, servers: [], proxy: null };
}
