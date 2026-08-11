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
import { normalizeLegacyBitcoinNetwork, type BitcoinNetwork } from '../../services/bitcoin/networks';
import { policyEvaluationEngine } from '../../services/vaultPolicy';
import { createSigningIntent } from '../../services/bitcoin/signingIntent';
import * as txService from '../../services/bitcoin/transactionService';
import {
  MobilePsbtCreateRequestSchema,
  MobileTransactionCreateRequestSchema,
  MobileTransactionEstimateRequestSchema,
} from '@sanctuary/shared/schemas/mobileApiRequests';
import {
  BatchTransactionRequestSchema,
  type BatchTransactionRequest,
} from '@sanctuary/shared/schemas/batchTransactionRequests';
import { parseTransactionRequestBody } from './requestValidation';
import { requireAuthenticatedUser } from '../../middleware/auth';
import { assertWalletHardwareCapabilityById } from '../../services/hardwareWalletCapabilities';

const router = Router();
const log = createLogger('TX_DRAFT:ROUTE');

type WalletNetwork = BitcoinNetwork;
type ValidatedBatchOutput = { address: string; amount: number; sendMax?: boolean };

function resolveBatchOutputs(
  outputs: BatchTransactionRequest['outputs'],
  network: WalletNetwork
): ValidatedBatchOutput[] {
  return outputs.map((output, index) => {
    const address = output.address as string;
    const addressValidation = validateAddress(address, network);
    if (!addressValidation.valid) {
      throw new ValidationError(`Output ${index + 1}: Invalid Bitcoin address: ${addressValidation.error}`);
    }
    return {
      address,
      amount: typeof output.amount === 'number' ? output.amount : 0,
      ...(output.sendMax !== undefined && { sendMax: output.sendMax }),
    };
  });
}

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
  } = parseTransactionRequestBody(MobileTransactionCreateRequestSchema, req.body);

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

  // Fetch wallet data
  const wallet = await walletRepository.findById(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }
  await assertWalletHardwareCapabilityById(walletId, 'sign');

  // Validate Bitcoin address for the wallet's network
  const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet') as WalletNetwork;
  const addressValidation = validateAddress(recipient, network);
  if (!addressValidation.valid) {
    throw new ValidationError(`Invalid Bitcoin address: ${addressValidation.error}`);
  }

  // Evaluate vault policies BEFORE creating the PSBT
  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: requireAuthenticatedUser(req).userId,
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
  const signingIntent = await createSigningIntent({
    walletId,
    createdByUserId: requireAuthenticatedUser(req).userId,
    network,
    source: 'standard',
    unsignedPsbtBase64: txData.psbtBase64,
    signingContext: txData.signingContext,
  });

  log.debug('Create transaction response', {
    fee: txData.fee,
    changeAmount: txData.changeAmount,
    effectiveAmount: txData.effectiveAmount,
    decoyOutputsCount: txData.decoyOutputs?.length || 0,
    decoyOutputs: txData.decoyOutputs,
    signingContext: txData.signingContext,
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
    ...signingIntent,
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
  } = parseTransactionRequestBody(BatchTransactionRequestSchema, req.body);

  // Fetch wallet for network validation
  const wallet = await walletRepository.findById(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }
  await assertWalletHardwareCapabilityById(walletId, 'sign');

  const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet') as WalletNetwork;
  const validatedOutputs = resolveBatchOutputs(outputs, network);

  // Evaluate vault policies BEFORE creating the batch PSBT
  // Note: sendMax outputs have amount=0 here; address control still applies
  const totalAmount = validatedOutputs.reduce((sum, o) => sum + o.amount, 0);
  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: requireAuthenticatedUser(req).userId,
    recipient: validatedOutputs[0].address,
    amount: BigInt(totalAmount),
    outputs: validatedOutputs,
  });

  if (!policyResult.allowed) {
    throw new ForbiddenError('Transaction blocked by vault policy');
  }

  // Create batch transaction
  const txData = await txService.createBatchTransaction(
    walletId,
    validatedOutputs,
    feeRate,
    {
      selectedUtxoIds,
      enableRBF,
      label,
      memo,
    }
  );
  const signingIntent = await createSigningIntent({
    walletId,
    createdByUserId: requireAuthenticatedUser(req).userId,
    network,
    source: 'batch',
    unsignedPsbtBase64: txData.psbtBase64,
    signingContext: txData.signingContext,
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
    outputs: txData.outputs,
    policyEvaluation: policyResult.triggered.length > 0 ? policyResult : undefined,
    ...signingIntent,
  });
}));

/**
 * POST /api/v1/wallets/:walletId/transactions/estimate
 * Estimate transaction cost before creating
 */
router.post('/wallets/:walletId/transactions/estimate', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { recipient, amount, feeRate, selectedUtxoIds } = parseTransactionRequestBody(
    MobileTransactionEstimateRequestSchema,
    req.body
  );

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
  } = parseTransactionRequestBody(MobilePsbtCreateRequestSchema, req.body);

  // For now, only support single recipient (can be extended later)
  const { address, amount } = recipients[0];

  await assertWalletHardwareCapabilityById(walletId, 'sign');

  // Evaluate vault policies BEFORE creating the PSBT
  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: requireAuthenticatedUser(req).userId,
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
  const wallet = await walletRepository.findById(walletId);
  if (!wallet) throw new NotFoundError('Wallet not found');
  const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet') as WalletNetwork;
  const signingIntent = await createSigningIntent({
    walletId,
    createdByUserId: requireAuthenticatedUser(req).userId,
    network,
    source: 'hardware',
    unsignedPsbtBase64: txData.psbtBase64,
    signingContext: txData.signingContext,
  });

  res.json({
    psbt: txData.psbtBase64,
    fee: txData.fee,
    inputPaths: txData.inputPaths,
    totalInput: txData.totalInput,
    totalOutput: txData.totalOutput,
    changeAmount: txData.changeAmount,
    changeAddress: txData.changeAddress,
    utxos: txData.utxos,
    ...signingIntent,
  });
}));

export default router;
