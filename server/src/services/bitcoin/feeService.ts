import * as blockchain from './blockchain';
import * as mempool from './mempool';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import { createLogger } from '../../utils/logger';
import type { BitcoinNetwork } from './networks';
import type { MempoolNetwork } from './mempool/config';

const log = createLogger('BITCOIN_FEE:SVC');

export interface CurrentFeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
  source: 'mempool' | 'electrum';
}

interface FeeEstimatorNodeConfig {
  feeEstimatorUrl?: string | null;
  testnet3FeeEstimatorUrl?: string | null;
  testnet4FeeEstimatorUrl?: string | null;
  signetFeeEstimatorUrl?: string | null;
}

const FEE_ESTIMATOR_FIELDS: Record<MempoolNetwork, keyof FeeEstimatorNodeConfig> = {
  mainnet: 'feeEstimatorUrl',
  testnet3: 'testnet3FeeEstimatorUrl',
  testnet4: 'testnet4FeeEstimatorUrl',
  signet: 'signetFeeEstimatorUrl',
};

function isMempoolFeeNetwork(network: BitcoinNetwork): network is MempoolNetwork {
  return network !== 'regtest';
}

function hasConfiguredMempoolFeeEstimator(
  nodeConfig: FeeEstimatorNodeConfig | null,
  network: MempoolNetwork
): boolean {
  const value = nodeConfig?.[FEE_ESTIMATOR_FIELDS[network]];
  return typeof value === 'string' && value.trim() !== '';
}

export async function getCurrentFeeEstimates(
  network: BitcoinNetwork = 'mainnet'
): Promise<CurrentFeeEstimates> {
  const nodeConfig = await nodeConfigRepository.findDefault();
  const useMempoolApi = isMempoolFeeNetwork(network) &&
    hasConfiguredMempoolFeeEstimator(nodeConfig, network);

  if (useMempoolApi) {
    try {
      const mempoolFees = await mempool.getRecommendedFees(network);
      return {
        fastest: mempoolFees.fastestFee,
        halfHour: mempoolFees.halfHourFee,
        hour: mempoolFees.hourFee,
        economy: mempoolFees.economyFee,
        minimum: mempoolFees.minimumFee,
        source: 'mempool',
      };
    } catch (mempoolError) {
      log.warn('Mempool API fee fetch failed, falling back to Electrum', { error: String(mempoolError) });
    }
  }

  const fees = await blockchain.getFeeEstimates(network);
  return {
    ...fees,
    minimum: fees.economy || 1,
    source: 'electrum',
  };
}
