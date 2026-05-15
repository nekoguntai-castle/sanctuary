/**
 * Mempool Configuration
 *
 * Resolves the mempool API base URL from node configuration.
 */

import { nodeConfigRepository } from '../../../repositories';
import type { NonRegtestNetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  getDefaultNodeMempoolApiBase,
  getNodeMempoolApiBase as resolveNodeMempoolApiBase,
  type NodeNetworkConfigSource,
} from '@sanctuary/shared/constants/nodeConfig';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

const log = createLogger('BITCOIN:SVC_MEMPOOL_CONFIG');

export type MempoolNetwork = NonRegtestNetworkType;

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

function resolveMempoolApiBase(
  nodeConfig: MempoolNodeConfig | null,
  network: MempoolNetwork,
): string {
  return resolveNodeMempoolApiBase(
    nodeConfig as NodeNetworkConfigSource | null,
    network,
  );
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

  return getDefaultNodeMempoolApiBase(network);
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
