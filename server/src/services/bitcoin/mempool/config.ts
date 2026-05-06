/**
 * Mempool Configuration
 *
 * Resolves the mempool API base URL from node configuration.
 */

import { nodeConfigRepository } from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

const log = createLogger('BITCOIN:SVC_MEMPOOL_CONFIG');

export type MempoolNetwork = 'mainnet' | 'testnet3' | 'testnet4' | 'signet';

const DEFAULT_MEMPOOL_APIS: Record<MempoolNetwork, string> = {
  mainnet: 'https://mempool.space/api',
  testnet3: 'https://mempool.space/testnet/api',
  testnet4: 'https://mempool.space/testnet4/api',
  signet: 'https://mempool.space/signet/api',
};

type ExternalServiceUrlField =
  | 'explorerUrl'
  | 'feeEstimatorUrl'
  | 'testnet3ExplorerUrl'
  | 'testnet3FeeEstimatorUrl'
  | 'testnet4ExplorerUrl'
  | 'testnet4FeeEstimatorUrl'
  | 'signetExplorerUrl'
  | 'signetFeeEstimatorUrl';

interface MempoolNodeConfig {
  explorerUrl?: string | null;
  feeEstimatorUrl?: string | null;
  testnet3ExplorerUrl?: string | null;
  testnet3FeeEstimatorUrl?: string | null;
  testnet4ExplorerUrl?: string | null;
  testnet4FeeEstimatorUrl?: string | null;
  signetExplorerUrl?: string | null;
  signetFeeEstimatorUrl?: string | null;
}

const MEMPOOL_SERVICE_FIELDS: Record<MempoolNetwork, {
  explorerField: ExternalServiceUrlField;
  feeField: ExternalServiceUrlField;
}> = {
  mainnet: { explorerField: 'explorerUrl', feeField: 'feeEstimatorUrl' },
  testnet3: {
    explorerField: 'testnet3ExplorerUrl',
    feeField: 'testnet3FeeEstimatorUrl',
  },
  testnet4: {
    explorerField: 'testnet4ExplorerUrl',
    feeField: 'testnet4FeeEstimatorUrl',
  },
  signet: {
    explorerField: 'signetExplorerUrl',
    feeField: 'signetFeeEstimatorUrl',
  },
};

function configuredUrl(
  nodeConfig: MempoolNodeConfig | null,
  field: ExternalServiceUrlField,
): string | null {
  const value = nodeConfig?.[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toMempoolApiBase(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function resolveMempoolApiBase(
  nodeConfig: MempoolNodeConfig | null,
  network: MempoolNetwork,
): string {
  const fields = MEMPOOL_SERVICE_FIELDS[network];
  const feeUrl = configuredUrl(nodeConfig, fields.feeField);
  const explorerUrl = configuredUrl(nodeConfig, fields.explorerField);
  const configuredBase = feeUrl ?? explorerUrl;
  return configuredBase
    ? toMempoolApiBase(configuredBase)
    : DEFAULT_MEMPOOL_APIS[network];
}

/**
 * Get the mempool API base URL from node config or use default
 * Priority: network feeEstimatorUrl > network explorerUrl > default mempool.space
 */
export async function getMempoolApiBase(network: MempoolNetwork = 'mainnet'): Promise<string> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefault() as MempoolNodeConfig | null;
    return resolveMempoolApiBase(nodeConfig, network);
  } catch (error) {
    log.warn('Could not fetch node config, using default', { error: getErrorMessage(error) });
  }

  return DEFAULT_MEMPOOL_APIS[network];
}

/**
 * Get the mempool estimator type from node config
 */
export async function getMempoolEstimatorType(): Promise<'simple' | 'mempool_space'> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefault();
    return (nodeConfig?.mempoolEstimator as 'simple' | 'mempool_space') || 'mempool_space';
  } catch (error) {
    log.warn('Could not fetch mempool estimator config, using mempool_space', { error: getErrorMessage(error) });
    return 'mempool_space';
  }
}
