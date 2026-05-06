import { nodeConfigRepository } from "../../repositories";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import type { NetworkType } from "./electrumPool";
import type { NetworkModeConfig } from "./nodeClient";
import { NetworkDisabledError, isNetworkDisabledError } from "./errors";

const log = createLogger("BITCOIN:SVC_NODE_CLIENT_CONFIG");

type ConnectionMode = "singleton" | "pool";

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
  testnet3Enabled: boolean | null;
  testnet3Mode: string | null;
  testnet3SingletonHost: string | null;
  testnet3SingletonPort: number | null;
  testnet3SingletonSsl: boolean | null;
  testnet3PoolMin: number | null;
  testnet3PoolMax: number | null;
  testnet3PoolLoadBalancing: string | null;
  testnet4Enabled: boolean | null;
  testnet4Mode: string | null;
  testnet4SingletonHost: string | null;
  testnet4SingletonPort: number | null;
  testnet4SingletonSsl: boolean | null;
  testnet4PoolMin: number | null;
  testnet4PoolMax: number | null;
  testnet4PoolLoadBalancing: string | null;
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

export function getDefaultNetworkModeConfig(
  network: NetworkType,
): NetworkModeConfig {
  return { mode: network === "mainnet" ? "pool" : "singleton" };
}

export function getPoolLoadBalancing(
  value: string | null | undefined,
  fallback: NetworkModeConfig["poolLoadBalancing"],
): NetworkModeConfig["poolLoadBalancing"] {
  return (value as NetworkModeConfig["poolLoadBalancing"]) ?? fallback;
}

function withLegacy<T>(
  value: T | null | undefined,
  legacyValue: T | null | undefined,
): T | undefined {
  return value ?? legacyValue ?? undefined;
}

function getConnectionMode(
  value: string | null | undefined,
  fallback: ConnectionMode,
): ConnectionMode {
  return value === "pool" || value === "singleton" ? value : fallback;
}

export function getMainnetModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  return {
    mode: getConnectionMode(nodeConfig.mainnetMode, "pool"),
    singletonHost: nodeConfig.mainnetSingletonHost ?? undefined,
    singletonPort: nodeConfig.mainnetSingletonPort ?? undefined,
    singletonSsl: nodeConfig.mainnetSingletonSsl ?? true,
    poolMin: nodeConfig.mainnetPoolMin ?? 1,
    poolMax: nodeConfig.mainnetPoolMax ?? 5,
    poolLoadBalancing: getPoolLoadBalancing(
      nodeConfig.mainnetPoolLoadBalancing,
      "round_robin",
    ),
  };
}

export function assertNetworkEnabled(
  enabled: boolean | null | undefined,
  label: string,
): void {
  if (!enabled) {
    throw new NetworkDisabledError(label);
  }
}

export function getTestnet3ModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  const mode = withLegacy(nodeConfig.testnet3Mode, nodeConfig.testnetMode);

  assertNetworkEnabled(
    nodeConfig.testnet3Enabled ?? nodeConfig.testnetEnabled,
    "Testnet3",
  );

  return {
    mode: getConnectionMode(mode, "singleton"),
    singletonHost: withLegacy(
      nodeConfig.testnet3SingletonHost,
      nodeConfig.testnetSingletonHost,
    ),
    singletonPort: withLegacy(
      nodeConfig.testnet3SingletonPort,
      nodeConfig.testnetSingletonPort,
    ),
    singletonSsl:
      withLegacy(nodeConfig.testnet3SingletonSsl, nodeConfig.testnetSingletonSsl) ??
      true,
    poolMin: withLegacy(nodeConfig.testnet3PoolMin, nodeConfig.testnetPoolMin) ?? 1,
    poolMax: withLegacy(nodeConfig.testnet3PoolMax, nodeConfig.testnetPoolMax) ?? 3,
    poolLoadBalancing: getPoolLoadBalancing(
      withLegacy(
        nodeConfig.testnet3PoolLoadBalancing,
        nodeConfig.testnetPoolLoadBalancing,
      ),
      "round_robin",
    ),
  };
}

export function getTestnet4ModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  assertNetworkEnabled(nodeConfig.testnet4Enabled, "Testnet4");
  return {
    mode: getConnectionMode(nodeConfig.testnet4Mode, "singleton"),
    singletonHost: nodeConfig.testnet4SingletonHost ?? undefined,
    singletonPort: nodeConfig.testnet4SingletonPort ?? undefined,
    singletonSsl: nodeConfig.testnet4SingletonSsl ?? true,
    poolMin: nodeConfig.testnet4PoolMin ?? 1,
    poolMax: nodeConfig.testnet4PoolMax ?? 3,
    poolLoadBalancing: getPoolLoadBalancing(
      nodeConfig.testnet4PoolLoadBalancing,
      "round_robin",
    ),
  };
}

export function getSignetModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  assertNetworkEnabled(nodeConfig.signetEnabled, "Signet");
  return {
    mode: getConnectionMode(nodeConfig.signetMode, "singleton"),
    singletonHost: nodeConfig.signetSingletonHost ?? undefined,
    singletonPort: nodeConfig.signetSingletonPort ?? undefined,
    singletonSsl: nodeConfig.signetSingletonSsl ?? true,
    poolMin: nodeConfig.signetPoolMin ?? 1,
    poolMax: nodeConfig.signetPoolMax ?? 3,
    poolLoadBalancing: getPoolLoadBalancing(
      nodeConfig.signetPoolLoadBalancing,
      "round_robin",
    ),
  };
}

export function getRegtestModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  return {
    mode: "singleton",
    singletonHost: nodeConfig.host,
    singletonPort: nodeConfig.port,
    singletonSsl: nodeConfig.useSsl,
  };
}

export function buildNetworkModeConfig(
  network: NetworkType,
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  switch (network) {
    case "mainnet":
      return getMainnetModeConfig(nodeConfig);
    case "testnet3":
      return getTestnet3ModeConfig(nodeConfig);
    case "testnet4":
      return getTestnet4ModeConfig(nodeConfig);
    case "signet":
      return getSignetModeConfig(nodeConfig);
    case "regtest":
      return getRegtestModeConfig(nodeConfig);
    default:
      return { mode: "pool" };
  }
}

export async function getNetworkModeConfig(
  network: NetworkType,
): Promise<NetworkModeConfig> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefault();
    return nodeConfig
      ? buildNetworkModeConfig(network, nodeConfig)
      : getDefaultNetworkModeConfig(network);
  } catch (error) {
    if (isNetworkDisabledError(error)) {
      throw error;
    }

    log.warn(`Failed to load network mode config for ${network}`, {
      error: getErrorMessage(error),
    });
    return getDefaultNetworkModeConfig(network);
  }
}
