/**
 * Approval Service
 *
 * Business logic for the approval workflow:
 * - Creating approval requests when policies trigger
 * - Recording votes (approve/reject/veto)
 * - Resolving approval requests
 * - Owner override
 * - Expiring overdue requests
 */

import type { ApprovalRequest, ApprovalVote } from '../../generated/prisma/client';
import type { PrismaTxClient } from '../../models/prisma';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/constants/drafts';
import { policyRepository } from '../../repositories/policyRepository';
import type { PolicyDbClient } from '../../repositories/policyRepository';
import { draftRepository } from '../../repositories/draftRepository';
import type { DraftDbClient } from '../../repositories/draftRepository';
import { RESOLVED_APPROVAL_STATUSES } from '../../repositories/approvalStatuses';
import { draftLockRepository } from '../../repositories/draftLockRepository';
import type { EffectiveApproverDbClient } from '../../repositories/walletSharingRepository';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError } from '../../errors';
import { createLogger } from '../../utils/logger';
import { getErrorMessage, isUniqueConstraintError } from '../../utils/errors';
import { notifyApprovalResolved } from './approvalNotifications';
import {
  checkAllQuorumMet,
  checkAnyNQuorumMet,
  checkSpecificQuorumMet,
  getEligibleApproverIds,
  isEligibleSpecificApprover,
} from './approvalQuorum';
import { isSelfApprovalBlocked } from './approvalVoteGuards';
import type {
  ApprovalRequiredConfig,
  VoteDecision,
  ApprovalRequestStatus,
  PolicyEvaluationResult,
} from './types';

export { isEligibleSpecificApprover };

const log = createLogger('VAULT_POLICY:SVC_APPROVAL');

type ApprovalRequestWithVotes = ApprovalRequest & { votes: ApprovalVote[] };
type ApprovalDraft = Awaited<ReturnType<typeof draftRepository.findById>>;
export type ApprovalDbClient = DraftDbClient & PolicyDbClient & EffectiveApproverDbClient;

/**
 * Narrow a policy's stored config (Prisma JSON) to ApprovalRequiredConfig
 * before it is used to build an approval request. Only a policy whose
 * triggered `type` is 'approval_required' should reach this call, but the
 * config is untyped JSON at rest — this guard is the last line of defense
 * against a config shape (e.g. a time-delay policy's TimeDelayConfig, which
 * has no `requiredApprovals`) reaching `policyRepository.createApprovalRequest`,
 * whose `requiredApprovals` column is non-nullable.
 */
const isApprovalRequiredConfig = (config: unknown): config is ApprovalRequiredConfig =>
  typeof config === 'object' &&
  config !== null &&
  typeof (config as Record<string, unknown>).requiredApprovals === 'number' &&
  typeof (config as Record<string, unknown>).quorumType === 'string' &&
  typeof (config as Record<string, unknown>).allowSelfApproval === 'boolean' &&
  typeof (config as Record<string, unknown>).trigger === 'object' &&
  (config as Record<string, unknown>).trigger !== null;

// ========================================
// CREATE APPROVAL REQUESTS
// ========================================

/**
 * Create approval requests for a draft based on triggered policies.
 * Called when policy evaluation returns approval_required triggers.
 */
