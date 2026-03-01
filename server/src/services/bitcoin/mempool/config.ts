/**
 * Mempool Configuration
 *
 * Resolves the mempool API base URL from node configuration.
 */

import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';

const log = createLogger('MEMPOOL');

// Default mempool.space API (public instance)
const DEFAULT_MEMPOOL_API = 'https://mempool.space/api';

/**
 * Get the mempool API base URL from node config or use default
 * Priority: feeEstimatorUrl > explorerUrl > default mempool.space
 */
export async function getMempoolApiBase(): Promise<string> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

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
    log.warn('Could not fetch node config, using default', { error });
  }

  return DEFAULT_MEMPOOL_API;
}

/**
 * Get the mempool estimator type from node config
 */
export async function getMempoolEstimatorType(): Promise<'simple' | 'mempool_space'> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });
    return (nodeConfig?.mempoolEstimator as 'simple' | 'mempool_space') || 'mempool_space';
  } catch (error) {
    log.warn('Could not fetch mempool estimator config, using mempool_space', { error });
    return 'mempool_space';
  }
}
