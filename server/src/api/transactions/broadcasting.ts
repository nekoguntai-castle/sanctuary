import { Router, type Request } from 'express';
import * as bitcoin from 'bitcoinjs-lib';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';
import {
  MobilePsbtBroadcastRequestSchema,
  MobileTransactionBroadcastRequestSchema,
  type MobilePsbtBroadcastRequest,
  type MobileTransactionBroadcastRequest,
} from '@sanctuary/shared/schemas/mobileApiRequests';
import { addressRepository } from '../../repositories/addressRepository';
import { draftRepository } from '../../repositories/draftRepository';
import { walletRepository } from '../../repositories/walletRepository';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { requireAuthenticatedUser } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { policyEvaluationEngine } from '../../services/vaultPolicy';
import { getNetwork } from '../../services/bitcoin/utils';
import {
  validateSignedArtifact,
  findDraftBySigningIntent,
  type SigningIntentHandle,
  type ValidatedBroadcastArtifact,
} from '../../services/bitcoin/signingIntent';
import { broadcastAndSave } from '../../services/bitcoin/transactions/broadcasting';
import type {
  TransactionInputMetadata,
  TransactionOutputMetadata,
} from '../../services/bitcoin/transactions/types';
import { parseTransactionRequestBody } from './requestValidation';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const router = Router();
const log = createLogger('TX_BROADCAST:ROUTE');
type WalletRequest = Request & { walletId?: string };
type BroadcastDraft = Awaited<ReturnType<typeof draftRepository.findByIdInWallet>>;
type BroadcastOutpoint = { txid: string; vout: number };

const ACTIONABLE_STATUSES = new Set<string>(ACTIONABLE_DRAFT_STATUS_VALUES);
const APPROVED_STATUSES = new Set(['not_required', 'approved']);

const assertDraftAllowsBroadcast = (draft: NonNullable<BroadcastDraft>): void => {
  if (!ACTIONABLE_STATUSES.has(draft.status)) {
    throw new ConflictError('Draft is no longer actionable for broadcast', undefined, {
      reason: 'duplicate_submission',
      draftId: draft.id,
    });
  }
  if (!APPROVED_STATUSES.has(draft.approvalStatus)) {
    throw new ForbiddenError('Draft approval is required before broadcast', undefined, {
      reason: draft.approvalStatus === 'rejected' ? 'approval_rejected' : 'pending_approval',
      draftId: draft.id,
    });
  }
};

const loadDraft = async (walletId: string, draftId?: string): Promise<BroadcastDraft> => {
  if (!draftId) return null;
  const draft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!draft) throw new NotFoundError('Draft not found', undefined, { draftId });
  return draft;
};

const resolveAuthoritativeDraft = async (
  walletId: string,
  artifact: ValidatedBroadcastArtifact,
  callerDraft: BroadcastDraft,
): Promise<BroadcastDraft> => {
  const linkedDraft = await findDraftBySigningIntent(
    walletId,
    artifact.intent.intentId,
  );
  if (linkedDraft && callerDraft && linkedDraft.id !== callerDraft.id) {
    throw new InvalidInputError('Request draft does not match the signing intent', 'draftId', {
      reason: 'metadata_mismatch',
    });
  }
  return linkedDraft ?? callerDraft;
};

const assertDraftIntentMatchesRequest = (
  body: { intentId?: string; intentDigest?: string },
  draft: BroadcastDraft,
): void => {
  if (draft?.signingIntentId && body.intentId && draft.signingIntentId !== body.intentId) {
    throw new InvalidInputError('Draft signing intent does not match request', 'intentId', {
      reason: 'metadata_mismatch',
    });
  }
  if (draft?.signingIntentDigest && body.intentDigest
    && draft.signingIntentDigest !== body.intentDigest) {
    throw new InvalidInputError('Draft signing intent digest does not match request', 'intentDigest', {
      reason: 'metadata_mismatch',
    });
  }
};

const resolveIntentHandle = (
  body: { intentId?: string; intentDigest?: string },
  draft: BroadcastDraft,
): SigningIntentHandle => {
  /* v8 ignore next -- request schema requires paired fields; draft fallback is covered below */
  const intentId = body.intentId ?? draft?.signingIntentId ?? undefined;
  /* v8 ignore next -- request schema requires paired fields; draft fallback is covered below */
  const intentDigest = body.intentDigest ?? draft?.signingIntentDigest ?? undefined;
  if (!intentId || !intentDigest) {
    throw new InvalidInputError('A server-issued signing intent is required', 'intentId', {
      reason: 'missing_intent',
    });
  }
  assertDraftIntentMatchesRequest(body, draft);
  return { intentId, intentDigest };
};

const resolveTransactionPayload = (
  body: MobileTransactionBroadcastRequest,
  draft: BroadcastDraft,
): { signedPsbtBase64?: string; rawTxHex?: string } => {
  if (body.signedPsbtBase64) return { signedPsbtBase64: body.signedPsbtBase64 };
  if (body.rawTxHex) return { rawTxHex: body.rawTxHex };
  if (draft?.signedPsbtBase64) return { signedPsbtBase64: draft.signedPsbtBase64 };
  throw new InvalidInputError('A signed transaction artifact is required', 'signedPsbtBase64', {
    reason: 'missing_witness_data',
  });
};

