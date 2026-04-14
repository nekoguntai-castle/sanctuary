/**
 * Bitcoin - Transactions Router
 *
 * Transaction operations including broadcast, RBF, CPFP, and batch transactions
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as blockchain from '../../services/bitcoin/blockchain';
import { walletRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { ForbiddenError } from '../../errors/ApiError';
import * as advancedTx from '../../services/bitcoin/advancedTx';

const router = Router();

const BroadcastBodySchema = z.object({
  rawTx: z.string().min(1),
});

const RbfBodySchema = z.object({
  newFeeRate: z.number().positive(),
  walletId: z.string().min(1),
});

const CpfpBodySchema = z.object({
  parentTxid: z.string().min(1),
  parentVout: z.number().int().nonnegative(),
  targetFeeRate: z.number().positive(),
  recipientAddress: z.string().min(1),
  walletId: z.string().min(1),
});

const BatchTransactionBodySchema = z.object({
  recipients: z.array(z.object({
    address: z.string().min(1),
    amount: z.number().positive(),
  }).passthrough()).min(1),
  feeRate: z.number().positive(),
  walletId: z.string().min(1),
  selectedUtxoIds: z.array(z.string()).optional(),
});

const batchTransactionValidationMessage = (issues: Array<{ path: string }>) => {
  if (issues.some(issue => issue.path.startsWith('recipients.') && issue.path !== 'recipients')) {
    return 'Each recipient must have address and amount';
  }
  return 'recipients (array), feeRate, and walletId are required';
};

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
router.post('/broadcast', authenticate, validate(
  { body: BroadcastBodySchema },
  { message: 'rawTx is required' }
), asyncHandler(async (req, res) => {
  const { rawTx } = req.body;

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
router.post('/transaction/:txid/rbf', authenticate, validate(
  { body: RbfBodySchema },
  { message: 'newFeeRate and walletId are required' }
), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { txid } = req.params;
  const { newFeeRate, walletId } = req.body;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithEditAccess(walletId, userId);

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
router.post('/transaction/cpfp', authenticate, validate(
  { body: CpfpBodySchema },
  { message: 'parentTxid, parentVout, targetFeeRate, recipientAddress, and walletId are required' }
), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const {
    parentTxid,
    parentVout,
    targetFeeRate,
    recipientAddress,
    walletId,
  } = req.body;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithEditAccess(walletId, userId);

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
router.post('/transaction/batch', authenticate, validate(
  { body: BatchTransactionBodySchema },
  { message: batchTransactionValidationMessage }
), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const {
    recipients,
    feeRate,
    walletId,
    selectedUtxoIds,
  } = req.body;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithEditAccess(walletId, userId);

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