export async function createApprovalRequestsForDraft(
  draftId: string,
  walletId: string,
  createdByUserId: string,
  triggeredPolicies: PolicyEvaluationResult['triggered'],
  client?: ApprovalDbClient
): Promise<ApprovalRequest[]> {
  // Belt and braces: only 'approval_required'-type policies ever carry an
  // ApprovalRequiredConfig shape (requiredApprovals/quorumType). Checking
  // the action alone is not enough — a differently-typed policy (e.g. a
  // time-delay policy) must never reach the cast below even if its action
  // were ever mislabeled upstream.
  const approvalPolicies = triggeredPolicies.filter(
    t => t.action === 'approval_required' && t.type === 'approval_required'
  );

  if (approvalPolicies.length === 0) {
    return [];
  }

  const requests: ApprovalRequest[] = [];

  for (const triggered of approvalPolicies) {
    const policy = client !== undefined
      ? await policyRepository.findPolicyById(triggered.policyId, client)
      : await policyRepository.findPolicyById(triggered.policyId);
    if (!policy) continue;

    if (!isApprovalRequiredConfig(policy.config)) {
      // Fail closed: an approval_required policy with a malformed config is
      // the exact control this path enforces. Skipping it would let the
      // draft proceed with no approval request at all, silently defeating
      // the policy. Abort draft creation with a 4xx instead of letting the
      // caller hit a Prisma 500 on the non-nullable requiredApprovals column.
      throw new InvalidInputError(
        'Approval-required policy has an invalid configuration',
        'policyId',
        { policyId: triggered.policyId }
      );
    }

    const config = policy.config;

    // Calculate expiration
    let expiresAt: Date | undefined;
    if (config.expirationHours > 0) {
      expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + config.expirationHours);
    }

    // 'all' quorum requires every currently eligible wallet approver, not the
    // admin-typed count on the policy — derive it from live wallet membership
    // so the stored count reflects reality at creation time. Resolution
    // re-derives membership again (see checkAndResolveRequest) so a later
    // membership change is still honored correctly.
    const requiredApprovals = config.quorumType === 'all'
      ? (await getEligibleApproverIds(walletId, createdByUserId, config.allowSelfApproval, client)).length
      : config.requiredApprovals;

    const requestData = {
      draftTransactionId: draftId,
      policyId: triggered.policyId,
      requiredApprovals,
      quorumType: config.quorumType,
      allowSelfApproval: config.allowSelfApproval,
      expiresAt,
    };

    const request = client !== undefined
      ? await policyRepository.createApprovalRequest(requestData, client)
      : await policyRepository.createApprovalRequest(requestData);

    requests.push(request);

    log.info('Created approval request', {
      requestId: request.id,
      draftId,
      policyId: triggered.policyId,
      requiredApprovals,
    });
  }

  // Zero requests here only means every triggering policy was deleted between
  // evaluation and now (a failed request write throws above, failing closed).
  // With the policies gone there is nothing to vote on, so don't leave it pending.
  await updateDraftApprovalStatus(draftId, requests.length > 0 ? 'pending' : 'not_required', client);

  return requests;
}

// ========================================
// VOTE ON APPROVAL REQUESTS
// ========================================

type CastVoteTxOutcome =
  | { kind: 'expired' }
  | {
      kind: 'voted';
      vote: ApprovalVote;
      request: ApprovalRequestWithVotes;
      finalRequest: ApprovalRequestWithVotes;
      draft: ApprovalDraft;
      approvedNotification: { walletId: string; draftId: string } | null;
    };

/**
 * Cast a vote on an approval request.
 *
 * Runs inside a transaction that locks the ApprovalRequest row `FOR UPDATE` so
 * status/expiry/duplicate-vote checks and vote insertion serialize cleanly.
 */
