import { Router, type Request } from 'express';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';
import { canonicalSegwitAddressCase } from '@sanctuary/shared/utils/bitcoin';
import {
  MobilePsbtBroadcastRequestSchema,
  MobileTransactionBroadcastRequestSchema,
  type MobilePsbtBroadcastRequest,
  type MobileTransactionBroadcastRequest,
} from '@sanctuary/shared/schemas/mobileApiRequests';
import { draftRepository } from '../../repositories/draftRepository';
import { walletRepository } from '../../repositories/walletRepository';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { requireAuthenticatedUser } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { policyEvaluationEngine, type PolicyEvaluationResult } from '../../services/vaultPolicy';
import type { UsageReservation } from '../../services/vaultPolicy/policyEvaluationEngine';
import { requiresEnforcedApproval } from '../../services/vaultPolicy/intentPolicyInput';
import {
  validateSignedArtifact,
  findDraftBySigningIntent,
  deriveIntentSpend,
  findHeldPolicyReservations,
  type SigningIntentHandle,
  type ValidatedBroadcastArtifact,
} from '../../services/bitcoin/signingIntent';
import {
  broadcastAndSave,
  PreNetworkBroadcastRejectionError,
  readBroadcastFailureTag,
} from '../../services/bitcoin/transactions/broadcasting';
import { findVerifiedReplacement, selectCandidateOutpoints } from '../../services/bitcoin/transactions/replacementLink';
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
      approvalStatus: draft.approvalStatus,
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

interface CanonicalRouteMetadata {
  recipient: string;
  amount: number;
  fee: number;
  utxos: BroadcastOutpoint[];
  inputs: TransactionInputMetadata[];
  outputs: TransactionOutputMetadata[];
  externalOutputs: Array<{ address: string; amount: number }>;
  /** The RBF replacement txid from the authenticated snapshot, when it has one. */
  replacementTxid?: string;
}

const buildCanonicalMetadata = async (
  artifact: ValidatedBroadcastArtifact,
): Promise<CanonicalRouteMetadata> => {
  const { inputs, outputs, externalOutputs, amount, replacementTxid } = await deriveIntentSpend(
    artifact.walletId,
    artifact.network,
    artifact.snapshot,
  );
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
    amount,
    fee,
    utxos: inputs.map(({ txid, vout }) => ({ txid, vout })),
    inputs,
    outputs,
    externalOutputs,
    ...(replacementTxid && { replacementTxid }),
  };
};

/**
 * The txid this broadcast replaces. The authenticated snapshot is the
 * authority: a resumed approval-required bump (Drafts → Resume) sends no
 * `replacesTxid`, and a request value that disagrees with the snapshot is
 * refused rather than trusted. The request field is used only for legacy
 * intents whose snapshot carries none.
 */
