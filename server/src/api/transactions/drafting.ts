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
import { policyEvaluationEngine, type PolicyEvaluationResult } from '../../services/vaultPolicy';
import { buildIntentPolicyInput } from '../../services/vaultPolicy/intentPolicyInput';
import {
  createSigningIntent,
  deriveIntentSpend,
  loadSigningIntent,
  type IntentSpend,
  type SigningIntentHandle,
} from '../../services/bitcoin/signingIntent';
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
 * Re-evaluate vault policy against the minted intent — the transaction that
 * will actually be signed, so sendMax/subtractFees effective amounts and
 * change are what the client sees — as a preview (no second PolicyEvent).
 * A block on the minted amount refuses the request: the pre-check saw only the
 * requested amount (0 for a sendMax batch output). Undefined when nothing
 * triggered or nothing leaves the wallet.
 */
async function evaluateMintedIntent(
  walletId: string,
  userId: string,
  handle: SigningIntentHandle,
): Promise<PolicyEvaluationResult | undefined> {
  return (await evaluateMintedIntentSpend(walletId, userId, handle)).policyEvaluation;
}

/** evaluateMintedIntent, also returning the spend it evaluated (derived once from the stored intent). */
async function evaluateMintedIntentSpend(
  walletId: string,
  userId: string,
  handle: SigningIntentHandle,
): Promise<{ policyEvaluation?: PolicyEvaluationResult; spend: IntentSpend }> {
  const intent = await loadSigningIntent(handle, walletId);
  const spend = await deriveIntentSpend(walletId, intent.snapshot.network, intent.snapshot);
  const input = await buildIntentPolicyInput(walletId, userId, intent, spend);
  if (!input) return { spend };
  const result = await policyEvaluationEngine.evaluatePolicies({ ...input, preview: true });
  if (!result.allowed) throw new ForbiddenError('Transaction blocked by vault policy');
  return { policyEvaluation: result.triggered.length > 0 ? result : undefined, spend };
}

/**
 * The recipient and net amount that broadcast (`assertOptionalMetadata`) and
 * draft creation (`assertRecipientMatches`/`assertAmountMatches`) bind a batch
 * to: the intent's first external output and its external spend. Outputs to
 * the wallet's own addresses are not part of either, so the client must not
 * derive them from its output list. Both are returned only when
 * `spend.amount > 0`: the amount is the external outputs' total less any
 * payjoin peer inputs (floored at 0), so a positive amount guarantees
 * `externalOutputs[0]` exists. At amount 0 (nothing leaves the wallet, or a
 * payjoin peer covers it) both are omitted, and neither check applies.
 */
function batchIntentSpendSummary(spend: IntentSpend): { recipient?: string; effectiveAmount?: number } {
  return spend.amount > 0
    ? { recipient: spend.externalOutputs[0].address, effectiveAmount: spend.amount }
    : {};
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
    feePolicy: txData.feePolicy,
    signingContext: txData.signingContext,
  });

  const policyEvaluation = await evaluateMintedIntent(walletId, requireAuthenticatedUser(req).userId, signingIntent);

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
    policyEvaluation,
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
    feePolicy: txData.feePolicy,
    signingContext: txData.signingContext,
  });
  const { policyEvaluation, spend } = await evaluateMintedIntentSpend(
    walletId,
    requireAuthenticatedUser(req).userId,
    signingIntent,
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
    ...batchIntentSpendSummary(spend),
    policyEvaluation,
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

  const wallet = await walletRepository.findById(walletId);
  if (!wallet) throw new NotFoundError('Wallet not found');
  const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet') as WalletNetwork;

  // Validate the recipient before policy evaluation so a malformed address
  // never consumes a policy evaluation or counts against spending-limit accounting.
  const addressValidation = validateAddress(address, network);
  if (!addressValidation.valid) {
    throw new ValidationError(`Invalid Bitcoin address: ${addressValidation.error}`);
  }

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
  const signingIntent = await createSigningIntent({
    walletId,
    createdByUserId: requireAuthenticatedUser(req).userId,
    network,
    source: 'hardware',
    unsignedPsbtBase64: txData.psbtBase64,
    feePolicy: txData.feePolicy,
    signingContext: txData.signingContext,
  });
  const policyEvaluation = await evaluateMintedIntent(walletId, requireAuthenticatedUser(req).userId, signingIntent);

  res.json({
    psbt: txData.psbtBase64,
    fee: txData.fee,
    inputPaths: txData.inputPaths,
    totalInput: txData.totalInput,
    totalOutput: txData.totalOutput,
    changeAmount: txData.changeAmount,
    changeAddress: txData.changeAddress,
    utxos: txData.utxos,
    policyEvaluation,
    ...signingIntent,
  });
}));

export default router;