export async function castVote(
  requestId: string,
  userId: string,
  decision: VoteDecision,
  reason?: string
): Promise<{ vote: ApprovalVote; request: ApprovalRequest & { votes: ApprovalVote[] } }> {
  const outcome = await policyRepository.withTransaction<CastVoteTxOutcome>(async (tx) => {
    await policyRepository.lockApprovalRequestForUpdate(requestId, tx);

    const request = await loadPendingRequestOrExpire(requestId, tx);
    if (request === 'expired') {
      return { kind: 'expired' };
    }

    await ensureUserHasNotVoted(requestId, userId, tx);
    await ensureEligibleToVote(request, userId, tx);
    const draft = await getDraftForAllowedVote(request, userId, tx);
    const vote = await createApprovalVote(requestId, userId, decision, reason, tx);
    const updatedRequest = await getApprovalRequestAfterVote(requestId, tx);

    // Check if the request should be resolved
    const approvedNotification = await checkAndResolveRequest(updatedRequest, draft, userId, tx);

    // Resolution may have committed here or in a concurrent resolver. Return
    // the persisted snapshot, not the pending snapshot used to evaluate quorum.
    const finalRequest = await getApprovalRequestAfterVote(requestId, tx);

    return {
      kind: 'voted',
      vote,
      request,
      finalRequest,
      draft,
      approvedNotification,
    };
  });

  if (outcome.kind === 'expired') {
    throw new ConflictError('Approval request has expired');
  }

  if (outcome.approvedNotification) {
    dispatchApprovedNotification(
      outcome.approvedNotification.walletId,
      outcome.approvedNotification.draftId
    );
  }

  // Log policy event
  logApprovalVoteEvent(outcome.request, outcome.finalRequest, outcome.draft, userId, decision, reason);

  return { vote: outcome.vote, request: outcome.finalRequest };
}

async function loadPendingRequestOrExpire(
  requestId: string,
  tx: PrismaTxClient
): Promise<ApprovalRequestWithVotes | 'expired'> {
  const request = await policyRepository.findApprovalRequestById(requestId, tx);
  if (!request) {
    throw new NotFoundError('Approval request not found');
  }

  if (request.status !== 'pending') {
    throw new ConflictError(`Approval request is already ${request.status}`);
  }

  if (isPastExpiry(request)) {
    await expireRequests([request], request.draftTransactionId, tx);
    return 'expired';
  }

  return request;
}

function isPastExpiry(request: Pick<ApprovalRequest, 'expiresAt'>, now = new Date()): boolean {
  return request.expiresAt !== null && now > request.expiresAt;
}

/**
 * Resolve requests past their expiry as 'expired' and derive the draft's
 * status from that, so the draft is released instead of staying 'pending'.
 * Returns how many requests this call expired.
 */
async function expireRequests(
  requests: Array<Pick<ApprovalRequest, 'id'>>,
  draftId: string,
  tx?: PrismaTxClient
): Promise<number> {
  let expired = 0;
  for (const request of requests) {
    if (await resolveRequest(request.id, 'expired', tx)) expired += 1;
  }
  if (expired > 0) {
    await updateDraftApprovalFromRequests(draftId, { client: tx });
  }
  return expired;
}

async function ensureUserHasNotVoted(
  requestId: string,
  userId: string,
  tx: PrismaTxClient
): Promise<void> {
  const existingVote = await policyRepository.findVoteByUserAndRequest(requestId, userId, tx);
  if (existingVote) {
    throw new ConflictError('You have already voted on this request');
  }
}

/**
 * For 'specific' quorum, only the named approvers may vote at all — an
 * unlisted user must be refused here so ineligible votes never accumulate
 * toward the request's quorum count. No-op for 'any_n' and 'all'.
 */
async function ensureEligibleToVote(
  request: ApprovalRequestWithVotes,
  userId: string,
  tx?: PrismaTxClient
): Promise<void> {
  if (!(await isEligibleSpecificApprover(request, userId, tx))) {
    throw new ForbiddenError('You are not an eligible approver for this request');
  }
}

/** Once a draft holds a resolved status, no later vote or override may re-derive it as approved. */
const RESOLVED_DRAFT_APPROVAL_STATUSES: ReadonlySet<string> = new Set(RESOLVED_APPROVAL_STATUSES);
const ACTIONABLE_DRAFT_STATUSES: ReadonlySet<string> = new Set(ACTIONABLE_DRAFT_STATUS_VALUES);

function ensureDraftNotResolved(draft: { approvalStatus?: string } | null | undefined): void {
  const status = draft?.approvalStatus;
  if (status !== undefined && RESOLVED_DRAFT_APPROVAL_STATUSES.has(status)) {
    throw new ConflictError(`Draft is already ${status}`);
  }
}

