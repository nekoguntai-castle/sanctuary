/**
 * Node Config Data Mapping
 *
 * Shared data transformation logic for building NodeConfig database records
 * from API request bodies. Used by both create and update paths.
 */

import { encrypt } from "../../utils/encryption";

type NullableString = string | null;
type NullableStringOrNumber = string | number | null;
type NullableBoolean = boolean | null;

/**
 * Raw node config fields from the API request body
 */
export interface NodeConfigInput {
  type: string;
  host: string;
  port: string | number;
  useSsl?: boolean;
  allowSelfSignedCert?: boolean;
  user?: NullableString;
  password?: string;
  explorerUrl?: NullableString;
  feeEstimatorUrl?: NullableString;
  mempoolEstimator?: string;
  poolEnabled?: boolean;
  poolMinConnections?: number;
  poolMaxConnections?: number;
  poolLoadBalancing?: string;
  proxyEnabled?: boolean;
  proxyHost?: NullableString;
  proxyPort?: NullableStringOrNumber;
  proxyUsername?: NullableString;
  proxyPassword?: NullableString;
  // Per-network settings - Mainnet
  mainnetMode?: string;
  mainnetSingletonHost?: NullableString;
  mainnetSingletonPort?: NullableStringOrNumber;
  mainnetSingletonSsl?: NullableBoolean;
  mainnetPoolMin?: NullableStringOrNumber;
  mainnetPoolMax?: NullableStringOrNumber;
  mainnetPoolLoadBalancing?: string;
  // Per-network settings - Testnet3
  testnet3Enabled?: boolean;
  testnet3Mode?: string;
  testnet3SingletonHost?: NullableString;
  testnet3SingletonPort?: NullableStringOrNumber;
  testnet3SingletonSsl?: NullableBoolean;
  testnet3PoolMin?: NullableStringOrNumber;
  testnet3PoolMax?: NullableStringOrNumber;
  testnet3PoolLoadBalancing?: string;
  // Per-network settings - Testnet4
  testnet4Enabled?: boolean;
  testnet4Mode?: string;
  testnet4SingletonHost?: NullableString;
  testnet4SingletonPort?: NullableStringOrNumber;
  testnet4SingletonSsl?: NullableBoolean;
  testnet4PoolMin?: NullableStringOrNumber;
  testnet4PoolMax?: NullableStringOrNumber;
  testnet4PoolLoadBalancing?: string;
  // Deprecated legacy Testnet settings
  testnetEnabled?: boolean;
  testnetMode?: string;
  testnetSingletonHost?: NullableString;
  testnetSingletonPort?: NullableStringOrNumber;
  testnetSingletonSsl?: NullableBoolean;
  testnetPoolMin?: NullableStringOrNumber;
  testnetPoolMax?: NullableStringOrNumber;
  testnetPoolLoadBalancing?: string;
  // Per-network settings - Signet
  signetEnabled?: boolean;
  signetMode?: string;
  signetSingletonHost?: NullableString;
  signetSingletonPort?: NullableStringOrNumber;
  signetSingletonSsl?: NullableBoolean;
  signetPoolMin?: NullableStringOrNumber;
  signetPoolMax?: NullableStringOrNumber;
  signetPoolLoadBalancing?: string;
}

const VALID_ESTIMATORS = ["simple", "mempool_space"];
const VALID_LOAD_BALANCING = [
  "round_robin",
  "least_connections",
  "failover_only",
];

interface NetworkDefaults {
  mode: string;
  host: string;
  port: number;
  useSsl: boolean;
  poolMin: number;
  poolMax: number;
  poolLoadBalancing: string;
}

interface NetworkInputFields {
  mode?: string;
  singletonHost?: NullableString;
  singletonPort?: NullableStringOrNumber;
  singletonSsl?: NullableBoolean;
  poolMin?: NullableStringOrNumber;
  poolMax?: NullableStringOrNumber;
  poolLoadBalancing?: string;
}

const MAINNET_DEFAULTS: NetworkDefaults = {
  mode: "pool",
  host: "electrum.blockstream.info",
  port: 50002,
  useSsl: true,
  poolMin: 1,
  poolMax: 5,
  poolLoadBalancing: "round_robin",
};

const TESTNET_DEFAULTS: NetworkDefaults = {
  mode: "singleton",
  host: "electrum.blockstream.info",
  port: 60002,
  useSsl: true,
  poolMin: 1,
  poolMax: 3,
  poolLoadBalancing: "round_robin",
};

const TESTNET4_DEFAULTS: NetworkDefaults = {
  mode: "singleton",
  host: "",
  port: 60002,
  useSsl: true,
  poolMin: 1,
  poolMax: 3,
  poolLoadBalancing: "round_robin",
};

