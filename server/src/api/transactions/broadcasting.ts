/**
 * Transactions - Broadcasting Router
 *
 * Endpoints for broadcasting signed transactions and PSBTs.
 *
 * NOTE: These routes intentionally keep try/catch for audit logging
 * on failed broadcasts before re-throwing to asyncHandler.
 */

import { Router, type Request } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { asyncHandler } from '../../errors/errorHandler';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { auditService, AuditCategory, AuditAction } from '../../services/auditService';
import { policyEvaluationEngine } from '../../services/vaultPolicy';
import * as txService from '../../services/bitcoin/transactionService';
import { parseTransaction } from '../../services/bitcoin/utils';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';
import { draftRepository } from '../../repositories/draftRepository';
import { walletRepository } from '../../repositories/walletRepository';
import { addressRepository } from '../../repositories/addressRepository';
import { findByOutpointsForWallet } from '../../repositories/utxoRepository';
import { isBitcoinNetwork, type BitcoinNetwork } from '../../services/bitcoin/networks';
import {
  type MobilePsbtBroadcastRequest,
  MobilePsbtBroadcastRequestSchema,
  MobileTransactionBroadcastRequestSchema,
} from '@sanctuary/shared/schemas/mobileApiRequests';
import { parseTransactionRequestBody } from './requestValidation';
import { requireAuthenticatedUser } from '../../middleware/auth';
import type {
  TransactionInputMetadata,
  TransactionOutputMetadata,
} from '../../services/bitcoin/transactions/types';
import {
  assertBroadcastPayloadAvailable,
  assertExactOutpointsMatch,
  assertMetadataFieldMatches,
  assertSignedPsbtMetadataMatches,
  buildSignedPsbtBroadcastIntent,
  type BroadcastDraft,
  type BroadcastOutpoint,
  type CanonicalBroadcastRouteIntent,
  getDraftBroadcastAmount,
  getDraftBroadcastUtxos,
  outpointKey,
  type RawBroadcastIntent,
  resolveSignedPsbtForBroadcast,
  type TransactionBroadcastBody,
} from './broadcastIntent';

const router = Router();
const log = createLogger('TX_BROADCAST:ROUTE');

type WalletRequest = Request & { walletId?: string };
type PsbtBroadcastBody = MobilePsbtBroadcastRequest;

const ACTIONABLE_BROADCAST_DRAFT_STATUSES = new Set<string>(ACTIONABLE_DRAFT_STATUS_VALUES);
const APPROVED_BROADCAST_APPROVAL_STATUSES = new Set(['not_required', 'approved']);
const APPROVAL_REJECTION_REASONS: Record<string, string> = {
  pending: 'pending_approval',
  rejected: 'approval_rejected',
  vetoed: 'approval_vetoed',
  expired: 'approval_expired',
};

/**
 * Resolve the wallet's broadcast network. Older wallet rows may store `testnet`
 * from before Testnet3/Testnet4 were split; those rows map to Testnet3.
 */
const resolveWalletNetwork = async (walletId: string): Promise<BitcoinNetwork> => {
  const network = await walletRepository.findNetwork(walletId);
  if (network === null) {
    throw new NotFoundError('Wallet not found', undefined, { walletId });
  }
  if (network === 'testnet') {
    return 'testnet3';
  }
  if (isBitcoinNetwork(network)) {
    return network;
  }
  throw new InvalidInputError('Wallet has unsupported Bitcoin network', 'network', { walletId, network });
};

const assertPolicyAllowsBroadcast = async (
  req: Request,
  walletId: string,
  recipient: string | undefined,
  amount: number | undefined,
  blockedMessage: string
): Promise<void> => {
  if (!recipient || !amount) return;

  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: requireAuthenticatedUser(req).userId,
    recipient,
    amount: BigInt(amount),
  });

  if (!policyResult.allowed) {
    log.warn(blockedMessage, {
      walletId,
      triggered: policyResult.triggered.map(t => t.policyName),
    });
    throw new ForbiddenError('Transaction blocked by vault policy');
  }
};

const loadBroadcastDraft = async (
  walletId: string,
  draftId: string | undefined
): Promise<BroadcastDraft | null> => {
  if (!draftId) return null;

  const draft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!draft) {
    throw new NotFoundError('Draft not found', undefined, { draftId });
  }

  assertDraftAllowsBroadcast(draft);
  return draft;
};

