import * as blockchain from './blockchain';
import * as mempool from './mempool';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import { createLogger } from '../../utils/logger';

const log = createLogger('BITCOIN_FEE:SVC');

export interface CurrentFeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
  source: 'mempool' | 'electrum';
}

export async function getCurrentFeeEstimates(): Promise<CurrentFeeEstimates> {
  const nodeConfig = await nodeConfigRepository.findDefault();
  const useMempoolApi = nodeConfig?.feeEstimatorUrl !== '' && nodeConfig?.feeEstimatorUrl !== undefined;

  if (useMempoolApi) {
    try {
      const mempoolFees = await mempool.getRecommendedFees();
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

  const fees = await blockchain.getFeeEstimates();
  return {
    ...fees,
    minimum: fees.economy || 1,
    source: 'electrum',
  };
}