const SIGNET_DEFAULTS: NetworkDefaults = {
  mode: "singleton",
  host: "electrum.mutinynet.com",
  port: 50002,
  useSsl: true,
  poolMin: 1,
  poolMax: 3,
  poolLoadBalancing: "round_robin",
};

function parseIntegerValue(
  value: NullableStringOrNumber | undefined,
  fallback: number,
): number {
  return value === undefined || value === null || value === ""
    ? fallback
    : parseInt(value.toString(), 10);
}

function parseRequiredInteger(value: string | number): number {
  return parseInt(value.toString(), 10);
}

function pickAllowed(
  value: string | undefined,
  allowed: string[],
  fallback: string,
): string {
  return value && allowed.includes(value) ? value : fallback;
}

function encryptedOrNull(value: NullableString | undefined): string | null {
  return value ? encrypt(value) : null;
}

function optionalString(value: NullableString | undefined): string | null {
  return value || null;
}

function buildProxyData(input: NodeConfigInput): Record<string, unknown> {
  return {
    proxyEnabled: input.proxyEnabled ?? false,
    proxyHost: optionalString(input.proxyHost),
    proxyPort: parseOptionalInteger(input.proxyPort),
    proxyUsername: optionalString(input.proxyUsername),
    proxyPassword: encryptedOrNull(input.proxyPassword),
  };
}

function parseOptionalInteger(
  value: NullableStringOrNumber | undefined,
): number | null {
  return value ? parseInt(value.toString(), 10) : null;
}

function buildNetworkData(
  fields: NetworkInputFields,
  defaults: NetworkDefaults,
) {
  return {
    mode: fields.mode || defaults.mode,
    singletonHost: fields.singletonHost || defaults.host,
    singletonPort: parseIntegerValue(fields.singletonPort, defaults.port),
    singletonSsl: fields.singletonSsl ?? defaults.useSsl,
    poolMin: parseIntegerValue(fields.poolMin, defaults.poolMin),
    poolMax: parseIntegerValue(fields.poolMax, defaults.poolMax),
    poolLoadBalancing: fields.poolLoadBalancing || defaults.poolLoadBalancing,
  };
}

function legacyField<T>(
  value: T | null | undefined,
  legacyValue: T | null | undefined,
): T | null | undefined {
  return value ?? legacyValue;
}

function buildMainnetData(input: NodeConfigInput): Record<string, unknown> {
  const mainnet = buildNetworkData(
    {
      mode: input.mainnetMode,
      singletonHost: input.mainnetSingletonHost,
      singletonPort: input.mainnetSingletonPort,
      singletonSsl: input.mainnetSingletonSsl,
      poolMin: input.mainnetPoolMin,
      poolMax: input.mainnetPoolMax,
      poolLoadBalancing: input.mainnetPoolLoadBalancing,
    },
    MAINNET_DEFAULTS,
  );

  return {
    mainnetMode: mainnet.mode,
    mainnetSingletonHost: mainnet.singletonHost,
    mainnetSingletonPort: mainnet.singletonPort,
    mainnetSingletonSsl: mainnet.singletonSsl,
    mainnetPoolMin: mainnet.poolMin,
    mainnetPoolMax: mainnet.poolMax,
    mainnetPoolLoadBalancing: mainnet.poolLoadBalancing,
  };
}

function buildTestnet3Fields(input: NodeConfigInput): NetworkInputFields {
  return {
    mode: legacyField(input.testnet3Mode, input.testnetMode) ?? undefined,
    singletonHost: legacyField(input.testnet3SingletonHost, input.testnetSingletonHost),
    singletonPort: legacyField(input.testnet3SingletonPort, input.testnetSingletonPort),
    singletonSsl: legacyField(input.testnet3SingletonSsl, input.testnetSingletonSsl),
    poolMin: legacyField(input.testnet3PoolMin, input.testnetPoolMin),
    poolMax: legacyField(input.testnet3PoolMax, input.testnetPoolMax),
    poolLoadBalancing:
      legacyField(input.testnet3PoolLoadBalancing, input.testnetPoolLoadBalancing) ??
      undefined,
  };
}

function buildTestnet3CompatibilityData(
  enabled: boolean,
  testnet3: ReturnType<typeof buildNetworkData>,
): Record<string, unknown> {
  return {
    testnetEnabled: enabled,
    testnetMode: testnet3.mode,
    testnetSingletonHost: testnet3.singletonHost,
    testnetSingletonPort: testnet3.singletonPort,
    testnetSingletonSsl: testnet3.singletonSsl,
    testnetPoolMin: testnet3.poolMin,
    testnetPoolMax: testnet3.poolMax,
    testnetPoolLoadBalancing: testnet3.poolLoadBalancing,
  };
}

