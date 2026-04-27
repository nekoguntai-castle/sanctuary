import config from '../../../config';
import { nodeConfigRepository } from '../../../repositories';
import type {
  ElectrumConfig,
  ProxyConfig,
  BitcoinNetwork,
} from './types';

interface PersistedNodeConfig {
  type: string;
  host: string;
  port: number;
  useSsl: boolean;
  allowSelfSignedCert: boolean | null;
  mainnetSingletonHost: string | null;
  mainnetSingletonPort: number | null;
  mainnetSingletonSsl: boolean | null;
  testnetSingletonHost: string | null;
  testnetSingletonPort: number | null;
  testnetSingletonSsl: boolean | null;
  signetSingletonHost: string | null;
  signetSingletonPort: number | null;
  signetSingletonSsl: boolean | null;
  proxyEnabled: boolean | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
}

export interface ResolvedConnectionConfig {
  host: string;
  port: number;
  protocol: 'tcp' | 'ssl';
  allowSelfSignedCert: boolean;
  proxy?: ProxyConfig;
}

export function proxyConfigFromNodeConfig(nodeConfig: PersistedNodeConfig): ProxyConfig | undefined {
  if (!nodeConfig.proxyEnabled || !nodeConfig.proxyHost || !nodeConfig.proxyPort) {
    return undefined;
  }

  return {
    enabled: true,
    host: nodeConfig.proxyHost,
    port: nodeConfig.proxyPort,
    username: nodeConfig.proxyUsername ?? undefined,
    password: nodeConfig.proxyPassword ?? undefined,
  };
}

export function mainnetConnectionConfig(nodeConfig: PersistedNodeConfig): ResolvedConnectionConfig {
  return {
    host: nodeConfig.mainnetSingletonHost || nodeConfig.host,
    port: nodeConfig.mainnetSingletonPort || nodeConfig.port,
    protocol: (nodeConfig.mainnetSingletonSsl ?? nodeConfig.useSsl) ? 'ssl' : 'tcp',
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function testnetConnectionConfig(nodeConfig: PersistedNodeConfig): ResolvedConnectionConfig {
  return {
    host: nodeConfig.testnetSingletonHost || config.bitcoin.electrum.host,
    port: nodeConfig.testnetSingletonPort || 51001,
    protocol: nodeConfig.testnetSingletonSsl ? 'ssl' : 'tcp',
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function signetConnectionConfig(nodeConfig: PersistedNodeConfig): ResolvedConnectionConfig {
  return {
    host: nodeConfig.signetSingletonHost || config.bitcoin.electrum.host,
    port: nodeConfig.signetSingletonPort || 60001,
    protocol: nodeConfig.signetSingletonSsl ? 'ssl' : 'tcp',
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function legacyConnectionConfig(nodeConfig: PersistedNodeConfig): ResolvedConnectionConfig {
  return {
    host: nodeConfig.host,
    port: nodeConfig.port,
    protocol: nodeConfig.useSsl ? 'ssl' : 'tcp',
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function explicitConnectionConfig(explicitConfig: ElectrumConfig): ResolvedConnectionConfig {
  return {
    host: explicitConfig.host,
    port: explicitConfig.port,
    protocol: explicitConfig.protocol,
    allowSelfSignedCert: explicitConfig.allowSelfSignedCert ?? false,
    proxy: explicitConfig.proxy,
  };
}

export function envConnectionConfig(): ResolvedConnectionConfig {
  return {
    host: config.bitcoin.electrum.host,
    port: config.bitcoin.electrum.port,
    protocol: config.bitcoin.electrum.protocol,
    allowSelfSignedCert: false,
  };
}

export function dbConnectionConfig(
  nodeConfig: PersistedNodeConfig,
  network: BitcoinNetwork
): ResolvedConnectionConfig {
  switch (network) {
    case 'mainnet':
      return mainnetConnectionConfig(nodeConfig);
    case 'testnet':
      return testnetConnectionConfig(nodeConfig);
    case 'signet':
      return signetConnectionConfig(nodeConfig);
    case 'regtest':
    default:
      return legacyConnectionConfig(nodeConfig);
  }
}

export async function resolveElectrumConnectionConfig(
  explicitConfig: ElectrumConfig | null,
  network: BitcoinNetwork
): Promise<ResolvedConnectionConfig> {
  if (explicitConfig) {
    return explicitConnectionConfig(explicitConfig);
  }

  const nodeConfig = await nodeConfigRepository.findDefault();
  return nodeConfig?.type === 'electrum'
    ? dbConnectionConfig(nodeConfig, network)
    : envConnectionConfig();
}
