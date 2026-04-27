/**
 * Node Config Data Mapping
 *
 * Shared data transformation logic for building NodeConfig database records
 * from API request bodies. Used by both create and update paths.
 */

import { encrypt } from '../../utils/encryption';

/**
 * Raw node config fields from the API request body
 */
export interface NodeConfigInput {
  type: string;
  host: string;
  port: string | number;
  useSsl?: boolean;
  allowSelfSignedCert?: boolean;
  user?: string;
  password?: string;
  explorerUrl?: string;
  feeEstimatorUrl?: string;
  mempoolEstimator?: string;
  poolEnabled?: boolean;
  poolMinConnections?: number;
  poolMaxConnections?: number;
  poolLoadBalancing?: string;
  proxyEnabled?: boolean;
  proxyHost?: string;
  proxyPort?: string | number;
  proxyUsername?: string;
  proxyPassword?: string;
  // Per-network settings - Mainnet
  mainnetMode?: string;
  mainnetSingletonHost?: string;
  mainnetSingletonPort?: string | number;
  mainnetSingletonSsl?: boolean;
  mainnetPoolMin?: string | number;
  mainnetPoolMax?: string | number;
  mainnetPoolLoadBalancing?: string;
  // Per-network settings - Testnet
  testnetEnabled?: boolean;
  testnetMode?: string;
  testnetSingletonHost?: string;
  testnetSingletonPort?: string | number;
  testnetSingletonSsl?: boolean;
  testnetPoolMin?: string | number;
  testnetPoolMax?: string | number;
  testnetPoolLoadBalancing?: string;
  // Per-network settings - Signet
  signetEnabled?: boolean;
  signetMode?: string;
  signetSingletonHost?: string;
  signetSingletonPort?: string | number;
  signetSingletonSsl?: boolean;
  signetPoolMin?: string | number;
  signetPoolMax?: string | number;
  signetPoolLoadBalancing?: string;
}

const VALID_ESTIMATORS = ['simple', 'mempool_space'];
const VALID_LOAD_BALANCING = ['round_robin', 'least_connections', 'failover_only'];

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
  singletonHost?: string;
  singletonPort?: string | number;
  singletonSsl?: boolean;
  poolMin?: string | number;
  poolMax?: string | number;
  poolLoadBalancing?: string;
}

const MAINNET_DEFAULTS: NetworkDefaults = {
  mode: 'pool',
  host: 'electrum.blockstream.info',
  port: 50002,
  useSsl: true,
  poolMin: 1,
  poolMax: 5,
  poolLoadBalancing: 'round_robin',
};

const TESTNET_DEFAULTS: NetworkDefaults = {
  mode: 'singleton',
  host: 'electrum.blockstream.info',
  port: 60002,
  useSsl: true,
  poolMin: 1,
  poolMax: 3,
  poolLoadBalancing: 'round_robin',
};

const SIGNET_DEFAULTS: NetworkDefaults = {
  mode: 'singleton',
  host: 'electrum.mutinynet.com',
  port: 50002,
  useSsl: true,
  poolMin: 1,
  poolMax: 3,
  poolLoadBalancing: 'round_robin',
};

function parseIntegerValue(value: string | number | undefined, fallback: number): number {
  return value === undefined || value === ''
    ? fallback
    : parseInt(value.toString(), 10);
}

function parseRequiredInteger(value: string | number): number {
  return parseInt(value.toString(), 10);
}

function pickAllowed(value: string | undefined, allowed: string[], fallback: string): string {
  return value && allowed.includes(value) ? value : fallback;
}

function encryptedOrNull(value: string | undefined): string | null {
  return value ? encrypt(value) : null;
}