const assertDraftAllowsBroadcast = (draft: BroadcastDraft): void => {
  // Broadcast is the terminal side effect; approval and lifecycle gates must be
  // enforced before policy usage, audit success, or node submission can happen.
  if (!ACTIONABLE_BROADCAST_DRAFT_STATUSES.has(draft.status)) {
    throw new ConflictError('Draft is no longer actionable for broadcast', undefined, {
      draftId: draft.id,
      status: draft.status,
      reason: 'duplicate_submission',
    });
  }

  if (!APPROVED_BROADCAST_APPROVAL_STATUSES.has(draft.approvalStatus)) {
    const reason = APPROVAL_REJECTION_REASONS[draft.approvalStatus] ?? 'pending_approval';
    throw new ForbiddenError('Draft approval is required before broadcast', undefined, {
      draftId: draft.id,
      approvalStatus: draft.approvalStatus,
      reason,
    });
  }
};

const recordPolicyUsage = (
  walletId: string,
  req: Request,
  amount: number | undefined
): void => {
  if (!amount) return;

  policyEvaluationEngine.recordUsage(walletId, requireAuthenticatedUser(req).userId, BigInt(amount)).catch(err => {
    log.warn('Failed to record policy usage', { error: getErrorMessage(err) });
  });
};

const auditTransactionBroadcastSuccess = async (
  req: Request,
  walletId: string,
  details: Record<string, unknown>
): Promise<void> => {
  await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
    success: true,
    details: {
      walletId,
      ...details,
    },
  });
};

const auditTransactionBroadcastFailure = async (
  req: WalletRequest,
  error: unknown,
  details: Record<string, unknown>
): Promise<void> => {
  await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
    success: false,
    errorMsg: getErrorMessage(error),
    details: {
      walletId: req.walletId,
      ...details,
    },
  });
};

const pickDefinedBroadcastFields = <K extends keyof TransactionBroadcastBody>(
  body: TransactionBroadcastBody,
  fields: readonly K[]
): Partial<Pick<TransactionBroadcastBody, K>> => {
  return Object.fromEntries(
    fields.flatMap(field => body[field] === undefined ? [] : [[field, body[field]]])
  ) as Partial<Pick<TransactionBroadcastBody, K>>;
};

const pickDefinedMetadata = <T extends Record<string, unknown>>(values: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
};

// Raw-hex broadcasts must derive policy/audit metadata from the decoded
// transaction so callers cannot understate recipient, amount, fee, or inputs.
const assertUniqueOutpoints = (outpoints: BroadcastOutpoint[], field: string): void => {
  const keys = outpoints.map(outpointKey);
  if (new Set(keys).size === keys.length) return;

  throw new InvalidInputError('Raw transaction contains duplicate inputs', field, {
    reason: 'duplicate_inputs',
  });
};

const findMissingOutpoints = (
  requested: BroadcastOutpoint[],
  found: BroadcastOutpoint[]
): string[] => {
  const foundKeys = new Set(found.map(outpointKey));
  return requested.map(outpointKey).filter(key => !foundKeys.has(key));
};

const assertRawInputsBelongToWallet = (
  requested: BroadcastOutpoint[],
  found: BroadcastOutpoint[]
): void => {
  const missing = findMissingOutpoints(requested, found);
  if (missing.length === 0) return;

  throw new InvalidInputError('Raw transaction spends inputs not controlled by wallet', 'rawTxHex', {
    reason: 'unknown_inputs',
    missingOutpoints: missing,
  });
};

const assertDraftLocksAllowSpend = (
  draft: BroadcastDraft | null,
  utxos: Awaited<ReturnType<typeof findByOutpointsForWallet>>
): void => {
  const lockedByOtherDraft = utxos.find(utxo =>
    utxo.draftLock?.draftId && utxo.draftLock.draftId !== draft?.id
  );
  if (!lockedByOtherDraft) return;

  throw new ConflictError('Raw transaction spends UTXOs locked by another draft', undefined, {
    reason: 'utxo_locked',
    txid: lockedByOtherDraft.txid,
    vout: lockedByOtherDraft.vout,
    draftId: lockedByOtherDraft.draftLock?.draftId,
  });
};

