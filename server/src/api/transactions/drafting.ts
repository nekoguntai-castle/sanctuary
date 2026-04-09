/**
 * Transactions - Drafting Router
 *
 * Endpoints for creating unsigned PSBTs (transaction drafts)
 * including single, batch, and estimation flows.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';
import { walletRepository } from '../../repositories/walletRepository';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError, NotFoundError, ForbiddenError } from '../../errors/ApiError';
import { validateAddress } from '../../services/bitcoin/utils';
import { policyEvaluationEngine } from '../../services/vaultPolicy';
import { MIN_FEE_RATE } from '../../constants';
import * as txService from '../../services/bitcoin/transactionService';

const router = Router();
const log = createLogger('TX_DRAFT:ROUTE');

/**
 * POST /api/v1/wallets/:walletId/transactions/create
 * Create a new transaction PSBT (returns PSBT for hardware wallet signing)
 */
router.post('/wallets/:walletId/transactions/create', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const {
    recipient,
    amount,
    feeRate,
    selectedUtxoIds,
    enableRBF = true,
    label,
    memo,
    sendMax = false,
    subtractFees = false,
    decoyOutputs,
  } = req.body;

  log.debug('Create transaction request', {
    walletId,
    recipient: recipient?.substring(0, 20) + '...',
    amount,
    feeRate,
    sendMax,
    subtractFees,
    decoyOutputs,
    hasSelectedUtxos: !!selectedUtxoIds?.length,
  });

  // Basic validation
  if (!recipient || !amount) {
    throw new ValidationError('recipient and amount are required');
  }

  if (!feeRate || feeRate < MIN_FEE_RATE) {
    throw new ValidationError(`feeRate must be at least ${MIN_FEE_RATE} sat/vB`);
  }

  // Fetch wallet data
  const wallet = await walletRepository.findById(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  // Validate Bitcoin address for the wallet's network
  const network = wallet.network as 'mainnet' | 'testnet' | 'regtest';
  const addressValidation = validateAddress(recipient, network);
  if (!addressValidation.valid) {
    throw new ValidationError(`Invalid Bitcoin address: ${addressValidation.error}`);
  }

  // Evaluate vault policies BEFORE creating the PSBT
  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: req.user!.userId,
    recipient,
    amount: BigInt(amount),
  });

  if (!policyResult.allowed) {
    throw new ForbiddenError('Transaction blocked by vault policy');
  }

  // Create transaction
  const txData = await txService.createTransaction(
    walletId,
    recipient,
    amount,
    feeRate,
    {
      selectedUtxoIds,
      enableRBF,
      label,
      memo,
      sendMax,
      subtractFees,
      decoyOutputs,
    }
  );

  log.debug('Create transaction response', {
    fee: txData.fee,
    changeAmount: txData.changeAmount,
    effectiveAmount: txData.effectiveAmount,
    decoyOutputsCount: txData.decoyOutputs?.length || 0,
    decoyOutputs: txData.decoyOutputs,
  });

  res.json({
    psbtBase64: txData.psbtBase64,
    fee: txData.fee,
    totalInput: txData.totalInput,
    totalOutput: txData.totalOutput,
    changeAmount: txData.changeAmount,
    changeAddress: txData.changeAddress,
    utxos: txData.utxos,
    inputPaths: txData.inputPaths,
    effectiveAmount: txData.effectiveAmount,
    decoyOutputs: txData.decoyOutputs,
    policyEvaluation: policyResult.triggered.length > 0 ? policyResult : undefined,
  });
}));

/**
 * POST /api/v1/wallets/:walletId/transactions/batch
 * Create a batch transaction with multiple outputs
 */
