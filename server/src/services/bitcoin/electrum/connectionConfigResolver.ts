import config from "../../../config";
import { nodeConfigRepository } from "../../../repositories";
import {
  getNodeNetworkDefaults,
  getNodeNetworkSingletonSsl,
  projectNodeProxyConfig,
  readNodeNetworkBoolean,
  readNodeNetworkNonEmptyString,
  readNodeNetworkPositiveInteger,
  type NodeNetworkConfigSource,
} from "@sanctuary/shared/constants/nodeConfig";
import type { ElectrumConfig, ProxyConfig, BitcoinNetwork } from "./types";

interface PersistedNodeConfig {
  type: string;
  host: string;
  port: number;
  useSsl: boolean;
  allowSelfSignedCert: boolean | null;
  mainnetSingletonHost: string | null;
  mainnetSingletonPort: number | null;
  mainnetSingletonSsl: boolean | null;
  testnet3SingletonHost: string | null;
  testnet3SingletonPort: number | null;
  testnet3SingletonSsl: boolean | null;
  testnet4SingletonHost: string | null;
  testnet4SingletonPort: number | null;
  testnet4SingletonSsl: boolean | null;
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
  protocol: "tcp" | "ssl";
  allowSelfSignedCert: boolean;
  proxy?: ProxyConfig;
}

export function proxyConfigFromNodeConfig(
  nodeConfig: PersistedNodeConfig,
): ProxyConfig | undefined {
  return projectNodeProxyConfig(
    nodeConfig as unknown as NodeNetworkConfigSource,
  ) ?? undefined;
}

export function mainnetConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  const source = nodeConfig as unknown as NodeNetworkConfigSource;
  return {
    host:
      readNodeNetworkNonEmptyString(source, "mainnet", "singletonHost") ||
      nodeConfig.host,
    port:
      readNodeNetworkPositiveInteger(source, "mainnet", "singletonPort") ||
      nodeConfig.port,
    protocol:
      (readNodeNetworkBoolean(source, "mainnet", "singletonSsl") ??
        nodeConfig.useSsl)
        ? "ssl"
        : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function testnet3ConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  const source = nodeConfig as unknown as NodeNetworkConfigSource;
  const defaults = getNodeNetworkDefaults("testnet3");
  return {
    host:
      readNodeNetworkNonEmptyString(source, "testnet3", "singletonHost") ||
      defaults.singletonHost,
    port:
      readNodeNetworkPositiveInteger(source, "testnet3", "singletonPort") ||
      defaults.singletonPort,
    protocol:
      getNodeNetworkSingletonSsl(source, "testnet3") ? "ssl" : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function testnet4ConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  const source = nodeConfig as unknown as NodeNetworkConfigSource;
  const defaults = getNodeNetworkDefaults("testnet4");
  return {
    host:
      readNodeNetworkNonEmptyString(source, "testnet4", "singletonHost") ??
      defaults.singletonHost,
    port:
      readNodeNetworkPositiveInteger(source, "testnet4", "singletonPort") ||
      defaults.singletonPort,
    protocol:
      getNodeNetworkSingletonSsl(source, "testnet4") ? "ssl" : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function signetConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  const source = nodeConfig as unknown as NodeNetworkConfigSource;
  const defaults = getNodeNetworkDefaults("signet");
  return {
    host:
      readNodeNetworkNonEmptyString(source, "signet", "singletonHost") ||
      defaults.singletonHost,
    port:
      readNodeNetworkPositiveInteger(source, "signet", "singletonPort") ||
      defaults.singletonPort,
    protocol: getNodeNetworkSingletonSsl(source, "signet") ? "ssl" : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function legacyConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  return {
    host: nodeConfig.host,
    port: nodeConfig.port,
    protocol: nodeConfig.useSsl ? "ssl" : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function explicitConnectionConfig(
  explicitConfig: ElectrumConfig,
): ResolvedConnectionConfig {
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
  network: BitcoinNetwork,
): ResolvedConnectionConfig {
  switch (network) {
    case "mainnet":
      return mainnetConnectionConfig(nodeConfig);
    case "testnet3":
      return testnet3ConnectionConfig(nodeConfig);
    case "testnet4":
      return testnet4ConnectionConfig(nodeConfig);
    case "signet":
      return signetConnectionConfig(nodeConfig);
    case "regtest":
    default:
      return legacyConnectionConfig(nodeConfig);
  }
}

export async function resolveElectrumConnectionConfig(
  explicitConfig: ElectrumConfig | null,
  network: BitcoinNetwork,
): Promise<ResolvedConnectionConfig> {
  if (explicitConfig) {
    return explicitConnectionConfig(explicitConfig);
  }

  const nodeConfig = await nodeConfigRepository.findDefault();
  return nodeConfig?.type === "electrum"
    ? dbConnectionConfig(nodeConfig, network)
    : envConnectionConfig();
}