const resolveRawRecipientAndAmount = (
  outputs: ReturnType<typeof parseTransaction>['outputs'],
  walletAddressSet: Set<string>
): { recipient: string; amount: number } => {
  const paidUnknownOutput = outputs.find(output => !output.address && output.value > 0);
  if (paidUnknownOutput) {
    throw new InvalidInputError('Raw transaction has paid output without a standard address', 'rawTxHex', {
      reason: 'unknown_paid_output',
      scriptPubKey: paidUnknownOutput.scriptPubKey,
    });
  }

  const externalOutputs = outputs.filter(output =>
    output.address && output.value > 0 && !walletAddressSet.has(output.address)
  );
  if (externalOutputs.length > 1) {
    // Policy evaluation currently models one external raw recipient; reject
    // multi-recipient raw hex until the policy contract can represent batches.
    throw new InvalidInputError('Raw transaction has multiple external recipients', 'rawTxHex', {
      reason: 'multiple_external_recipients',
      recipients: externalOutputs.map(output => output.address),
    });
  }

  if (externalOutputs[0]?.address) {
    return { recipient: externalOutputs[0].address, amount: externalOutputs[0].value };
  }

  // All-wallet outputs are consolidation/change-only transactions; no external
  // value leaves the wallet, so policy amount is zero while fees still apply.
  const ownOutput = outputs.find(output => output.address && walletAddressSet.has(output.address));
  if (ownOutput?.address) {
    return { recipient: ownOutput.address, amount: 0 };
  }

  throw new InvalidInputError('Raw transaction has no standard wallet or recipient outputs', 'rawTxHex', {
    reason: 'missing_standard_outputs',
  });
};

const buildRawInputMetadata = (
  inputOutpoints: BroadcastOutpoint[],
  utxos: Awaited<ReturnType<typeof findByOutpointsForWallet>>
): TransactionInputMetadata[] => {
  const utxosByOutpoint = new Map(utxos.map(utxo => [outpointKey(utxo), utxo]));
  return inputOutpoints.map(input => {
    const utxo = utxosByOutpoint.get(outpointKey(input));
    /* v8 ignore next 6 -- assertRawInputsBelongToWallet unconditionally validates every input first */
    if (!utxo) {
      throw new InvalidInputError('Raw transaction spends inputs not controlled by wallet', 'rawTxHex', {
        reason: 'unknown_inputs',
        missingOutpoints: [outpointKey(input)],
      });
    }
    return {
      txid: input.txid,
      vout: input.vout,
      address: utxo.address,
      amount: Number(utxo.amount),
    };
  });
};

const buildRawOutputMetadata = (
  outputs: ReturnType<typeof parseTransaction>['outputs'],
  recipient: string,
  walletAddressSet: Set<string>
): TransactionOutputMetadata[] => {
  // Downstream persistence uses this classification for audit/display. Paid
  // non-address outputs are rejected before metadata construction.
  return outputs.map(output => {
    const address = output.address ?? '';
    const isOurs = address.length > 0 && walletAddressSet.has(address);
    return {
      address,
      amount: output.value,
      outputType: address === recipient && !isOurs ? 'recipient' : isOurs ? 'change' : 'unknown',
      isOurs,
      scriptPubKey: output.scriptPubKey,
    };
  });
};

const assertNonNegativeFee = (fee: number): void => {
  if (fee >= 0) return;

  // Fee is inferred only after every decoded input has been matched to a wallet
  // UTXO, so total input value is known instead of caller supplied.
  throw new InvalidInputError('Raw transaction spends more than wallet input value', 'rawTxHex', {
    reason: 'negative_fee',
    fee,
  });
};

const parseRawTransactionForBroadcast = (
  rawTxHex: string,
  network: BitcoinNetwork
): ReturnType<typeof parseTransaction> => {
  try {
    return parseTransaction(rawTxHex, network);
  } catch (error) {
    throw new InvalidInputError('Invalid raw transaction hex', 'rawTxHex', {
      reason: 'invalid_raw_transaction',
      message: getErrorMessage(error),
    });
  }
};

const assertRawMetadataMatches = (
  body: TransactionBroadcastBody,
  draft: BroadcastDraft | null,
  intent: RawBroadcastIntent
): void => {
  assertMetadataFieldMatches('recipient', intent.recipient, body.recipient ?? draft?.recipient);
  assertMetadataFieldMatches('amount', intent.amount, body.amount ?? getDraftBroadcastAmount(draft));
  assertMetadataFieldMatches('fee', intent.fee, body.fee ?? (draft ? Number(draft.fee) : undefined));
  assertExactOutpointsMatch(intent.utxos, body.utxos, 'utxos');
  if (draft) {
    assertExactOutpointsMatch(intent.utxos, getDraftBroadcastUtxos(draft), 'draftId');
  }
};