function buildTestnet3Data(input: NodeConfigInput): Record<string, unknown> {
  const enabled = legacyField(input.testnet3Enabled, input.testnetEnabled) ?? false;
  const testnet3 = buildNetworkData(buildTestnet3Fields(input), TESTNET_DEFAULTS);

  return {
    testnet3Enabled: enabled,
    testnet3Mode: testnet3.mode,
    testnet3SingletonHost: testnet3.singletonHost,
    testnet3SingletonPort: testnet3.singletonPort,
    testnet3SingletonSsl: testnet3.singletonSsl,
    testnet3PoolMin: testnet3.poolMin,
    testnet3PoolMax: testnet3.poolMax,
    testnet3PoolLoadBalancing: testnet3.poolLoadBalancing,
    ...buildTestnet3CompatibilityData(enabled, testnet3),
  };
}

function buildTestnet4Data(input: NodeConfigInput): Record<string, unknown> {
  const testnet4 = buildNetworkData(
    {
      mode: input.testnet4Mode,
      singletonHost: input.testnet4SingletonHost,
      singletonPort: input.testnet4SingletonPort,
      singletonSsl: input.testnet4SingletonSsl,
      poolMin: input.testnet4PoolMin,
      poolMax: input.testnet4PoolMax,
      poolLoadBalancing: input.testnet4PoolLoadBalancing,
    },
    TESTNET4_DEFAULTS,
  );

  return {
    testnet4Enabled: input.testnet4Enabled ?? false,
    testnet4Mode: testnet4.mode,
    testnet4SingletonHost: testnet4.singletonHost || null,
    testnet4SingletonPort: testnet4.singletonPort,
    testnet4SingletonSsl: testnet4.singletonSsl,
    testnet4PoolMin: testnet4.poolMin,
    testnet4PoolMax: testnet4.poolMax,
    testnet4PoolLoadBalancing: testnet4.poolLoadBalancing,
  };
}

function buildSignetData(input: NodeConfigInput): Record<string, unknown> {
  const signet = buildNetworkData(
    {
      mode: input.signetMode,
      singletonHost: input.signetSingletonHost,
      singletonPort: input.signetSingletonPort,
      singletonSsl: input.signetSingletonSsl,
      poolMin: input.signetPoolMin,
      poolMax: input.signetPoolMax,
      poolLoadBalancing: input.signetPoolLoadBalancing,
    },
    SIGNET_DEFAULTS,
  );

  return {
    signetEnabled: input.signetEnabled ?? false,
    signetMode: signet.mode,
    signetSingletonHost: signet.singletonHost,
    signetSingletonPort: signet.singletonPort,
    signetSingletonSsl: signet.singletonSsl,
    signetPoolMin: signet.poolMin,
    signetPoolMax: signet.poolMax,
    signetPoolLoadBalancing: signet.poolLoadBalancing,
  };
}

/**
 * Build the Prisma data object for creating or updating a NodeConfig record.
 * Centralizes all the field normalization, parsing, and default logic.
 */
export function buildNodeConfigData(
  input: NodeConfigInput,
): Record<string, unknown> {
  const estimator = pickAllowed(
    input.mempoolEstimator,
    VALID_ESTIMATORS,
    "simple",
  );
  const loadBalancing = pickAllowed(
    input.poolLoadBalancing,
    VALID_LOAD_BALANCING,
    "round_robin",
  );

  return {
    type: input.type,
    host: input.host,
    port: parseRequiredInteger(input.port),
    useSsl: input.useSsl === true,
    allowSelfSignedCert: input.allowSelfSignedCert === true,
    explorerUrl: input.explorerUrl || "https://mempool.space",
    feeEstimatorUrl: input.feeEstimatorUrl || null,
    mempoolEstimator: estimator,
    poolEnabled:
      input.poolEnabled ??
      (input.mainnetMode === "pool" || input.mainnetMode === undefined),
    poolMinConnections: input.poolMinConnections ?? 1,
    poolMaxConnections: input.poolMaxConnections ?? 5,
    poolLoadBalancing: loadBalancing,
    ...buildProxyData(input),
    ...buildMainnetData(input),
    ...buildTestnet3Data(input),
    ...buildTestnet4Data(input),
    ...buildSignetData(input),
  };
}

