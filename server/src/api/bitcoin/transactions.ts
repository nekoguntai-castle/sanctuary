/**
 * Bitcoin - Transactions Router
 *
 * Transaction operations including broadcast, RBF, CPFP, and batch transactions
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as blockchain from '../../services/bitcoin/blockchain';
import { transactionRepository, walletRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import {
  ForbiddenError,
  InvalidInputError,
  TransactionNotFoundError,
} from '../../errors/ApiError';
import * as advancedTx from '../../services/bitcoin/advancedTx';
import { isBitcoinNetwork, type BitcoinNetwork } from '../../services/bitcoin/networks';
import { resolveBitcoinNetworkParam } from './networkParam';
import { createSigningIntent } from '../../services/bitcoin/signingIntent';
import {
  assertUnscopedRawTransactionBroadcastDisabled,
  assertWalletHardwareCapabilityById,
} from '../../services/hardwareWalletCapabilities';

const router = Router();

const BroadcastBodySchema = z.object({
  rawTx: z.string().min(1),
  network: z.string().optional(),
});

const RbfCheckBodySchema = z.object({
  walletId: z.string().min(1),
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

const resolveAdvancedTransactionWalletNetwork = (
  wallet: { id: string; network?: string | null }
): BitcoinNetwork => {
  if (wallet.network === 'testnet') {
    return 'testnet3';
  }

  if (isBitcoinNetwork(wallet.network)) {
    return wallet.network;
  }

  throw new InvalidInputError('Wallet has unsupported Bitcoin network', 'network', {
    walletId: wallet.id,
    network: wallet.network,
  });
};

const requireWalletTransaction = async (
  txid: string,
  walletId: string
): Promise<void> => {
  const transaction = await transactionRepository.findByTxid(txid, walletId);
  if (!transaction) {
    throw new TransactionNotFoundError(txid);
  }
};

const normalizeTransactionLookupId = (txid: string): string =>
  /^[0-9a-fA-F]{64}$/.test(txid) ? txid.toLowerCase() : txid;

/**
 * GET /api/v1/bitcoin/transaction/:txid
 * Get transaction details from blockchain
 */
router.get('/transaction/:txid', asyncHandler(async (req, res) => {
  const txid = normalizeTransactionLookupId(req.params.txid);
  const network = resolveBitcoinNetworkParam(req.query.network);

  const txDetails = await blockchain.getTransactionDetails(txid, network);

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
  resolveBitcoinNetworkParam(req.body.network);
  assertUnscopedRawTransactionBroadcastDisabled();
}));

/**
 * POST /api/v1/bitcoin/transaction/:txid/rbf-check
 * Check if a transaction can be replaced with RBF
 */
router.post('/transaction/:txid/rbf-check', authenticate, validate(
  { body: RbfCheckBodySchema }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const txid = normalizeTransactionLookupId(req.params.txid);
  const { walletId } = req.body;
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new ForbiddenError('Insufficient permissions for this wallet');
  }
  await requireWalletTransaction(txid, walletId);
  const network = resolveAdvancedTransactionWalletNetwork(wallet);
  const result = await advancedTx.canReplaceTransaction(txid, network);

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
  const userId = requireAuthenticatedUser(req).userId;
  const txid = normalizeTransactionLookupId(req.params.txid);
  const { newFeeRate, walletId } = req.body;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithEditAccess(walletId, userId);

  if (!wallet) {
    throw new ForbiddenError('Insufficient permissions for this wallet');
  }
  await requireWalletTransaction(txid, walletId);
  await assertWalletHardwareCapabilityById(walletId, 'sign');
  const network = resolveAdvancedTransactionWalletNetwork(wallet);

  const result = await advancedTx.createRBFTransaction(
    txid,
    newFeeRate,
    walletId,
    network
  );
  const psbtBase64 = result.psbt.toBase64();
  const signingIntent = await createSigningIntent({
    walletId,
    createdByUserId: userId,
    network,
    source: 'rbf',
    unsignedPsbtBase64: psbtBase64,
    replacementTxid: txid,
  });

  res.json({
    psbtBase64,
    fee: result.fee,
    feeRate: result.feeRate,
    feeDelta: result.feeDelta,
    inputs: result.inputs,
    outputs: result.outputs,
    inputPaths: result.inputPaths,
    ...signingIntent,
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
  const userId = requireAuthenticatedUser(req).userId;
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
  await assertWalletHardwareCapabilityById(walletId, 'sign');
  const network = resolveAdvancedTransactionWalletNetwork(wallet);

  const result = await advancedTx.createCPFPTransaction(
    parentTxid,
    parentVout,
    targetFeeRate,
    recipientAddress,
    walletId,
    network
  );
  const psbtBase64 = result.psbt.toBase64();
  const signingIntent = await createSigningIntent({
    walletId,
    createdByUserId: userId,
    network,
    source: 'cpfp',
    unsignedPsbtBase64: psbtBase64,
  });

  res.json({
    psbtBase64,
    childFee: result.childFee,
    childFeeRate: result.childFeeRate,
    parentFeeRate: result.parentFeeRate,
    effectiveFeeRate: result.effectiveFeeRate,
    ...signingIntent,
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
  const userId = requireAuthenticatedUser(req).userId;
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
  await assertWalletHardwareCapabilityById(walletId, 'sign');
  const network = resolveAdvancedTransactionWalletNetwork(wallet);

  const result = await advancedTx.createBatchTransaction(
    recipients,
    feeRate,
    walletId,
    selectedUtxoIds,
    network
  );
  const psbtBase64 = result.psbt.toBase64();
  const signingIntent = await createSigningIntent({
    walletId,
    createdByUserId: userId,
    network,
    source: 'advanced_batch',
    unsignedPsbtBase64: psbtBase64,
  });

  res.json({
    psbtBase64,
    fee: result.fee,
    totalInput: result.totalInput,
    totalOutput: result.totalOutput,
    changeAmount: result.changeAmount,
    savedFees: result.savedFees,
    recipientCount: recipients.length,
    ...signingIntent,
  });
}));

export default router;