const decodeAddress = (scriptHex: string, network: ValidatedBroadcastArtifact['network']): string => {
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(scriptHex, 'hex'), getNetwork(network));
  } catch {
    return '';
  }
};

interface CanonicalRouteMetadata {
  recipient: string;
  amount: number;
  fee: number;
  utxos: BroadcastOutpoint[];
  inputs: TransactionInputMetadata[];
  outputs: TransactionOutputMetadata[];
  externalOutputs: Array<{ address: string; amount: number }>;
}

const safeSats = (value: string, field: string): number => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new InvalidInputError('Signing intent amount is invalid', field, {
      reason: 'unknown_input_value',
    });
  }
  return amount;
};

const buildCanonicalMetadata = async (
  artifact: ValidatedBroadcastArtifact,
): Promise<CanonicalRouteMetadata> => {
  const walletAddresses = new Set(await addressRepository.findAddressStrings(artifact.walletId));
  const inputs = artifact.snapshot.transaction.inputs.map((input, index) => ({
    txid: input.txid,
    vout: input.vout,
    address: decodeAddress(input.prevout.scriptPubKeyHex, artifact.network),
    amount: safeSats(input.prevout.amountSats, `inputs.${index}.amountSats`),
  }));
  const outputs = artifact.snapshot.transaction.outputs.map((output, index) => {
    const address = decodeAddress(output.scriptPubKeyHex, artifact.network);
    const amount = safeSats(output.amountSats, `outputs.${index}.amountSats`);
    const isOurs = address.length > 0 && walletAddresses.has(address);
    return {
      address,
      amount,
      outputType: isOurs ? 'change' as const : address ? 'recipient' as const : 'unknown' as const,
      isOurs,
      scriptPubKey: output.scriptPubKeyHex,
    };
  });
  const paidUnknown = outputs.find(output => !output.address && output.amount > 0);
  if (paidUnknown) {
    throw new InvalidInputError('Paid output uses an unsupported script', 'outputs', {
      reason: 'unsupported_script',
      scriptPubKey: paidUnknown.scriptPubKey,
    });
  }
  const externalOutputs = outputs
    .filter(output => !output.isOurs && output.address && output.amount > 0)
    .map(output => ({ address: output.address, amount: output.amount }));
  const totalInput = inputs.reduce((sum, input) => sum + input.amount, 0);
  const totalOutput = outputs.reduce((sum, output) => sum + output.amount, 0);
  const fee = totalInput - totalOutput;
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new InvalidInputError('Signing intent fee is invalid', 'fee', {
      reason: 'unknown_input_value',
    });
  }
  return {
    recipient: externalOutputs[0]?.address ?? outputs.find(output => output.address)?.address ?? '',
    amount: externalOutputs.reduce((sum, output) => sum + output.amount, 0),
    fee,
    utxos: inputs.map(({ txid, vout }) => ({ txid, vout })),
    inputs,
    outputs,
    externalOutputs,
  };
};

const assertExactOutpoints = (
  expected: BroadcastOutpoint[],
  actual: BroadcastOutpoint[] | undefined,
  field: string,
): void => {
  if (actual === undefined) return;
  const matches = expected.length === actual.length && expected.every((item, index) => (
    item.txid === actual[index].txid.toLowerCase() && item.vout === actual[index].vout
  ));
  if (!matches) {
    throw new InvalidInputError('Broadcast metadata does not match signing intent', field, {
      reason: 'metadata_mismatch',
    });
  }
};

type OptionalBroadcastMetadata = {
  recipient?: string;
  amount?: number;
  fee?: number;
  utxos?: BroadcastOutpoint[];
};

const assertOptionalMetadata = (
  optional: OptionalBroadcastMetadata,
  draft: BroadcastDraft,
  metadata: CanonicalRouteMetadata,
): void => {
  const checks: Array<[string, unknown, unknown]> = [
    ['recipient', metadata.recipient, optional.recipient ?? draft?.recipient],
    ['amount', metadata.amount, optional.amount ?? (draft ? Number(draft.effectiveAmount) : undefined)],
    ['fee', metadata.fee, optional.fee ?? (draft ? Number(draft.fee) : undefined)],
  ];
  for (const [field, expected, actual] of checks) {
    if (actual !== undefined && actual !== expected) {
      throw new InvalidInputError('Broadcast metadata does not match signing intent', field, {
        reason: 'metadata_mismatch', expected, actual,
      });
    }
  }
  assertExactOutpoints(metadata.utxos, optional.utxos, 'utxos');
  if (draft) {
    const outpoints = draft.selectedUtxoIds.map(value => {
      const [txid, rawVout] = value.split(':');
      return { txid, vout: Number(rawVout) };
    });
    assertExactOutpoints(metadata.utxos, outpoints, 'draftId');
  }
};