function ensureDraftActionable(draft: { status?: string } | null | undefined): void {
  const status = draft?.status;
  if (status !== undefined && !ACTIONABLE_DRAFT_STATUSES.has(status)) {
    throw new ConflictError('Draft is no longer actionable');
  }
}

async function getDraftForAllowedVote(
  request: ApprovalRequest,
  userId: string,
  tx: PrismaTxClient
): Promise<ApprovalDraft> {
  const draft = await draftRepository.findById(request.draftTransactionId, tx);
  ensureDraftNotResolved(draft);
  ensureDraftActionable(draft);
  if (draft && isSelfApprovalBlocked(request, draft.userId, userId)) {
    throw new ForbiddenError('Self-approval is not allowed for this policy');
  }

  return draft;
}

async function createApprovalVote(
  requestId: string,
  userId: string,
  decision: VoteDecision,
  reason: string | undefined,
  tx: PrismaTxClient
): Promise<ApprovalVote> {
  let vote: ApprovalVote;
  try {
    vote = await policyRepository.createVote({
      approvalRequestId: requestId,
      userId,
      decision,
      reason,
    }, tx);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError('You have already voted on this request');
    }
    throw error;
  }

  log.info('Vote cast', {
    requestId,
    userId,
    decision,
    voteId: vote.id,
  });

  return vote;
}

async function getApprovalRequestAfterVote(
  requestId: string,
  tx: PrismaTxClient
): Promise<ApprovalRequestWithVotes> {
  const updatedRequest = await policyRepository.findApprovalRequestById(requestId, tx);
  if (!updatedRequest) {
    throw new NotFoundError('Approval request not found after vote');
  }

  return updatedRequest;
}

function logApprovalVoteEvent(
  request: ApprovalRequest,
  updatedRequest: ApprovalRequestWithVotes,
  draft: ApprovalDraft,
  userId: string,
  decision: VoteDecision,
  reason?: string
): void {
  policyRepository.createPolicyEvent({
    policyId: request.policyId,
    walletId: draft?.walletId ?? '',
    draftTransactionId: request.draftTransactionId,
    userId,
    eventType: getVoteEventType(decision),
    details: {
      requestId: request.id,
      decision,
      reason: reason ?? null,
      currentApprovals: updatedRequest.votes.filter(v => v.decision === 'approve').length,
      requiredApprovals: request.requiredApprovals,
    },
  }).catch(err => {
    log.warn('Failed to log approval event', { error: getErrorMessage(err) });
  });
}

function getVoteEventType(decision: VoteDecision): 'approved' | 'rejected' | 'vetoed' {
  switch (decision) {
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    default:
      return 'vetoed';
  }
}

// ========================================
// OWNER OVERRIDE
// ========================================

/**
 * Force-approve all pending approval requests for a draft.
 * Only wallet owners can do this. Creates an audit trail.
 */
