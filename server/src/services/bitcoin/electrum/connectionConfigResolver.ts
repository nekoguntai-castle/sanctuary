import config from "../../../config";
import { nodeConfigRepository } from "../../../repositories";
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

const TESTNET_DEFAULT_HOST = "electrum.blockstream.info";
const TESTNET_DEFAULT_PORT = 60002;
const SIGNET_DEFAULT_HOST = "electrum.mutinynet.com";
const SIGNET_DEFAULT_PORT = 50002;

export function proxyConfigFromNodeConfig(
  nodeConfig: PersistedNodeConfig,
): ProxyConfig | undefined {
  if (
    !nodeConfig.proxyEnabled ||
    !nodeConfig.proxyHost ||
    !nodeConfig.proxyPort
  ) {
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

export function mainnetConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  return {
    host: nodeConfig.mainnetSingletonHost || nodeConfig.host,
    port: nodeConfig.mainnetSingletonPort || nodeConfig.port,
    protocol:
      (nodeConfig.mainnetSingletonSsl ?? nodeConfig.useSsl) ? "ssl" : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function testnet3ConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  return {
    host:
      nodeConfig.testnet3SingletonHost ||
      nodeConfig.testnetSingletonHost ||
      TESTNET_DEFAULT_HOST,
    port:
      nodeConfig.testnet3SingletonPort ||
      nodeConfig.testnetSingletonPort ||
      TESTNET_DEFAULT_PORT,
    protocol:
      (nodeConfig.testnet3SingletonSsl ?? nodeConfig.testnetSingletonSsl ?? true)
        ? "ssl"
        : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function testnet4ConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  return {
    host: nodeConfig.testnet4SingletonHost || "",
    port: nodeConfig.testnet4SingletonPort || TESTNET_DEFAULT_PORT,
    protocol: (nodeConfig.testnet4SingletonSsl ?? true) ? "ssl" : "tcp",
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    proxy: proxyConfigFromNodeConfig(nodeConfig),
  };
}

export function signetConnectionConfig(
  nodeConfig: PersistedNodeConfig,
): ResolvedConnectionConfig {
  return {
    host: nodeConfig.signetSingletonHost || SIGNET_DEFAULT_HOST,
    port: nodeConfig.signetSingletonPort || SIGNET_DEFAULT_PORT,
    protocol: (nodeConfig.signetSingletonSsl ?? true) ? "ssl" : "tcp",
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
