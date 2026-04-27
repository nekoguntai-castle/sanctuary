import { nodeConfigRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { NetworkType } from './electrumPool';
import type { NetworkModeConfig } from './nodeClient';

const log = createLogger('BITCOIN:SVC_NODE_CLIENT_CONFIG');

interface PersistedNodeConfig {
  host: string;
  port: number;
  useSsl: boolean;
  mainnetMode: string | null;
  mainnetSingletonHost: string | null;
  mainnetSingletonPort: number | null;
  mainnetSingletonSsl: boolean | null;
  mainnetPoolMin: number | null;
  mainnetPoolMax: number | null;
  mainnetPoolLoadBalancing: string | null;
  testnetEnabled: boolean | null;
  testnetMode: string | null;
  testnetSingletonHost: string | null;
  testnetSingletonPort: number | null;
  testnetSingletonSsl: boolean | null;
  testnetPoolMin: number | null;
  testnetPoolMax: number | null;
  testnetPoolLoadBalancing: string | null;
  signetEnabled: boolean | null;
  signetMode: string | null;
  signetSingletonHost: string | null;
  signetSingletonPort: number | null;
  signetSingletonSsl: boolean | null;
  signetPoolMin: number | null;
  signetPoolMax: number | null;
  signetPoolLoadBalancing: string | null;
}

export function getDefaultNetworkModeConfig(network: NetworkType): NetworkModeConfig {
  return { mode: network === 'mainnet' ? 'pool' : 'singleton' };
}

export function getPoolLoadBalancing(
  value: string | null | undefined,
  fallback: NetworkModeConfig['poolLoadBalancing']
): NetworkModeConfig['poolLoadBalancing'] {
  return (value as NetworkModeConfig['poolLoadBalancing']) ?? fallback;
}

export function getMainnetModeConfig(nodeConfig: PersistedNodeConfig): NetworkModeConfig {
  return {
    mode: (nodeConfig.mainnetMode as 'singleton' | 'pool') || 'pool',
    singletonHost: nodeConfig.mainnetSingletonHost ?? undefined,
    singletonPort: nodeConfig.mainnetSingletonPort ?? undefined,
    singletonSsl: nodeConfig.mainnetSingletonSsl ?? true,
    poolMin: nodeConfig.mainnetPoolMin ?? 1,
    poolMax: nodeConfig.mainnetPoolMax ?? 5,
    poolLoadBalancing: getPoolLoadBalancing(nodeConfig.mainnetPoolLoadBalancing, 'round_robin'),
  };
}

export function assertNetworkEnabled(enabled: boolean | null | undefined, label: string): void {
  if (!enabled) {
    throw new Error(`${label} is not enabled`);
  }
}

export function getTestnetModeConfig(nodeConfig: PersistedNodeConfig): NetworkModeConfig {
  assertNetworkEnabled(nodeConfig.testnetEnabled, 'Testnet');
  return {
    mode: (nodeConfig.testnetMode as 'singleton' | 'pool') || 'singleton',
    singletonHost: nodeConfig.testnetSingletonHost ?? undefined,
    singletonPort: nodeConfig.testnetSingletonPort ?? undefined,
    singletonSsl: nodeConfig.testnetSingletonSsl ?? true,
    poolMin: nodeConfig.testnetPoolMin ?? 1,
    poolMax: nodeConfig.testnetPoolMax ?? 3,
    poolLoadBalancing: getPoolLoadBalancing(nodeConfig.testnetPoolLoadBalancing, 'round_robin'),
  };
}

export function getSignetModeConfig(nodeConfig: PersistedNodeConfig): NetworkModeConfig {
  assertNetworkEnabled(nodeConfig.signetEnabled, 'Signet');
  return {
    mode: (nodeConfig.signetMode as 'singleton' | 'pool') || 'singleton',
    singletonHost: nodeConfig.signetSingletonHost ?? undefined,
    singletonPort: nodeConfig.signetSingletonPort ?? undefined,
    singletonSsl: nodeConfig.signetSingletonSsl ?? true,
    poolMin: nodeConfig.signetPoolMin ?? 1,
    poolMax: nodeConfig.signetPoolMax ?? 3,
    poolLoadBalancing: getPoolLoadBalancing(nodeConfig.signetPoolLoadBalancing, 'round_robin'),
  };
}

export function getRegtestModeConfig(nodeConfig: PersistedNodeConfig): NetworkModeConfig {
  return {
    mode: 'singleton',
    singletonHost: nodeConfig.host,
    singletonPort: nodeConfig.port,
    singletonSsl: nodeConfig.useSsl,
  };
}

export function buildNetworkModeConfig(
  network: NetworkType,
  nodeConfig: PersistedNodeConfig
): NetworkModeConfig {
  switch (network) {
    case 'mainnet':
      return getMainnetModeConfig(nodeConfig);
    case 'testnet':
      return getTestnetModeConfig(nodeConfig);
    case 'signet':
      return getSignetModeConfig(nodeConfig);
    case 'regtest':
      return getRegtestModeConfig(nodeConfig);
    default:
      return { mode: 'pool' };
  }
}

export async function getNetworkModeConfig(network: NetworkType): Promise<NetworkModeConfig> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefault();
    return nodeConfig
      ? buildNetworkModeConfig(network, nodeConfig)
      : getDefaultNetworkModeConfig(network);
  } catch (error) {
    log.warn(`Failed to load network mode config for ${network}`, { error: getErrorMessage(error) });
    return getDefaultNetworkModeConfig(network);
  }
}
