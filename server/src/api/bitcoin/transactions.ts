/**
 * Bitcoin - Transactions Router
 *
 * Transaction operations including broadcast, RBF, CPFP, and batch transactions
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as blockchain from '../../services/bitcoin/blockchain';
import { db as prisma } from '../../repositories/db';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError, ForbiddenError } from '../../errors/ApiError';
import * as advancedTx from '../../services/bitcoin/advancedTx';

const router = Router();

/**
 * GET /api/v1/bitcoin/transaction/:txid
 * Get transaction details from blockchain
 */
router.get('/transaction/:txid', asyncHandler(async (req, res) => {
  const { txid } = req.params;

  const txDetails = await blockchain.getTransactionDetails(txid);

  res.json(txDetails);
}));

/**
 * POST /api/v1/bitcoin/broadcast
 * Broadcast a raw transaction to the network
 */
router.post('/broadcast', authenticate, asyncHandler(async (req, res) => {
  const { rawTx } = req.body;

  if (!rawTx) {
    throw new ValidationError('rawTx is required');
  }

  const result = await blockchain.broadcastTransaction(rawTx);

  res.json(result);
}));

/**
 * POST /api/v1/bitcoin/transaction/:txid/rbf-check
 * Check if a transaction can be replaced with RBF
 */
router.post('/transaction/:txid/rbf-check', authenticate, asyncHandler(async (req, res) => {
  const { txid } = req.params;

  const result = await advancedTx.canReplaceTransaction(txid);

  res.json(result);
}));

/**
 * POST /api/v1/bitcoin/transaction/:txid/rbf
 * Create an RBF replacement transaction
 */
router.post('/transaction/:txid/rbf', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { txid } = req.params;
  const { newFeeRate, walletId } = req.body;

  if (!newFeeRate || !walletId) {
    throw new ValidationError('newFeeRate and walletId are required');
  }

  // Check user has access to wallet
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: {
        some: {
          userId,
          role: { in: ['owner', 'signer'] },
        },
      },
    },
  });

  if (!wallet) {
    throw new ForbiddenError('Insufficient permissions for this wallet');
  }

  const result = await advancedTx.createRBFTransaction(
    txid,
    newFeeRate,
    walletId,
    'mainnet'
  );

  res.json({
    psbtBase64: result.psbt.toBase64(),
    fee: result.fee,
    feeRate: result.feeRate,
    feeDelta: result.feeDelta,
    inputs: result.inputs,
    outputs: result.outputs,
    inputPaths: result.inputPaths,
  });
}));

/**
 * POST /api/v1/bitcoin/transaction/cpfp
 * Create a CPFP transaction
 */
router.post('/transaction/cpfp', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const {
    parentTxid,
    parentVout,
    targetFeeRate,
    recipientAddress,
    walletId,
  } = req.body;

  if (!parentTxid || parentVout === undefined || !targetFeeRate || !recipientAddress || !walletId) {
    throw new ValidationError('parentTxid, parentVout, targetFeeRate, recipientAddress, and walletId are required');
  }

  // Check user has access to wallet
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: {
        some: {
          userId,
          role: { in: ['owner', 'signer'] },
        },
      },
    },
  });

  if (!wallet) {
    throw new ForbiddenError('Insufficient permissions for this wallet');
  }

  const result = await advancedTx.createCPFPTransaction(
    parentTxid,
    parentVout,
    targetFeeRate,
    recipientAddress,
    walletId,
    'mainnet'
  );

  res.json({
    psbtBase64: result.psbt.toBase64(),
    childFee: result.childFee,
    childFeeRate: result.childFeeRate,
    parentFeeRate: result.parentFeeRate,
    effectiveFeeRate: result.effectiveFeeRate,
  });
}));

/**
 * POST /api/v1/bitcoin/transaction/batch
 * Create a batch transaction
 */
router.post('/transaction/batch', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const {
    recipients,
    feeRate,
    walletId,
    selectedUtxoIds,
  } = req.body;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0 || !feeRate || !walletId) {
    throw new ValidationError('recipients (array), feeRate, and walletId are required');
  }

  // Validate recipients format
  for (const recipient of recipients) {
    if (!recipient.address || !recipient.amount) {
      throw new ValidationError('Each recipient must have address and amount');
    }
  }

  // Check user has access to wallet
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: {
        some: {
          userId,
          role: { in: ['owner', 'signer'] },
        },
      },
    },
  });

  if (!wallet) {
    throw new ForbiddenError('Insufficient permissions for this wallet');
  }

  const result = await advancedTx.createBatchTransaction(
    recipients,
    feeRate,
    walletId,
    selectedUtxoIds,
    'mainnet'
  );

  res.json({
    psbtBase64: result.psbt.toBase64(),
    fee: result.fee,
    totalInput: result.totalInput,
    totalOutput: result.totalOutput,
    changeAmount: result.changeAmount,
    savedFees: result.savedFees,
    recipientCount: recipients.length,
  });
}));

export default router;
