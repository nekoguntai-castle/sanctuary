import type { NetworkType, NonRegtestNetworkType } from './bitcoin';

/**
 * Pure node/Electrum projection helpers shared by UI and server runtime
 * adapters. Field lookup uses network-specific keys, with testnet3 preferring
 * `testnet3*` fields and falling back to legacy `testnet*` fields. Undefined
 * and null values are ignored, explicit false booleans are preserved, and
 * positive-integer helpers reject impossible zero or negative connection
 * values so callers fall back to network defaults.
 */

export const NODE_CONNECTION_MODE_VALUES = ['singleton', 'pool'] as const;
export type NodeConnectionMode = (typeof NODE_CONNECTION_MODE_VALUES)[number];

export const NODE_POOL_LOAD_BALANCING_VALUES = [
  'round_robin',
  'least_connections',
  'failover_only',
] as const;
export type NodePoolLoadBalancing =
  (typeof NODE_POOL_LOAD_BALANCING_VALUES)[number];

export type NodeExternalServiceKind = 'explorer' | 'feeEstimator';

export interface NodeNetworkDefaults {
  enabled: boolean;
  mode: NodeConnectionMode;
  singletonHost: string;
  singletonPort: number;
  singletonSsl: boolean;
  poolMin: number;
  poolMax: number;
  poolLoadBalancing: NodePoolLoadBalancing;
  externalServiceUrl: string;
  mempoolApiBase: string;
}

export type NodeNetworkConfigSource = Record<string, unknown>;

