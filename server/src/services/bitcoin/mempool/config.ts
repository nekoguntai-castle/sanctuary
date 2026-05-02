/**
 * Mempool Configuration
 *
 * Resolves the mempool API base URL from node configuration.
 */

import { nodeConfigRepository } from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

const log = createLogger('BITCOIN:SVC_MEMPOOL_CONFIG');

export type MempoolNetwork = 'mainnet' | 'testnet' | 'signet';

const DEFAULT_MEMPOOL_APIS: Record<MempoolNetwork, string> = {
  mainnet: 'https://mempool.space/api',
  testnet: 'https://mempool.space/testnet/api',
  signet: 'https://mempool.space/signet/api',
};

/**
 * Get the mempool API base URL from node config or use default
 * Priority: feeEstimatorUrl > explorerUrl > default mempool.space
 */
export async function getMempoolApiBase(network: MempoolNetwork = 'mainnet'): Promise<string> {
  if (network !== 'mainnet') {
    return DEFAULT_MEMPOOL_APIS[network];
  }

  try {
    const nodeConfig = await nodeConfigRepository.findDefault();

    // Use dedicated fee estimator URL if configured
    if (nodeConfig?.feeEstimatorUrl) {
      const feeUrl = nodeConfig.feeEstimatorUrl.replace(/\/$/, ''); // Remove trailing slash
      // If it already ends with /api, use as-is, otherwise append /api
      return feeUrl.endsWith('/api') ? feeUrl : `${feeUrl}/api`;
    }

    // Fall back to explorer URL if configured
    if (nodeConfig?.explorerUrl) {
      const explorerUrl = nodeConfig.explorerUrl.replace(/\/$/, ''); // Remove trailing slash
      return `${explorerUrl}/api`;
    }
  } catch (error) {
    log.warn('Could not fetch node config, using default', { error: getErrorMessage(error) });
  }

  return DEFAULT_MEMPOOL_APIS.mainnet;
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