const resolveReplacesTxid = (
  metadata: CanonicalRouteMetadata,
  requested: string | undefined,
): string | undefined => {
  if (!metadata.replacementTxid) return requested;
  if (requested !== undefined && requested !== metadata.replacementTxid) {
    throw new InvalidInputError('Broadcast metadata does not match signing intent', 'replacesTxid', {
      reason: 'metadata_mismatch',
    });
  }
  return metadata.replacementTxid;
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

/**
 * The reported recipient in the decoded (lowercase) form: an all-uppercase bech32 address
 * (QR alphanumeric mode, or a draft saved before the client normalised it) names the same
 * script. Mixed-case bech32 and base58 compare as given, so a case change there still mismatches.
 */
const canonicalReportedRecipient = (recipient: string | undefined): string | undefined => (
  recipient === undefined ? undefined : canonicalSegwitAddressCase(recipient)
);

const assertOptionalMetadata = (
  optional: OptionalBroadcastMetadata,
  draft: BroadcastDraft,
  metadata: CanonicalRouteMetadata,
): void => {
  // With no external output nothing leaves the wallet, so the client/draft-reported
  // recipient and amount carry no spend meaning (e.g. a consolidation reports the sum of its own outputs).
  const spendChecks: Array<[string, unknown, unknown]> = metadata.externalOutputs.length === 0 ? [] : [
    ['recipient', metadata.recipient, canonicalReportedRecipient(optional.recipient ?? draft?.recipient)],
    ['amount', metadata.amount, optional.amount ?? (draft ? Number(draft.effectiveAmount) : undefined)],
  ];
  const checks: Array<[string, unknown, unknown]> = [
    ...spendChecks,
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

/** Usage reserved for this broadcast; `held` reservations belong to an earlier attempt of the same intent. */
interface PolicyUsageHold {
  reservations: UsageReservation[];
  held: boolean;
}

const NO_POLICY_USAGE: PolicyUsageHold = { reservations: [], held: false };

const resolveReplacementContext = async (
  walletId: string,
  metadata: CanonicalRouteMetadata,
  replacesTxid: string | undefined,
): Promise<{ replacedAmount?: bigint; isReplacementBump?: boolean }> => {
  if (!replacesTxid) return {};
  const replacement = await findVerifiedReplacement(
    walletId,
    replacesTxid,
    selectCandidateOutpoints(metadata.inputs, metadata.utxos),
    undefined,
  );
  return replacement ? { replacedAmount: replacement.amount, isReplacementBump: true } : {};
};

/**
 * An enforce-mode approval_required policy authorizes a spend only through a
 * draft approved for THIS signing intent: a draft with a null or different
 * signingIntentId (legacy rows) approved some other spend. Drafts that reach
 * here are `not_required` or `approved` (assertDraftAllowsBroadcast refuses
 * every other status first); monitor-mode policies report `monitored` and
 * stay informational.
 */
const assertApprovalSatisfied = (
  result: PolicyEvaluationResult,
  draft: BroadcastDraft,
  intentId: string,
): void => {
  if (!requiresEnforcedApproval(result)) return;
  if (draft?.approvalStatus === 'approved' && draft.signingIntentId === intentId) return;
  throw new ForbiddenError('Vault policy requires an approved draft before broadcast', undefined, {
    reason: 'approval_required',
    draftId: draft?.id,
  });
};

/**
 * Evaluate policies for this broadcast and, for every enforce-mode
 * spending_limit/velocity policy, reserve its usage windows atomically
 * BEFORE broadcastAndSave. A lost reservation (concurrent broadcast already
 * consumed the remaining headroom) blocks the same as any other triggered
 * policy. Fresh reservations are released by the caller only under the
 * release rule in releaseReservationsOnFailure. An enforce-mode
 * approval_required trigger refuses a spend without an approved draft.
 *
 * A retry of an earlier attempt whose outcome is unknown reuses the
 * reservations that attempt persisted on the intent
 * (findHeldPolicyReservations) instead of reserving again: it is the same
 * transaction, so it is still evaluated, as a bump of its own amount
 * (velocity skips it), and returned as `held`.
 *
 * When `replacesTxid` names a verified RBF replacement (the same
 * shared-input check `assertReplacementLink` uses, via
 * `findVerifiedReplacement`), `replacedAmount`/`isReplacementBump` are
 * threaded into both `evaluatePolicies` and `reserveEnforcedUsage` so a
 * bump's incremental amount is evaluated/reserved against spending-limit
 * windows and velocity is left untouched — the bump is the same logical
 * transaction as the original, whose reservation stays held
 * (rbf-fee-bump-double-reserves-policy-usage-window). `evaluatePolicies` is
 * still called with the FULL amount: per-transaction and approval-required
 * thresholds are authorization checks on the transaction's real value and
 * must not be weakened by reframing a bump as its delta — only its
 * internal rolling-window comparison uses the reduced amount. An
 * unverifiable `replacesTxid` is treated as a fresh broadcast here;
 * `broadcastAndSave` still rejects it via `assertReplacementLink` before
 * anything is transmitted.
 */
const reservePolicyUsage = async (
  req: Request,
  artifact: ValidatedBroadcastArtifact,
  metadata: CanonicalRouteMetadata,
  replacesTxid: string | undefined,
  draft: BroadcastDraft,
): Promise<PolicyUsageHold> => {
  if (metadata.externalOutputs.length === 0) return NO_POLICY_USAGE;
  const walletId = artifact.walletId;
  const userId = requireAuthenticatedUser(req).userId;
  const amount = BigInt(metadata.amount);

  const held = await findHeldPolicyReservations(artifact.intent.intentId, artifact.txid);
  const replacementContext = held
    ? { replacedAmount: amount, isReplacementBump: true }
    : await resolveReplacementContext(walletId, metadata, replacesTxid);

  const result = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId,
    recipient: metadata.externalOutputs[0].address,
    amount,
    outputs: metadata.externalOutputs,
    ...replacementContext,
  });
  if (!result.allowed) throw new ForbiddenError('Transaction blocked by vault policy');
  assertApprovalSatisfied(result, draft, artifact.intent.intentId);
  if (held) return { reservations: held, held: true };

  const reservation = await policyEvaluationEngine.reserveEnforcedUsage({
    walletId,
    userId,
    amount,
    ...replacementContext,
  });
  if (!reservation.ok) throw new ForbiddenError('Transaction blocked by vault policy');
  return { reservations: reservation.reservations, held: false };
};

const auditFailure = async (req: WalletRequest, error: unknown): Promise<void> => {
  await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
    success: false,
    errorMsg: getErrorMessage(error),
    details: { walletId: req.walletId },
  });
};