function optionalString(value: string | undefined): string | null {
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

function parseOptionalInteger(value: string | number | undefined): number | null {
  return value ? parseInt(value.toString(), 10) : null;
}

function buildNetworkData(fields: NetworkInputFields, defaults: NetworkDefaults) {
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

function buildMainnetData(input: NodeConfigInput): Record<string, unknown> {
  const mainnet = buildNetworkData({
    mode: input.mainnetMode,
    singletonHost: input.mainnetSingletonHost,
    singletonPort: input.mainnetSingletonPort,
    singletonSsl: input.mainnetSingletonSsl,
    poolMin: input.mainnetPoolMin,
    poolMax: input.mainnetPoolMax,
    poolLoadBalancing: input.mainnetPoolLoadBalancing,
  }, MAINNET_DEFAULTS);

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

function buildTestnetData(input: NodeConfigInput): Record<string, unknown> {
  const testnet = buildNetworkData({
    mode: input.testnetMode,
    singletonHost: input.testnetSingletonHost,
    singletonPort: input.testnetSingletonPort,
    singletonSsl: input.testnetSingletonSsl,
    poolMin: input.testnetPoolMin,
    poolMax: input.testnetPoolMax,
    poolLoadBalancing: input.testnetPoolLoadBalancing,
  }, TESTNET_DEFAULTS);

  return {
    testnetEnabled: input.testnetEnabled ?? false,
    testnetMode: testnet.mode,
    testnetSingletonHost: testnet.singletonHost,
    testnetSingletonPort: testnet.singletonPort,
    testnetSingletonSsl: testnet.singletonSsl,
    testnetPoolMin: testnet.poolMin,
    testnetPoolMax: testnet.poolMax,
    testnetPoolLoadBalancing: testnet.poolLoadBalancing,
  };
}

function buildSignetData(input: NodeConfigInput): Record<string, unknown> {
  const signet = buildNetworkData({
    mode: input.signetMode,
    singletonHost: input.signetSingletonHost,
    singletonPort: input.signetSingletonPort,
    singletonSsl: input.signetSingletonSsl,
    poolMin: input.signetPoolMin,
    poolMax: input.signetPoolMax,
    poolLoadBalancing: input.signetPoolLoadBalancing,
  }, SIGNET_DEFAULTS);

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
export function buildNodeConfigData(input: NodeConfigInput): Record<string, unknown> {
  const estimator = pickAllowed(input.mempoolEstimator, VALID_ESTIMATORS, 'simple');
  const loadBalancing = pickAllowed(input.poolLoadBalancing, VALID_LOAD_BALANCING, 'round_robin');

  return {
    type: input.type,
    host: input.host,
    port: parseRequiredInteger(input.port),
    useSsl: input.useSsl === true,
    allowSelfSignedCert: input.allowSelfSignedCert === true,
    explorerUrl: input.explorerUrl || 'https://mempool.space',
    feeEstimatorUrl: input.feeEstimatorUrl || null,
    mempoolEstimator: estimator,
    poolEnabled: input.poolEnabled ?? (input.mainnetMode === 'pool' || input.mainnetMode === undefined),
    poolMinConnections: input.poolMinConnections ?? 1,
    poolMaxConnections: input.poolMaxConnections ?? 5,
    poolLoadBalancing: loadBalancing,
    ...buildProxyData(input),
    ...buildMainnetData(input),
    ...buildTestnetData(input),
    ...buildSignetData(input),
  };
}

/**
 * Build the API response object from a NodeConfig database record.
 * Masks sensitive fields (proxy password).
 */
export function buildNodeConfigResponse(nodeConfig: Record<string, unknown>): Record<string, unknown> {
  return {
    type: nodeConfig.type,
    host: nodeConfig.host,
    port: String(nodeConfig.port),
    useSsl: nodeConfig.useSsl,
    allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
    explorerUrl: nodeConfig.explorerUrl,
    feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space',
    mempoolEstimator: nodeConfig.mempoolEstimator || 'simple',
    poolEnabled: nodeConfig.poolEnabled,
    poolMinConnections: nodeConfig.poolMinConnections,
    poolMaxConnections: nodeConfig.poolMaxConnections,
    poolLoadBalancing: nodeConfig.poolLoadBalancing || 'round_robin',
    // Per-network settings
    mainnetMode: nodeConfig.mainnetMode,
    mainnetSingletonHost: nodeConfig.mainnetSingletonHost,
    mainnetSingletonPort: nodeConfig.mainnetSingletonPort,
    mainnetSingletonSsl: nodeConfig.mainnetSingletonSsl,
    mainnetPoolMin: nodeConfig.mainnetPoolMin,
    mainnetPoolMax: nodeConfig.mainnetPoolMax,
    mainnetPoolLoadBalancing: nodeConfig.mainnetPoolLoadBalancing,
    testnetEnabled: nodeConfig.testnetEnabled,
    testnetMode: nodeConfig.testnetMode,
    testnetSingletonHost: nodeConfig.testnetSingletonHost,
    testnetSingletonPort: nodeConfig.testnetSingletonPort,
    testnetSingletonSsl: nodeConfig.testnetSingletonSsl,
    testnetPoolMin: nodeConfig.testnetPoolMin,
    testnetPoolMax: nodeConfig.testnetPoolMax,
    testnetPoolLoadBalancing: nodeConfig.testnetPoolLoadBalancing,
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