const resolveRawBroadcastIntent = async (
  walletId: string,
  rawTxHex: string,
  network: BitcoinNetwork,
  body: TransactionBroadcastBody,
  draft: BroadcastDraft | null
): Promise<RawBroadcastIntent> => {
  const parsed = parseRawTransactionForBroadcast(rawTxHex, network);
  const inputOutpoints = parsed.inputs.map(input => ({ txid: input.txid, vout: input.vout }));
  assertUniqueOutpoints(inputOutpoints, 'rawTxHex');

  const [walletAddresses, walletUtxos] = await Promise.all([
    addressRepository.findAddressStrings(walletId),
    findByOutpointsForWallet(walletId, inputOutpoints),
  ]);
  assertRawInputsBelongToWallet(inputOutpoints, walletUtxos);
  assertDraftLocksAllowSpend(draft, walletUtxos);

  const totalInput = walletUtxos.reduce((sum, utxo) => sum + Number(utxo.amount), 0);
  const totalOutput = parsed.outputs.reduce((sum, output) => sum + output.value, 0);
  const fee = totalInput - totalOutput;
  assertNonNegativeFee(fee);

  const walletAddressSet = new Set(walletAddresses);
  const { recipient, amount } = resolveRawRecipientAndAmount(parsed.outputs, walletAddressSet);
  const intent = {
    recipient,
    amount,
    fee,
    utxos: inputOutpoints,
    inputs: buildRawInputMetadata(inputOutpoints, walletUtxos),
    outputs: buildRawOutputMetadata(parsed.outputs, recipient, walletAddressSet),
  };
  assertRawMetadataMatches(body, draft, intent);
  return intent;
};

const buildTransactionBroadcastMetadata = (
  body: TransactionBroadcastBody,
  network: BitcoinNetwork,
  draft: BroadcastDraft | null,
  canonicalIntent: CanonicalBroadcastRouteIntent
) => {
  return {
    network,
    recipient: canonicalIntent.recipient,
    amount: canonicalIntent.amount,
    fee: canonicalIntent.fee,
    ...pickDefinedMetadata({
      label: body.label ?? draft?.label ?? undefined,
      memo: body.memo ?? draft?.memo ?? undefined,
    }),
    utxos: canonicalIntent.utxos,
    ...(canonicalIntent.inputs && { inputs: canonicalIntent.inputs }),
    ...(canonicalIntent.outputs && { outputs: canonicalIntent.outputs }),
    ...(draft && { draftId: draft.id }),
    ...pickDefinedBroadcastFields(body, ['rawTxHex'] as const),
  };
};

const resolveCanonicalTransactionBroadcastIntent = async (
  walletId: string,
  body: TransactionBroadcastBody,
  network: BitcoinNetwork,
  draft: BroadcastDraft | null,
  signedPsbtBase64: string | undefined
): Promise<CanonicalBroadcastRouteIntent> => {
  if (body.rawTxHex) {
    return resolveRawBroadcastIntent(walletId, body.rawTxHex, network, body, draft);
  }

  /* v8 ignore next 5 -- assertBroadcastPayloadAvailable guards this internal invariant */
  if (!signedPsbtBase64) {
    throw new InvalidInputError('Broadcast payload could not be resolved', 'signedPsbtBase64', {
      reason: 'missing_intent',
    });
  }

  const intent = await buildSignedPsbtBroadcastIntent(
    walletId,
    signedPsbtBase64,
    network,
    'signedPsbtBase64'
  );
  assertSignedPsbtMetadataMatches(body, draft, intent);
  return intent;
};

const assertTransactionBroadcastPolicyAllows = async (
  req: WalletRequest,
  walletId: string,
  canonicalIntent: CanonicalBroadcastRouteIntent
): Promise<void> => {
  await assertPolicyAllowsBroadcast(
    req,
    walletId,
    canonicalIntent.amount > 0 ? canonicalIntent.recipient : undefined,
    canonicalIntent.amount > 0 ? canonicalIntent.amount : undefined,
    'Broadcast blocked by policy'
  );
};