const assertPolicyAllows = async (
  req: Request,
  walletId: string,
  metadata: CanonicalRouteMetadata,
): Promise<void> => {
  if (metadata.externalOutputs.length === 0) return;
  const result = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: requireAuthenticatedUser(req).userId,
    recipient: metadata.externalOutputs[0].address,
    amount: BigInt(metadata.amount),
    outputs: metadata.externalOutputs,
  });
  if (!result.allowed) throw new ForbiddenError('Transaction blocked by vault policy');
};

const auditFailure = async (req: WalletRequest, error: unknown): Promise<void> => {
  await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
    success: false,
    errorMsg: getErrorMessage(error),
    details: { walletId: req.walletId },
  });
};

const broadcastValidated = async (
  req: WalletRequest,
  artifact: ValidatedBroadcastArtifact,
  metadata: CanonicalRouteMetadata,
  draft: BroadcastDraft,
  labels: { label?: string | null; memo?: string | null },
) => {
  try {
    const result = await broadcastAndSave(artifact, {
      recipient: metadata.recipient,
      amount: metadata.amount,
      fee: metadata.fee,
      utxos: metadata.utxos,
      inputs: metadata.inputs,
      outputs: metadata.outputs,
      ...(labels.label != null && { label: labels.label }),
      ...(labels.memo != null && { memo: labels.memo }),
      ...(draft && { draftId: draft.id }),
    });
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
      success: true,
      details: { walletId: artifact.walletId, txid: result.txid, intentId: artifact.intent.intentId },
    });
    if (metadata.amount > 0 && !artifact.broadcastReplay) {
      policyEvaluationEngine.recordUsage(
        artifact.walletId,
        requireAuthenticatedUser(req).userId,
        BigInt(metadata.amount),
      ).catch(error => log.warn('Failed to record policy usage', { error: getErrorMessage(error) }));
    }
    return result;
  } catch (error) {
    await auditFailure(req, error);
    throw error;
  }
};

const handleTransactionBroadcast = async (
  req: WalletRequest,
  walletId: string,
  body: MobileTransactionBroadcastRequest,
) => {
  const draft = await loadDraft(walletId, body.draftId);
  const handle = resolveIntentHandle(body, draft);
  const artifact = await validateSignedArtifact({
    walletId,
    ...handle,
    ...resolveTransactionPayload(body, draft),
    ...(draft && { draftId: draft.id }),
  });
  const authoritativeDraft = await resolveAuthoritativeDraft(walletId, artifact, draft);
  if (authoritativeDraft && !artifact.broadcastReplay) assertDraftAllowsBroadcast(authoritativeDraft);
  const walletNetwork = await walletRepository.findNetwork(walletId);
  if (walletNetwork !== artifact.network && !(walletNetwork === 'testnet' && artifact.network === 'testnet3')) {
    throw new InvalidInputError('Signing intent network does not match wallet', 'network', {
      reason: 'wrong_network',
    });
  }
  const metadata = await buildCanonicalMetadata(artifact);
  assertOptionalMetadata(
    { recipient: body.recipient, amount: body.amount, fee: body.fee, utxos: body.utxos },
    authoritativeDraft,
    metadata,
  );
  if (!artifact.broadcastReplay) await assertPolicyAllows(req, walletId, metadata);
  return broadcastValidated(req, artifact, metadata, authoritativeDraft, {
    label: body.label ?? authoritativeDraft?.label,
    memo: body.memo ?? authoritativeDraft?.memo,
  });
};

const handlePsbtBroadcast = async (
  req: WalletRequest,
  walletId: string,
  body: MobilePsbtBroadcastRequest,
) => {
  const artifact = await validateSignedArtifact({
    walletId,
    intentId: body.intentId,
    intentDigest: body.intentDigest,
    signedPsbtBase64: body.signedPsbt,
  });
  const authoritativeDraft = await resolveAuthoritativeDraft(walletId, artifact, null);
  if (authoritativeDraft && !artifact.broadcastReplay) assertDraftAllowsBroadcast(authoritativeDraft);
  const metadata = await buildCanonicalMetadata(artifact);
  assertOptionalMetadata({}, authoritativeDraft, metadata);
  if (!artifact.broadcastReplay) await assertPolicyAllows(req, walletId, metadata);
  return broadcastValidated(req, artifact, metadata, authoritativeDraft, {
    label: body.label ?? authoritativeDraft?.label,
    memo: body.memo ?? authoritativeDraft?.memo,
  });
};

router.post('/wallets/:walletId/transactions/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const body = parseTransactionRequestBody(MobileTransactionBroadcastRequestSchema, req.body);
  const result = await handleTransactionBroadcast(req, walletId, body);
  res.status(result.persistenceStatus === 'pending_reconciliation' ? 202 : 200).json(result);
}));

router.post('/wallets/:walletId/psbt/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const body = parseTransactionRequestBody(MobilePsbtBroadcastRequestSchema, req.body);
  const result = await handlePsbtBroadcast(req, walletId, body);
  res.status(result.persistenceStatus === 'pending_reconciliation' ? 202 : 200).json(result);
}));

export default router;