/**
 * Whether a failure proves that fresh reservations no longer stand for a
 * transaction that may have gone out. broadcastAndSave tags its failures with
 * what it did to the intent: release when no claim was taken (hardware
 * refusal, busy or conflicting claim), or when a first (`ready`) claim was
 * actually returned to `ready` (a definite rejection, a replacesTxid mismatch).
 * A resumed claim stays `unknown` and a failed rollback leaves the intent
 * claimed, so both keep the reservation. An untagged error is retained (fail
 * safe: over-count, never under-count a real spend), except an untagged
 * PreNetworkBroadcastRejectionError, which by construction precedes any claim.
 */
const failureReleasesFreshReservations = (error: unknown): boolean => {
  const tag = readBroadcastFailureTag(error);
  if (!tag) return error instanceof PreNetworkBroadcastRejectionError;
  return !tag.claimed || (tag.priorState === 'ready' && tag.releasedToReady);
};

/** Held (reused) reservations are never released here: they count an earlier attempt that may have gone out. */
const releaseReservationsOnFailure = async (
  usage: PolicyUsageHold,
  error: unknown,
): Promise<void> => {
  if (usage.held || usage.reservations.length === 0) return;
  if (!failureReleasesFreshReservations(error)) return;
  try {
    await policyEvaluationEngine.releasePolicyUsage(usage.reservations);
  } catch (releaseError) {
    log.error('Failed to release policy usage reservation', { error: getErrorMessage(releaseError) });
    return;
  }
};

const recordMonitorUsage = async (req: WalletRequest, artifact: ValidatedBroadcastArtifact, metadata: CanonicalRouteMetadata): Promise<void> => {
  if (metadata.amount <= 0 || artifact.broadcastReplay) return;
  try {
    await policyEvaluationEngine.recordUsage(
      artifact.walletId,
      requireAuthenticatedUser(req).userId,
      BigInt(metadata.amount),
    );
  } catch (error) {
    log.warn('Failed to record policy usage', { error: getErrorMessage(error) });
    return;
  }
};

const broadcastValidated = async (
  req: WalletRequest,
  artifact: ValidatedBroadcastArtifact,
  metadata: CanonicalRouteMetadata,
  draft: BroadcastDraft,
  labels: { label?: string | null; memo?: string | null; replacesTxid?: string | null },
  usage: PolicyUsageHold,
) => {
  const durableMetadata = {
    recipient: metadata.recipient,
    amount: metadata.amount,
    fee: metadata.fee,
    utxos: metadata.utxos,
    inputs: metadata.inputs,
    outputs: metadata.outputs,
    ...(labels.label != null && { label: labels.label }),
    ...(labels.memo != null && { memo: labels.memo }),
    ...(labels.replacesTxid != null && { replacesTxid: labels.replacesTxid }),
    ...(draft && { draftId: draft.id }),
    // Every claim re-persists the reservations, held or fresh.
    policyReservations: usage.reservations.map(({ windowId, amount }) => ({ windowId, amount: amount.toString() })),
  };
  try {
    // A reusing retry may only resume the earlier attempt: if that attempt was
    // released back to `ready` (and its reservations with it), the claim fails
    // before the network instead of broadcasting with nothing reserved.
    const result = usage.held
      ? await broadcastAndSave(artifact, durableMetadata, { resumeOnly: true })
      : await broadcastAndSave(artifact, durableMetadata);
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
      success: true,
      details: { walletId: artifact.walletId, txid: result.txid, intentId: artifact.intent.intentId },
    });
    // Enforce-mode spending_limit/velocity usage was already recorded at
    // reservation time (reservePolicyUsage, before broadcastAndSave); the
    // reservation IS the record, so it is not recorded again here.
    // Monitor-mode policies never reserve and still need it.
    await recordMonitorUsage(req, artifact, metadata);
    return result;
  } catch (error) {
    await auditFailure(req, error);
    await releaseReservationsOnFailure(usage, error);
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
  // replacesTxid is not a persisted draft column (see
  // CreateDraftRequest.replacesTxid in src/api/drafts.ts); a resumed RBF draft
  // links through the signing intent's snapshot instead.
  const replacesTxid = resolveReplacesTxid(metadata, body.replacesTxid);
  const usage = artifact.broadcastReplay
    ? NO_POLICY_USAGE
    : await reservePolicyUsage(req, artifact, metadata, replacesTxid, authoritativeDraft);
  return broadcastValidated(req, artifact, metadata, authoritativeDraft, {
    label: body.label ?? authoritativeDraft?.label,
    memo: body.memo ?? authoritativeDraft?.memo,
    replacesTxid,
  }, usage);
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
  const replacesTxid = resolveReplacesTxid(metadata, body.replacesTxid);
  const usage = artifact.broadcastReplay
    ? NO_POLICY_USAGE
    : await reservePolicyUsage(req, artifact, metadata, replacesTxid, authoritativeDraft);
  return broadcastValidated(req, artifact, metadata, authoritativeDraft, {
    label: body.label ?? authoritativeDraft?.label,
    memo: body.memo ?? authoritativeDraft?.memo,
    replacesTxid,
  }, usage);
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