router.post('/wallets/:walletId/transactions/batch', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const {
    outputs, // Array of { address, amount, sendMax? }
    feeRate,
    selectedUtxoIds,
    enableRBF = true,
    label,
    memo,
  } = req.body;

  // Validate outputs array
  if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
    throw new ValidationError('outputs array is required with at least one output');
  }

  if (!feeRate || feeRate < MIN_FEE_RATE) {
    throw new ValidationError(`feeRate must be at least ${MIN_FEE_RATE} sat/vB`);
  }

  // Fetch wallet for network validation
  const wallet = await walletRepository.findById(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const network = wallet.network as 'mainnet' | 'testnet' | 'regtest';

  // Validate each output
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    if (!output.address) {
      throw new ValidationError(`Output ${i + 1}: address is required`);
    }

    // Amount is required unless sendMax is true
    if (!output.sendMax && (!output.amount || output.amount <= 0)) {
      throw new ValidationError(`Output ${i + 1}: amount is required (or set sendMax: true)`);
    }

    // Validate address
    const addressValidation = validateAddress(output.address, network);
    if (!addressValidation.valid) {
      throw new ValidationError(`Output ${i + 1}: Invalid Bitcoin address: ${addressValidation.error}`);
    }
  }

  // Only one output can have sendMax
  const sendMaxCount = outputs.filter((o: { sendMax?: boolean }) => o.sendMax).length;
  if (sendMaxCount > 1) {
    throw new ValidationError('Only one output can have sendMax enabled');
  }

  // Evaluate vault policies BEFORE creating the batch PSBT
  // Note: sendMax outputs have amount=0 here; address control still applies
  const totalAmount = outputs.reduce(
    (sum: number, o: { amount?: number }) => sum + (o.amount || 0), 0
  );
  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: req.user!.userId,
    recipient: outputs[0].address,
    amount: BigInt(totalAmount),
    outputs,
  });

  if (!policyResult.allowed) {
    throw new ForbiddenError('Transaction blocked by vault policy');
  }

  // Create batch transaction
  const txData = await txService.createBatchTransaction(
    walletId,
    outputs,
    feeRate,
    {
      selectedUtxoIds,
      enableRBF,
      label,
      memo,
    }
  );

  res.json({
    psbtBase64: txData.psbtBase64,
    fee: txData.fee,
    totalInput: txData.totalInput,
    totalOutput: txData.totalOutput,
    changeAmount: txData.changeAmount,
    changeAddress: txData.changeAddress,
    utxos: txData.utxos,
    inputPaths: txData.inputPaths,
    outputs: txData.outputs,
    policyEvaluation: policyResult.triggered.length > 0 ? policyResult : undefined,
  });
}));

/**
 * POST /api/v1/wallets/:walletId/transactions/estimate
 * Estimate transaction cost before creating
 */
router.post('/wallets/:walletId/transactions/estimate', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { recipient, amount, feeRate, selectedUtxoIds } = req.body;

  // Validation
  if (!recipient || !amount || !feeRate) {
    throw new ValidationError('recipient, amount, and feeRate are required');
  }

  // Estimate transaction
  const estimate = await txService.estimateTransaction(
    walletId,
    recipient,
    amount,
    feeRate,
    selectedUtxoIds
  );

  res.json(estimate);
}));

/**
 * POST /api/v1/wallets/:walletId/psbt/create
 * Create a PSBT for hardware wallet signing
 * This is the preferred endpoint for hardware wallet integrations
 */
router.post('/wallets/:walletId/psbt/create', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const {
    recipients, // Array of { address, amount }
    feeRate,
    utxoIds, // Optional: specific UTXOs to use
  } = req.body;

  // Validation
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    throw new ValidationError('recipients array is required');
  }

  if (!feeRate || feeRate < MIN_FEE_RATE) {
    throw new ValidationError(`feeRate must be at least ${MIN_FEE_RATE} sat/vB`);
  }

  // Validate recipients
  for (const recipient of recipients) {
    if (!recipient.address || !recipient.amount) {
      throw new ValidationError('Each recipient must have address and amount');
    }
  }

  // For now, only support single recipient (can be extended later)
  const { address, amount } = recipients[0];

  // Evaluate vault policies BEFORE creating the PSBT
  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: req.user!.userId,
    recipient: address,
    amount: BigInt(amount),
  });

  if (!policyResult.allowed) {
    throw new ForbiddenError('Transaction blocked by vault policy');
  }

  // Create PSBT
  const txData = await txService.createTransaction(
    walletId,
    address,
    amount,
    feeRate,
    {
      selectedUtxoIds: utxoIds,
      enableRBF: true,
    }
  );

  res.json({
    psbt: txData.psbtBase64,
    fee: txData.fee,
    inputPaths: txData.inputPaths,
    totalInput: txData.totalInput,
    totalOutput: txData.totalOutput,
    changeAmount: txData.changeAmount,
    changeAddress: txData.changeAddress,
    utxos: txData.utxos,
  });
}));

export default router;