function buildNodeConfigBaseResponse(
  nodeConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: nodeConfig.type,
    host: nodeConfig.host,
    port: String(nodeConfig.port),
    useSsl: nodeConfig.useSsl,
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    explorerUrl: nodeConfig.explorerUrl,
    feeEstimatorUrl: nodeConfig.feeEstimatorUrl || "https://mempool.space",
    mempoolEstimator: nodeConfig.mempoolEstimator || "simple",
    poolEnabled: nodeConfig.poolEnabled,
    poolMinConnections: nodeConfig.poolMinConnections,
    poolMaxConnections: nodeConfig.poolMaxConnections,
    poolLoadBalancing: nodeConfig.poolLoadBalancing || "round_robin",
  };
}

function buildMainnetResponse(
  nodeConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    mainnetMode: nodeConfig.mainnetMode,
    mainnetSingletonHost: nodeConfig.mainnetSingletonHost,
    mainnetSingletonPort: nodeConfig.mainnetSingletonPort,
    mainnetSingletonSsl: nodeConfig.mainnetSingletonSsl,
    mainnetPoolMin: nodeConfig.mainnetPoolMin,
    mainnetPoolMax: nodeConfig.mainnetPoolMax,
    mainnetPoolLoadBalancing: nodeConfig.mainnetPoolLoadBalancing,
  };
}

function buildTestnet3Response(
  nodeConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    testnet3Enabled: legacyField(nodeConfig.testnet3Enabled, nodeConfig.testnetEnabled),
    testnet3Mode: legacyField(nodeConfig.testnet3Mode, nodeConfig.testnetMode),
    testnet3SingletonHost: legacyField(
      nodeConfig.testnet3SingletonHost,
      nodeConfig.testnetSingletonHost,
    ),
    testnet3SingletonPort: legacyField(
      nodeConfig.testnet3SingletonPort,
      nodeConfig.testnetSingletonPort,
    ),
    testnet3SingletonSsl: legacyField(
      nodeConfig.testnet3SingletonSsl,
      nodeConfig.testnetSingletonSsl,
    ),
    testnet3PoolMin: legacyField(nodeConfig.testnet3PoolMin, nodeConfig.testnetPoolMin),
    testnet3PoolMax: legacyField(nodeConfig.testnet3PoolMax, nodeConfig.testnetPoolMax),
    testnet3PoolLoadBalancing: legacyField(
      nodeConfig.testnet3PoolLoadBalancing,
      nodeConfig.testnetPoolLoadBalancing,
    ),
  };
}

function buildTestnet4Response(
  nodeConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    testnet4Enabled: nodeConfig.testnet4Enabled,
    testnet4Mode: nodeConfig.testnet4Mode,
    testnet4SingletonHost: nodeConfig.testnet4SingletonHost,
    testnet4SingletonPort: nodeConfig.testnet4SingletonPort,
    testnet4SingletonSsl: nodeConfig.testnet4SingletonSsl,
    testnet4PoolMin: nodeConfig.testnet4PoolMin,
    testnet4PoolMax: nodeConfig.testnet4PoolMax,
    testnet4PoolLoadBalancing: nodeConfig.testnet4PoolLoadBalancing,
  };
}

function buildLegacyTestnetResponse(
  nodeConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    testnetEnabled: nodeConfig.testnetEnabled,
    testnetMode: nodeConfig.testnetMode,
    testnetSingletonHost: nodeConfig.testnetSingletonHost,
    testnetSingletonPort: nodeConfig.testnetSingletonPort,
    testnetSingletonSsl: nodeConfig.testnetSingletonSsl,
    testnetPoolMin: nodeConfig.testnetPoolMin,
    testnetPoolMax: nodeConfig.testnetPoolMax,
    testnetPoolLoadBalancing: nodeConfig.testnetPoolLoadBalancing,
  };
}

function buildSignetResponse(
  nodeConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    signetEnabled: nodeConfig.signetEnabled,
    signetMode: nodeConfig.signetMode,
    signetSingletonHost: nodeConfig.signetSingletonHost,
    signetSingletonPort: nodeConfig.signetSingletonPort,
    signetSingletonSsl: nodeConfig.signetSingletonSsl,
    signetPoolMin: nodeConfig.signetPoolMin,
    signetPoolMax: nodeConfig.signetPoolMax,
    signetPoolLoadBalancing: nodeConfig.signetPoolLoadBalancing,
  };
}

/**
 * Build the API response object from a NodeConfig database record.
 * Masks sensitive fields (proxy password).
 */
export function buildNodeConfigResponse(
  nodeConfig: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...buildNodeConfigBaseResponse(nodeConfig),
    ...buildMainnetResponse(nodeConfig),
    ...buildTestnet3Response(nodeConfig),
    ...buildTestnet4Response(nodeConfig),
    ...buildLegacyTestnetResponse(nodeConfig),
    ...buildSignetResponse(nodeConfig),
  };
}