export async function ownerOverride(
  draftId: string,
  walletId: string,
  ownerId: string,
  reason: string
): Promise<void> {
  // An override force-approves; it must not reverse a draft already settled
  // as rejected/vetoed/expired by a sibling request.
  ensureDraftNotResolved(await draftRepository.findById(draftId));

  const requests = await policyRepository.findApprovalRequestsByDraftId(draftId);
  const pending = requests.filter(r => r.status === 'pending');

  if (pending.length === 0) {
    throw new ConflictError('No pending approval requests to override');
  }

  // Expiry is checked the way castVote checks it, before anything is approved:
  // an expired request releases the draft and the override is refused.
  const overdue = pending.filter(request => isPastExpiry(request));
  if (overdue.length > 0) {
    await expireRequests(overdue, draftId);
    throw new ConflictError('Approval request has expired');
  }

  // Only requests still pending at write time are overridden. A request another
  // resolver rejected or vetoed in the meantime is already settled, and an
  // override must not silently reverse that decision.
  const overridden: typeof pending = [];
  for (const request of pending) {
    const resolved = await policyRepository.resolveApprovalRequestIfPending(request.id, 'approved');
    if (resolved) {
      overridden.push(request);
    }
  }

  if (overridden.length === 0) {
    throw new ConflictError('No pending approval requests to override');
  }

  // Derive the draft status from all requests rather than force-writing
  // 'approved': a request another resolver settled (rejected/vetoed) in the
  // meantime must still veto the draft even though this override succeeded
  // for the requests it won. The override's own 'overridden' notification
  // below is the single notification for this path, so suppress the derive
  // step's own notification to avoid double-notifying.
  await updateDraftApprovalFromRequests(draftId, { notify: false, approvedBy: ownerId });

  // Log override event for each policy
  for (const request of overridden) {
    await policyRepository.createPolicyEvent({
      policyId: request.policyId,
      walletId,
      draftTransactionId: draftId,
      userId: ownerId,
      eventType: 'overridden',
      details: {
        requestId: request.id,
        reason,
        overriddenBy: ownerId,
      },
    });
  }

  log.warn('Owner override on approval requests', {
    draftId,
    walletId,
    ownerId,
    overriddenCount: overridden.length,
    alreadySettledCount: pending.length - overridden.length,
    reason,
  });

  // Notify about override (async)
  notifyApprovalResolved(walletId, draftId, 'overridden', ownerId).catch(err => {
    log.warn('Failed to send override notification', { error: getErrorMessage(err) });
  });
}

// ========================================
// EXPIRY SWEEP
// ========================================

/**
 * Maintenance sweep: resolve pending requests past their expiry as 'expired'
 * and update their drafts, so a draft no one votes on is released too. It
 * also repairs drafts left 'pending' with an already-expired request (a late
 * vote used to expire the request without updating its draft).
 */
export async function expireOverdueApprovals(
  now: Date = new Date()
): Promise<{ expiredRequests: number; updatedDrafts: number }> {
  const overdue = await policyRepository.findOverduePendingApprovalRequests(now);
  const byDraft = new Map<string, Array<{ id: string }>>();
  for (const request of overdue) {
    const list = byDraft.get(request.draftTransactionId);
    if (list) list.push(request);
    else byDraft.set(request.draftTransactionId, [request]);
  }

  let expiredRequests = 0;
  const updated = new Set<string>();
  for (const [draftId, requests] of byDraft) {
    const expired = await expireRequests(requests, draftId);
    expiredRequests += expired;
    if (expired > 0) updated.add(draftId);
  }

  // Drafts left pending with an expired request, or with no request at all after
  // a policy or group delete cascaded them away.
  const stranded = [
    ...await policyRepository.findPendingDraftIdsWithExpiredRequests(),
    ...await policyRepository.findPendingDraftIdsWithoutApprovalRequests(),
  ];
  for (const draftId of stranded) {
    if (updated.has(draftId)) continue;
    await updateDraftApprovalFromRequests(draftId);
    updated.add(draftId);
  }

  if (expiredRequests > 0 || updated.size > 0) {
    log.info('Expired overdue approval requests', { expiredRequests, updatedDrafts: updated.size });
  }
  return { expiredRequests, updatedDrafts: updated.size };
}

// ========================================
// QUERY PENDING APPROVALS
// ========================================

/**
 * Get all pending approval requests for a user across all wallets.
 */
export async function getPendingApprovalsForUser(
  accessibleWalletIds: string[]
): Promise<(ApprovalRequest & { votes: ApprovalVote[]; draftTransaction: { walletId: string; recipient: string; amount: bigint } })[]> {
  return policyRepository.findPendingApprovalsForUser(accessibleWalletIds);
}

/**
 * Get approval requests for a specific draft.
 */