const broadcastTransactionWithAudit = async (
  req: WalletRequest,
  walletId: string,
  body: TransactionBroadcastBody,
  draft: BroadcastDraft | null,
  signedPsbtBase64: string | undefined,
  metadata: ReturnType<typeof buildTransactionBroadcastMetadata>
) => {
  try {
    const result = await txService.broadcastAndSave(
      walletId,
      signedPsbtBase64,
      metadata
    );

    recordPolicyUsage(walletId, req, metadata.amount);
    await auditTransactionBroadcastSuccess(req, walletId, {
      txid: result.txid,
      draftId: draft?.id,
      recipient: metadata.recipient,
      amount: metadata.amount,
      fee: metadata.fee,
    });
    return result;
  } catch (error) {
    await auditTransactionBroadcastFailure(req, error, {
      draftId: draft?.id,
      recipient: body.recipient ?? draft?.recipient,
      amount: body.amount ?? getDraftBroadcastAmount(draft),
    });
    throw error;
  }
};

const handleTransactionBroadcast = async (
  req: WalletRequest,
  walletId: string,
  body: TransactionBroadcastBody
) => {
  const network = await resolveWalletNetwork(walletId);
  const draft = await loadBroadcastDraft(walletId, body.draftId);
  const signedPsbtBase64 = resolveSignedPsbtForBroadcast(body, draft);
  assertBroadcastPayloadAvailable(body, signedPsbtBase64, draft);

  const canonicalIntent = await resolveCanonicalTransactionBroadcastIntent(
    walletId,
    body,
    network,
    draft,
    signedPsbtBase64
  );
  await assertTransactionBroadcastPolicyAllows(req, walletId, canonicalIntent);

  const metadata = buildTransactionBroadcastMetadata(body, network, draft, canonicalIntent);
  return broadcastTransactionWithAudit(req, walletId, body, draft, signedPsbtBase64, metadata);
};

const handlePsbtBroadcast = async (
  req: WalletRequest,
  walletId: string,
  body: PsbtBroadcastBody
) => {
  const network = await resolveWalletNetwork(walletId);
  const intent = await buildSignedPsbtBroadcastIntent(walletId, body.signedPsbt, network, 'signedPsbt');

  await assertPolicyAllowsBroadcast(
    req,
    walletId,
    intent.recipient || undefined,
    intent.amount > 0 ? intent.amount : undefined,
    'PSBT broadcast blocked by policy'
  );

  try {
    const result = await txService.broadcastAndSave(walletId, body.signedPsbt, {
      recipient: intent.recipient,
      amount: intent.amount,
      fee: intent.fee,
      label: body.label,
      memo: body.memo,
      network,
      utxos: intent.utxos,
    });

    recordPolicyUsage(walletId, req, intent.amount > 0 ? intent.amount : undefined);
    await auditTransactionBroadcastSuccess(req, walletId, {
      txid: result.txid,
      recipient: intent.recipient,
      amount: intent.amount,
      fee: intent.fee,
    });

    return {
      txid: result.txid,
      broadcasted: result.broadcasted,
      persistenceStatus: result.persistenceStatus,
      ...(result.persistenceReason && { persistenceReason: result.persistenceReason }),
    };
  } catch (error) {
    /* v8 ignore start -- broadcast failure audit path is covered at service boundary */
    await auditTransactionBroadcastFailure(req, error, {});
    throw error;
    /* v8 ignore stop */
  }
};

/**
 * POST /api/v1/wallets/:walletId/transactions/broadcast
 * Broadcast a signed PSBT or raw transaction hex
 * Supports two signing workflows:
 * - signedPsbtBase64: Signed PSBT from Ledger or file upload
 * - rawTxHex: Raw transaction hex from Trezor (fully signed)
 */
router.post('/wallets/:walletId/transactions/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const body = parseTransactionRequestBody(MobileTransactionBroadcastRequestSchema, req.body);
  const result = await handleTransactionBroadcast(req, walletId, body);
  res.status(result.persistenceStatus === 'pending_reconciliation' ? 202 : 200).json(result);
}));

/**
 * POST /api/v1/wallets/:walletId/psbt/broadcast
 * Broadcast a signed PSBT
 */
router.post('/wallets/:walletId/psbt/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const body = parseTransactionRequestBody(MobilePsbtBroadcastRequestSchema, req.body);
  const result = await handlePsbtBroadcast(req, walletId, body);
  res.status(result.persistenceStatus === 'pending_reconciliation' ? 202 : 200).json(result);
}));

export default router;
