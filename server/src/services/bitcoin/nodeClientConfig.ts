import { nodeConfigRepository } from "../../repositories";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import {
  getNodeNetworkEnabled,
  getNodeNetworkMode,
  getNodeNetworkPoolLoadBalancing,
  getNodeNetworkPoolMax,
  getNodeNetworkPoolMin,
  getNodeNetworkSingletonSsl,
  readNodeNetworkPositiveInteger,
  readNodeNetworkString,
  type NodeNetworkConfigSource,
} from "@sanctuary/shared/constants/nodeConfig";
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

function buildRuntimeModeConfig(
  nodeConfig: PersistedNodeConfig,
  network: NetworkType,
): NetworkModeConfig {
  const source = nodeConfig as unknown as NodeNetworkConfigSource;
  return {
    mode: getNodeNetworkMode(source, network) as ConnectionMode,
    singletonHost:
      readNodeNetworkString(source, network, "singletonHost") ?? undefined,
    singletonPort:
      readNodeNetworkPositiveInteger(source, network, "singletonPort") ??
      undefined,
    singletonSsl: getNodeNetworkSingletonSsl(source, network),
    poolMin: getNodeNetworkPoolMin(source, network),
    poolMax: getNodeNetworkPoolMax(source, network),
    poolLoadBalancing: getNodeNetworkPoolLoadBalancing(
      source,
      network,
    ) as NetworkModeConfig["poolLoadBalancing"],
  };
}

export function getMainnetModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  return buildRuntimeModeConfig(nodeConfig, "mainnet");
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
  assertNetworkEnabled(
    getNodeNetworkEnabled(
      nodeConfig as unknown as NodeNetworkConfigSource,
      "testnet3",
    ),
    "Testnet3",
  );

  return buildRuntimeModeConfig(nodeConfig, "testnet3");
}

export function getTestnet4ModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  assertNetworkEnabled(
    getNodeNetworkEnabled(
      nodeConfig as unknown as NodeNetworkConfigSource,
      "testnet4",
    ),
    "Testnet4",
  );
  return buildRuntimeModeConfig(nodeConfig, "testnet4");
}

export function getSignetModeConfig(
  nodeConfig: PersistedNodeConfig,
): NetworkModeConfig {
  assertNetworkEnabled(
    getNodeNetworkEnabled(
      nodeConfig as unknown as NodeNetworkConfigSource,
      "signet",
    ),
    "Signet",
  );
  return buildRuntimeModeConfig(nodeConfig, "signet");
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