export async function getApprovalsForDraft(
  draftId: string
): Promise<(ApprovalRequest & { votes: ApprovalVote[] })[]> {
  return policyRepository.findApprovalRequestsByDraftId(draftId);
}

// ========================================
// INTERNAL HELPERS
// ========================================

async function checkAndResolveRequest(
  request: ApprovalRequest & { votes: ApprovalVote[] },
  draft: ApprovalDraft,
  voterUserId: string,
  tx: PrismaTxClient
): Promise<{ walletId: string; draftId: string } | null> {
  const approveVotes = request.votes.filter(v => v.decision === 'approve');
  const rejectVotes = request.votes.filter(v => v.decision === 'reject');
  const vetoVotes = request.votes.filter(v => v.decision === 'veto');

  // Any rejection → reject the request
  if (rejectVotes.length > 0) {
    if (await resolveRequest(request.id, 'rejected', tx)) {
      await updateDraftApprovalFromRequests(request.draftTransactionId, { client: tx });
    }
    return null;
  }

  // Any veto → veto the request
  if (vetoVotes.length > 0) {
    if (await resolveRequest(request.id, 'vetoed', tx)) {
      await updateDraftApprovalFromRequests(request.draftTransactionId, { client: tx });
    }
    return null;
  }

  // Check quorum
  let quorumMet = false;

  switch (request.quorumType) {
    case 'any_n':
      // Like checkAllQuorumMet, re-derive eligibility from live membership: an
      // approve vote from a user who has since lost approver access must not count.
      quorumMet = await checkAnyNQuorumMet(request, approveVotes, draft, tx);
      break;
    case 'all':
      // "all" quorum resolves against live wallet membership, not the count
      // stored at request creation: growth means a new approver must also
      // vote before resolving, and if a non-voting member is removed the
      // request no longer waits on their vote — it resolves as soon as the
      // remaining eligible members' votes are all in. This check only runs
      // when a vote is cast (or via owner override, which resolves
      // unconditionally); a removal by itself does not re-trigger it, so a
      // request can still sit pending until the next vote or an expiry sweep.
      quorumMet = await checkAllQuorumMet(request, approveVotes, draft, tx);
      break;
    case 'specific':
      // Re-filter against the live specificApprovers list rather than
      // trusting `approveVotes` outright: ensureEligibleToVote only guards
      // votes cast after this fix shipped, and a policy edit can remove a
      // voter from the list after they already approved. Only a vote from a
      // currently-listed approver who is still an effective wallet approver
      // counts toward requiredApprovals.
      quorumMet = await checkSpecificQuorumMet(request, approveVotes, draft, tx);
      break;
  }

  if (quorumMet && await resolveRequest(request.id, 'approved', tx)) {
    return updateDraftApprovalFromRequests(request.draftTransactionId, {
      approvedBy: voterUserId,
      client: tx,
      deferNotify: true,
    });
  }
  return null;
}

/**
 * Attempt to resolve a request. Returns false when another resolver settled it
 * first — the caller must then leave the derived draft status alone, since the
 * winner's decision is the one that counts.
 */
async function resolveRequest(
  requestId: string,
  status: Exclude<ApprovalRequestStatus, 'pending'>,
  tx?: PrismaTxClient
): Promise<boolean> {
  const resolved = await (tx !== undefined
    ? policyRepository.resolveApprovalRequestIfPending(requestId, status, undefined, tx)
    : policyRepository.resolveApprovalRequestIfPending(requestId, status));

  if (!resolved) {
    log.info('Approval request already resolved by a concurrent resolver', {
      requestId,
      attemptedStatus: status,
    });
    return false;
  }

  log.info('Approval request resolved', { requestId, status: resolved.status });
  return true;
}

function dispatchApprovedNotification(walletId: string, draftId: string): void {
  notifyApprovalResolved(walletId, draftId, 'approved', null).catch(err => {
    log.warn('Failed to send resolution notification', { error: getErrorMessage(err) });
  });
}

