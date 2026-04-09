/**
 * Bitcoin - Fees Router
 *
 * Fee estimation endpoints
 */

import { Router } from 'express';
import * as blockchain from '../../services/bitcoin/blockchain';
import * as utils from '../../services/bitcoin/utils';
import * as mempool from '../../services/bitcoin/mempool';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError } from '../../errors/ApiError';
import * as advancedTx from '../../services/bitcoin/advancedTx';

const router = Router();
const log = createLogger('BITCOIN_FEE:ROUTE');

/**
 * GET /api/v1/bitcoin/fees
 * Get current fee estimates from configured source (mempool.space API or Electrum)
 */
router.get('/fees', asyncHandler(async (_req, res) => {
  // Check configured fee estimator source
  const nodeConfig = await prisma.nodeConfig.findFirst({
    where: { isDefault: true },
  });

  const useMempoolApi = nodeConfig?.feeEstimatorUrl !== '' && nodeConfig?.feeEstimatorUrl !== undefined;

  if (useMempoolApi) {
    // Use mempool.space API (or configured URL)
    try {
      const mempoolFees = await mempool.getRecommendedFees();
      res.json({
        fastest: mempoolFees.fastestFee,
        halfHour: mempoolFees.halfHourFee,
        hour: mempoolFees.hourFee,
        economy: mempoolFees.economyFee,
        minimum: mempoolFees.minimumFee,
        source: 'mempool',
      });
      return;
    } catch (mempoolError) {
      log.warn('Mempool API fee fetch failed, falling back to Electrum', { error: String(mempoolError) });
    }
  }

  // Use Electrum server estimates
  const fees = await blockchain.getFeeEstimates();
  res.json({
    ...fees,
    minimum: fees.economy || 1,
    source: 'electrum',
  });
}));

/**
 * GET /api/v1/bitcoin/fees/advanced
 * Get advanced fee estimates with time predictions
 */
router.get('/fees/advanced', asyncHandler(async (_req, res) => {
  const fees = await advancedTx.getAdvancedFeeEstimates();

  res.json(fees);
}));

/**
 * POST /api/v1/bitcoin/utils/estimate-fee
 * Estimate transaction fee
 */
router.post('/utils/estimate-fee', asyncHandler(async (req, res) => {
  const {
    inputCount,
    outputCount,
    scriptType = 'native_segwit',
    feeRate,
  } = req.body;

  if (!inputCount || !outputCount || !feeRate) {
    throw new ValidationError('inputCount, outputCount, and feeRate are required');
  }

  const size = utils.estimateTransactionSize(inputCount, outputCount, scriptType);
  const fee = utils.calculateFee(size, feeRate);

  res.json({
    size,
    fee,
    feeRate,
  });
}));

/**
 * POST /api/v1/bitcoin/utils/estimate-optimal-fee
 * Estimate optimal fee for a transaction based on priority
 */
router.post('/utils/estimate-optimal-fee', asyncHandler(async (req, res) => {
  const {
    inputCount,
    outputCount,
    priority = 'medium',
    scriptType = 'native_segwit',
  } = req.body;

  if (!inputCount || !outputCount) {
    throw new ValidationError('inputCount and outputCount are required');
  }

  const result = await advancedTx.estimateOptimalFee(
    inputCount,
    outputCount,
    priority,
    scriptType
  );

  res.json(result);
}));

export default router;
