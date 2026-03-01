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

/**
 * Build the Prisma data object for creating or updating a NodeConfig record.
 * Centralizes all the field normalization, parsing, and default logic.
 */
export function buildNodeConfigData(input: NodeConfigInput): Record<string, unknown> {
  const estimator = input.mempoolEstimator && VALID_ESTIMATORS.includes(input.mempoolEstimator)
    ? input.mempoolEstimator
    : 'simple';

  const loadBalancing = input.poolLoadBalancing && VALID_LOAD_BALANCING.includes(input.poolLoadBalancing)
    ? input.poolLoadBalancing
    : 'round_robin';

  return {
    type: input.type,
    host: input.host,
    port: parseInt(input.port.toString(), 10),
    useSsl: input.useSsl === true,
    allowSelfSignedCert: input.allowSelfSignedCert === true,
    explorerUrl: input.explorerUrl || 'https://mempool.space',
    feeEstimatorUrl: input.feeEstimatorUrl || null,
    mempoolEstimator: estimator,
    // poolEnabled should be true if mainnetMode is 'pool'
    poolEnabled: input.poolEnabled ?? (input.mainnetMode === 'pool' || input.mainnetMode === undefined),
    poolMinConnections: input.poolMinConnections ?? 1,
    poolMaxConnections: input.poolMaxConnections ?? 5,
    poolLoadBalancing: loadBalancing,
    // Proxy settings
    proxyEnabled: input.proxyEnabled ?? false,
    proxyHost: input.proxyHost || null,
    proxyPort: input.proxyPort ? parseInt(input.proxyPort.toString(), 10) : null,
    proxyUsername: input.proxyUsername || null,
    proxyPassword: input.proxyPassword ? encrypt(input.proxyPassword) : null,
    // Per-network settings - Mainnet
    mainnetMode: input.mainnetMode || 'pool',
    mainnetSingletonHost: input.mainnetSingletonHost || 'electrum.blockstream.info',
    mainnetSingletonPort: input.mainnetSingletonPort ? parseInt(input.mainnetSingletonPort.toString(), 10) : 50002,
    mainnetSingletonSsl: input.mainnetSingletonSsl ?? true,
    mainnetPoolMin: input.mainnetPoolMin ? parseInt(input.mainnetPoolMin.toString(), 10) : 1,
    mainnetPoolMax: input.mainnetPoolMax ? parseInt(input.mainnetPoolMax.toString(), 10) : 5,
    mainnetPoolLoadBalancing: input.mainnetPoolLoadBalancing || 'round_robin',
    // Per-network settings - Testnet
    testnetEnabled: input.testnetEnabled ?? false,
    testnetMode: input.testnetMode || 'singleton',
    testnetSingletonHost: input.testnetSingletonHost || 'electrum.blockstream.info',
    testnetSingletonPort: input.testnetSingletonPort ? parseInt(input.testnetSingletonPort.toString(), 10) : 60002,
    testnetSingletonSsl: input.testnetSingletonSsl ?? true,
    testnetPoolMin: input.testnetPoolMin ? parseInt(input.testnetPoolMin.toString(), 10) : 1,
    testnetPoolMax: input.testnetPoolMax ? parseInt(input.testnetPoolMax.toString(), 10) : 3,
    testnetPoolLoadBalancing: input.testnetPoolLoadBalancing || 'round_robin',
    // Per-network settings - Signet
    signetEnabled: input.signetEnabled ?? false,
    signetMode: input.signetMode || 'singleton',
    signetSingletonHost: input.signetSingletonHost || 'electrum.mutinynet.com',
    signetSingletonPort: input.signetSingletonPort ? parseInt(input.signetSingletonPort.toString(), 10) : 50002,
    signetSingletonSsl: input.signetSingletonSsl ?? true,
    signetPoolMin: input.signetPoolMin ? parseInt(input.signetPoolMin.toString(), 10) : 1,
    signetPoolMax: input.signetPoolMax ? parseInt(input.signetPoolMax.toString(), 10) : 3,
    signetPoolLoadBalancing: input.signetPoolLoadBalancing || 'round_robin',
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