/**
 * Update draft approval status based on all its approval requests.
 *
 * `notify` defaults to true for the normal per-vote resolution path. Callers
 * that send their own resolution notification (e.g. owner override, which
 * sends a single 'overridden' notification) pass `{ notify: false }` to avoid
 * a double notification on the all-approved branch.
 */
async function updateDraftApprovalFromRequests(
  draftId: string,
  options: {
    notify?: boolean;
    deferNotify?: boolean;
    approvedBy?: string;
    client?: PrismaTxClient;
  } = {}
): Promise<{ walletId: string; draftId: string } | null> {
  const { notify = true, deferNotify = false, approvedBy, client } = options;
  const requests = client !== undefined
    ? await policyRepository.findApprovalRequestsByDraftId(draftId, client)
    : await policyRepository.findApprovalRequestsByDraftId(draftId);

  if (requests.length === 0) {
    // Deleting a policy cascades its requests away. A pending draft with no
    // requests left has nothing to vote on, so it no longer needs approval.
    const draft = client !== undefined
      ? await draftRepository.findById(draftId, client)
      : await draftRepository.findById(draftId);
    if (draft?.approvalStatus === 'pending') {
      await draftRepository.updateApprovalStatus(draftId, 'not_required', {
        allowedFrom: ['pending'],
        ...(client !== undefined ? { client } : {}),
      });
    }
    return null;
  }

  // Rejected beats vetoed beats expired. An expired request can no longer be
  // approved. Each is terminal for the draft, so its UTXOs are released.
  const refusal = RESOLVED_APPROVAL_STATUSES.find(status => requests.some(r => r.status === status));
  if (refusal) {
    const transitioned = await draftRepository.updateApprovalStatus(draftId, refusal, {
      allowedFrom: ['pending'],
      ...(client !== undefined ? { client } : {}),
    });
    if (transitioned) {
      if (client !== undefined) {
        await draftLockRepository.deleteByDraftId(draftId, client);
      } else {
        await draftLockRepository.deleteByDraftId(draftId);
      }
    }
    return null;
  }

  // If all requests are approved, the draft is approved
  if (requests.every(r => r.status === 'approved')) {
    const transitioned = await draftRepository.updateApprovalStatus(draftId, 'approved', {
      allowedFrom: ['pending'],
      ...(approvedBy !== undefined ? { approvedBy } : {}),
      ...(client !== undefined ? { client } : {}),
    });

    if (transitioned && notify) {
      const draft = await (client !== undefined
        ? draftRepository.findById(draftId, client)
        : draftRepository.findById(draftId));
      if (draft) {
        if (deferNotify) {
          return { walletId: draft.walletId, draftId };
        }
        dispatchApprovedNotification(draft.walletId, draftId);
      }
    }
    return null;
  }

  // Otherwise still pending
  return null;
}

async function updateDraftApprovalStatus(
  draftId: string,
  status: string,
  client?: DraftDbClient
): Promise<boolean> {
  if (client !== undefined) {
    return draftRepository.updateApprovalStatus(draftId, status, client);
  }
  return draftRepository.updateApprovalStatus(draftId, status);
}

// ========================================
// EXPORTS
// ========================================

/**
 * Re-derive a draft's approval status from its remaining requests, e.g. after
 * deleting a policy cascaded some of them away.
 */
export async function rederiveDraftApprovalStatus(
  draftId: string,
  client?: PrismaTxClient
): Promise<void> {
  await updateDraftApprovalFromRequests(draftId, { client });
}

export const approvalService = {
  createApprovalRequestsForDraft,
  rederiveDraftApprovalStatus,
  castVote,
  ownerOverride,
  expireOverdueApprovals,
  getPendingApprovalsForUser,
  getApprovalsForDraft,
  isEligibleSpecificApprover,
};

export default approvalService;