export interface ProjectedNodeProxyConfig {
  enabled: true;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export const NODE_NETWORK_DEFAULTS: Record<NetworkType, NodeNetworkDefaults> = {
  mainnet: {
    enabled: true,
    mode: 'pool',
    singletonHost: 'electrum.blockstream.info',
    singletonPort: 50002,
    singletonSsl: true,
    poolMin: 1,
    poolMax: 5,
    poolLoadBalancing: 'round_robin',
    externalServiceUrl: 'https://mempool.space',
    mempoolApiBase: 'https://mempool.space/api',
  },
  testnet3: {
    enabled: false,
    mode: 'singleton',
    singletonHost: 'electrum.blockstream.info',
    singletonPort: 60002,
    singletonSsl: true,
    poolMin: 1,
    poolMax: 3,
    poolLoadBalancing: 'round_robin',
    externalServiceUrl: 'https://mempool.space/testnet',
    mempoolApiBase: 'https://mempool.space/testnet/api',
  },
  testnet4: {
    enabled: false,
    mode: 'singleton',
    singletonHost: '',
    singletonPort: 60002,
    singletonSsl: true,
    poolMin: 1,
    poolMax: 3,
    poolLoadBalancing: 'round_robin',
    externalServiceUrl: 'https://mempool.space/testnet4',
    mempoolApiBase: 'https://mempool.space/testnet4/api',
  },
  signet: {
    enabled: false,
    mode: 'singleton',
    singletonHost: 'electrum.mutinynet.com',
    singletonPort: 50002,
    singletonSsl: true,
    poolMin: 1,
    poolMax: 3,
    poolLoadBalancing: 'round_robin',
    externalServiceUrl: 'https://mempool.space/signet',
    mempoolApiBase: 'https://mempool.space/signet/api',
  },
  regtest: {
    enabled: true,
    mode: 'singleton',
    singletonHost: 'localhost',
    singletonPort: 50001,
    singletonSsl: false,
    poolMin: 1,
    poolMax: 5,
    poolLoadBalancing: 'round_robin',
    externalServiceUrl: 'https://mempool.space',
    mempoolApiBase: 'https://mempool.space/api',
  },
};

export type NodeNetworkSetting =
  | 'enabled'
  | 'mode'
  | 'singletonHost'
  | 'singletonPort'
  | 'singletonSsl'
  | 'poolMin'
  | 'poolMax'
  | 'poolLoadBalancing';

const NODE_NETWORK_FIELD_NAMES: Record<
  NetworkType,
  Partial<Record<NodeNetworkSetting, readonly string[]>>
> = {
  mainnet: {
    mode: ['mainnetMode'],
    singletonHost: ['mainnetSingletonHost'],
    singletonPort: ['mainnetSingletonPort'],
    singletonSsl: ['mainnetSingletonSsl'],
    poolMin: ['mainnetPoolMin'],
    poolMax: ['mainnetPoolMax'],
    poolLoadBalancing: ['mainnetPoolLoadBalancing'],
  },
  testnet3: {
    enabled: ['testnet3Enabled', 'testnetEnabled'],
    mode: ['testnet3Mode', 'testnetMode'],
    singletonHost: ['testnet3SingletonHost', 'testnetSingletonHost'],
    singletonPort: ['testnet3SingletonPort', 'testnetSingletonPort'],
    singletonSsl: ['testnet3SingletonSsl', 'testnetSingletonSsl'],
    poolMin: ['testnet3PoolMin', 'testnetPoolMin'],
    poolMax: ['testnet3PoolMax', 'testnetPoolMax'],
    poolLoadBalancing: [
      'testnet3PoolLoadBalancing',
      'testnetPoolLoadBalancing',
    ],
  },
  testnet4: {
    enabled: ['testnet4Enabled'],
    mode: ['testnet4Mode'],
    singletonHost: ['testnet4SingletonHost'],
    singletonPort: ['testnet4SingletonPort'],
    singletonSsl: ['testnet4SingletonSsl'],
    poolMin: ['testnet4PoolMin'],
    poolMax: ['testnet4PoolMax'],
    poolLoadBalancing: ['testnet4PoolLoadBalancing'],
  },
  signet: {
    enabled: ['signetEnabled'],
    mode: ['signetMode'],
    singletonHost: ['signetSingletonHost'],
    singletonPort: ['signetSingletonPort'],
    singletonSsl: ['signetSingletonSsl'],
    poolMin: ['signetPoolMin'],
    poolMax: ['signetPoolMax'],
    poolLoadBalancing: ['signetPoolLoadBalancing'],
  },
  regtest: {
    singletonHost: ['host'],
    singletonPort: ['port'],
    singletonSsl: ['useSsl'],
  },
};

export const NODE_EXTERNAL_SERVICE_FIELDS: Record<
  NetworkType,
  Record<NodeExternalServiceKind, string>
> = {
  mainnet: {
    explorer: 'explorerUrl',
    feeEstimator: 'feeEstimatorUrl',
  },
  testnet3: {
    explorer: 'testnet3ExplorerUrl',
    feeEstimator: 'testnet3FeeEstimatorUrl',
  },
  testnet4: {
    explorer: 'testnet4ExplorerUrl',
    feeEstimator: 'testnet4FeeEstimatorUrl',
  },
  signet: {
    explorer: 'signetExplorerUrl',
    feeEstimator: 'signetFeeEstimatorUrl',
  },
  regtest: {
    explorer: 'explorerUrl',
    feeEstimator: 'feeEstimatorUrl',
  },
};

export function isNodeConnectionMode(
  value: unknown,
): value is NodeConnectionMode {
  return (
    typeof value === 'string' &&
    NODE_CONNECTION_MODE_VALUES.includes(value as NodeConnectionMode)
  );
}

export function isNodePoolLoadBalancing(
  value: unknown,
): value is NodePoolLoadBalancing {
  return (
    typeof value === 'string' &&
    NODE_POOL_LOAD_BALANCING_VALUES.includes(value as NodePoolLoadBalancing)
  );
}

/**
 * Return the canonical default projection for a network. Defaults are
 * runtime-neutral and contain no decrypted secrets or adapter-specific output
 * shape.
 */
export function getNodeNetworkDefaults(
  network: NetworkType,
): NodeNetworkDefaults {
  return NODE_NETWORK_DEFAULTS[network] ?? NODE_NETWORK_DEFAULTS.mainnet;
}

/**
 * Read a raw projected setting using the configured field precedence. This is
 * the compatibility boundary for legacy testnet3 `testnet*` fields.
 */
export function readNodeNetworkSetting(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  setting: NodeNetworkSetting,
): unknown {
  const fields = NODE_NETWORK_FIELD_NAMES[network]?.[setting] ?? [];
  for (const field of fields) {
    const value = source?.[field];
    if (value !== undefined && value !== null) return value;
  }

  return undefined;
}

/** Read a string setting after network/legacy field precedence is applied. */
export function readNodeNetworkString(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  setting: NodeNetworkSetting,
): string | undefined {
  const value = readNodeNetworkSetting(source, network, setting);
  return typeof value === 'string' ? value : undefined;
}

/** Read a non-empty string setting, treating blank strings as unset. */
export function readNodeNetworkNonEmptyString(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  setting: NodeNetworkSetting,
): string | undefined {
  const value = readNodeNetworkString(source, network, setting);
  return value && value.trim() ? value : undefined;
}

/** Read a finite numeric setting after network/legacy field precedence. */
export function readNodeNetworkNumber(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  setting: NodeNetworkSetting,
): number | undefined {
  const value = readNodeNetworkSetting(source, network, setting);
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Read a finite positive integer setting for ports and pool sizes. */
export function readNodeNetworkPositiveInteger(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  setting: NodeNetworkSetting,
): number | undefined {
  const value = readNodeNetworkNumber(source, network, setting);
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/** Read a boolean setting without treating explicit false as unset. */
export function readNodeNetworkBoolean(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  setting: NodeNetworkSetting,
): boolean | undefined {
  const value = readNodeNetworkSetting(source, network, setting);
  return typeof value === 'boolean' ? value : undefined;
}

/** Resolve whether a network should be active; mainnet and regtest stay on. */
export function getNodeNetworkEnabled(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): boolean {
  if (network === 'mainnet' || network === 'regtest') return true;
  return (
    readNodeNetworkBoolean(source, network, 'enabled') ??
    getNodeNetworkDefaults(network).enabled
  );
}

/** Resolve singleton or pool mode, falling back for unknown stored strings. */
export function getNodeNetworkMode(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): NodeConnectionMode {
  const value = readNodeNetworkSetting(source, network, 'mode');
  return isNodeConnectionMode(value)
    ? value
    : getNodeNetworkDefaults(network).mode;
}

/** Resolve a singleton host, preserving the intentionally empty testnet4 default. */
export function getNodeNetworkSingletonHost(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): string {
  return (
    readNodeNetworkString(source, network, 'singletonHost') ??
    getNodeNetworkDefaults(network).singletonHost
  );
}

/** Resolve a singleton port, rejecting zero, negative, or non-integer values. */
export function getNodeNetworkSingletonPort(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): number {
  return (
    readNodeNetworkPositiveInteger(source, network, 'singletonPort') ??
    getNodeNetworkDefaults(network).singletonPort
  );
}

/** Resolve singleton TLS use while preserving explicit false values. */
export function getNodeNetworkSingletonSsl(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): boolean {
  return (
    readNodeNetworkBoolean(source, network, 'singletonSsl') ??
    getNodeNetworkDefaults(network).singletonSsl
  );
}

/** Resolve pool minimum connection count from valid positive integers only. */
export function getNodeNetworkPoolMin(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): number {
  return (
    readNodeNetworkPositiveInteger(source, network, 'poolMin') ??
    getNodeNetworkDefaults(network).poolMin
  );
}

/** Resolve pool maximum connection count from valid positive integers only. */
export function getNodeNetworkPoolMax(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): number {
  return (
    readNodeNetworkPositiveInteger(source, network, 'poolMax') ??
    getNodeNetworkDefaults(network).poolMax
  );
}

/** Resolve pool strategy, rejecting unknown stored strings to the network default. */
export function getNodeNetworkPoolLoadBalancing(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
): NodePoolLoadBalancing {
  const value = readNodeNetworkString(source, network, 'poolLoadBalancing');
  return isNodePoolLoadBalancing(value)
    ? value
    : getNodeNetworkDefaults(network).poolLoadBalancing;
}

function readStringField(
  source: NodeNetworkConfigSource | null | undefined,
  field: string,
): string | undefined {
  const value = source?.[field];
  return typeof value === 'string' ? value : undefined;
}

function readPositiveIntegerField(
  source: NodeNetworkConfigSource | null | undefined,
  field: string,
): number | undefined {
  const value = source?.[field];
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/**
 * Project proxy settings only when proxy use is enabled and host/port are
 * usable. Empty credentials are omitted so callers do not leak placeholder or
 * redacted secret values into runtime clients.
 */
export function projectNodeProxyConfig(
  source: NodeNetworkConfigSource | null | undefined,
): ProjectedNodeProxyConfig | null {
  if (source?.proxyEnabled !== true) return null;

  const host = readStringField(source, 'proxyHost');
  const port = readPositiveIntegerField(source, 'proxyPort');
  if (!host || !port) return null;

  const username = readStringField(source, 'proxyUsername');
  const password = readStringField(source, 'proxyPassword');

  return {
    enabled: true,
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

/** Return the persisted field name for a network external service. */
export function getNodeExternalServiceFieldName(
  network: NetworkType,
  kind: NodeExternalServiceKind,
): string {
  return NODE_EXTERNAL_SERVICE_FIELDS[network]?.[kind] ??
    NODE_EXTERNAL_SERVICE_FIELDS.mainnet[kind];
}

/** Return the browser/explorer base URL default for a network. */
export function getDefaultNodeExternalServiceUrl(
  network: NetworkType,
): string {
  return getNodeNetworkDefaults(network).externalServiceUrl;
}

/** Return the mempool API base URL default for fee/transaction lookups. */
export function getDefaultNodeMempoolApiBase(
  network: NonRegtestNetworkType,
): string {
  return getNodeNetworkDefaults(network).mempoolApiBase;
}

/** Read a configured external service URL, trimming blanks to unset. */
export function getConfiguredNodeExternalServiceUrl(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  kind: NodeExternalServiceKind,
): string | null {
  const field = getNodeExternalServiceFieldName(network, kind);
  const value = readStringField(source, field);
  return value?.trim() ? value.trim() : null;
}

/** Resolve the configured URL for runtime use, or the network default. */
export function getNodeExternalServiceUrl(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  kind: NodeExternalServiceKind,
): string {
  return (
    getConfiguredNodeExternalServiceUrl(source, network, kind) ??
    getDefaultNodeExternalServiceUrl(network)
  );
}

/**
 * Resolve the URL exposed in admin responses. Empty strings are preserved so
 * the UI can round-trip an intentionally cleared optional service field.
 */
export function getNodeExternalServiceResponseUrl(
  source: NodeNetworkConfigSource | null | undefined,
  network: NetworkType,
  kind: NodeExternalServiceKind,
): string {
  const field = getNodeExternalServiceFieldName(network, kind);
  const value = readStringField(source, field);
  return value ?? getDefaultNodeExternalServiceUrl(network);
}

/** Convert an explorer/service root URL to a mempool API base URL. */
export function toNodeMempoolApiBase(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

/**
 * Resolve the mempool API base URL used by runtime callers. Fee estimator URL
 * takes precedence over explorer URL, and both fall back to the network
 * default.
 */
export function getNodeMempoolApiBase(
  source: NodeNetworkConfigSource | null | undefined,
  network: NonRegtestNetworkType,
): string {
  const configuredBase =
    getConfiguredNodeExternalServiceUrl(source, network, 'feeEstimator') ??
    getConfiguredNodeExternalServiceUrl(source, network, 'explorer');

  return configuredBase
    ? toNodeMempoolApiBase(configuredBase)
    : getDefaultNodeMempoolApiBase(network);
}

/** Return whether a non-empty fee estimator URL is explicitly configured. */
export function hasConfiguredNodeMempoolFeeEstimator(
  source: NodeNetworkConfigSource | null | undefined,
  network: NonRegtestNetworkType,
): boolean {
  return Boolean(
    getConfiguredNodeExternalServiceUrl(source, network, 'feeEstimator'),
  );
}
