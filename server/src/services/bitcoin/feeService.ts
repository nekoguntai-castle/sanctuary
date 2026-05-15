import * as blockchain from './blockchain';
import * as mempool from './mempool';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import { createLogger } from '../../utils/logger';
import type { BitcoinNetwork } from './networks';
import type { MempoolNetwork } from './mempool/config';
import {
  hasConfiguredNodeMempoolFeeEstimator,
  type NodeNetworkConfigSource,
} from '@sanctuary/shared/constants/nodeConfig';

const log = createLogger('BITCOIN_FEE:SVC');

export interface CurrentFeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
  source: 'mempool' | 'electrum';
}

function isMempoolFeeNetwork(network: BitcoinNetwork): network is MempoolNetwork {
  return network !== 'regtest';
}

export async function getCurrentFeeEstimates(
  network: BitcoinNetwork = 'mainnet'
): Promise<CurrentFeeEstimates> {
  const nodeConfig = await nodeConfigRepository.findDefault();
  const useMempoolApi = isMempoolFeeNetwork(network) &&
    hasConfiguredNodeMempoolFeeEstimator(
      nodeConfig as NodeNetworkConfigSource | null,
      network,
    );

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
