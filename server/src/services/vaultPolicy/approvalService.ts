/**
 * Approval Service
 *
 * Business logic for the approval workflow:
 * - Creating approval requests when policies trigger
 * - Recording votes (approve/reject/veto)
 * - Resolving approval requests
 * - Owner override
 */

import type { ApprovalRequest, ApprovalVote } from '../../generated/prisma/client';
import { policyRepository } from '../../repositories/policyRepository';
import type { PolicyDbClient } from '../../repositories/policyRepository';
import { draftRepository } from '../../repositories/draftRepository';
import type { DraftDbClient } from '../../repositories/draftRepository';
import { walletSharingRepository } from '../../repositories/walletSharingRepository';
import { WALLET_APPROVE_ROLE_VALUES } from '@sanctuary/shared/constants/walletRoles';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError } from '../../errors';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { notifyApprovalRequested, notifyApprovalResolved } from './approvalNotifications';
import type {
  ApprovalRequiredConfig,
  VoteDecision,
  ApprovalRequestStatus,
  PolicyEvaluationResult,
} from './types';

const log = createLogger('VAULT_POLICY:SVC_APPROVAL');

type ApprovalRequestWithVotes = ApprovalRequest & { votes: ApprovalVote[] };
type ApprovalDraft = Awaited<ReturnType<typeof draftRepository.findById>>;
export type ApprovalDbClient = DraftDbClient & PolicyDbClient;

// ========================================
// CREATE APPROVAL REQUESTS
// ========================================

/**
 * Fire-and-forget dispatch of an approval-requested notification.
 * Never throws; failures are logged as warnings.
 */
export function dispatchApprovalRequestedNotification(
  walletId: string,
  draftId: string,
  userId: string
): void {
  notifyApprovalRequested(walletId, draftId, userId).catch(err => {
    log.warn('Failed to send approval notification', { error: getErrorMessage(err) });
  });
}

/**
 * Create approval requests for a draft based on triggered policies.
 * Called when policy evaluation returns approval_required triggers.
 */
export async function createApprovalRequestsForDraft(
  draftId: string,
  walletId: string,
  createdByUserId: string,
  triggeredPolicies: PolicyEvaluationResult['triggered'],
  client?: ApprovalDbClient,
  suppressNotification = false
): Promise<ApprovalRequest[]> {
  const approvalPolicies = triggeredPolicies.filter(t => t.action === 'approval_required');

  if (approvalPolicies.length === 0) {
    return [];
  }

  const requests: ApprovalRequest[] = [];

  for (const triggered of approvalPolicies) {
    const policy = client !== undefined
      ? await policyRepository.findPolicyById(triggered.policyId, client)
      : await policyRepository.findPolicyById(triggered.policyId);
    if (!policy) continue;

    const config = policy.config as unknown as ApprovalRequiredConfig;

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
      ? (await getEligibleApproverIds(walletId, createdByUserId, config.allowSelfApproval)).length
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

  // Update draft approval status
  await updateDraftApprovalStatus(draftId, 'pending', client);

  // Send notifications (async, don't block) unless suppressed.
  // Suppression only skips the notification; request creation and the
  // pending status update above always run.
  if (!suppressNotification) {
    dispatchApprovalRequestedNotification(walletId, draftId, createdByUserId);
  }

  return requests;
}

// ========================================
// VOTE ON APPROVAL REQUESTS
// ========================================

/**
 * Cast a vote on an approval request.
 */
export async function castVote(
  requestId: string,
  userId: string,
  decision: VoteDecision,
  reason?: string
): Promise<{ vote: ApprovalVote; request: ApprovalRequest & { votes: ApprovalVote[] } }> {
  const request = await getPendingApprovalRequest(requestId);
  await ensureUserHasNotVoted(requestId, userId);
  await ensureEligibleToVote(request, userId);
  const draft = await getDraftForAllowedVote(request, userId);
  const vote = await createApprovalVote(requestId, userId, decision, reason);
  const updatedRequest = await getApprovalRequestAfterVote(requestId);

  // Check if the request should be resolved
  await checkAndResolveRequest(updatedRequest, draft);

  // Log policy event
  logApprovalVoteEvent(request, updatedRequest, draft, userId, decision, reason);

  return { vote, request: updatedRequest };
}

async function getPendingApprovalRequest(requestId: string): Promise<ApprovalRequestWithVotes> {
  const request = await policyRepository.findApprovalRequestById(requestId);
  if (!request) {
    throw new NotFoundError('Approval request not found');
  }

  if (request.status !== 'pending') {
    throw new ConflictError(`Approval request is already ${request.status}`);
  }

  if (request.expiresAt && new Date() > request.expiresAt) {
    await resolveRequest(requestId, 'expired');
    throw new ConflictError('Approval request has expired');
  }

  return request;
}

async function ensureUserHasNotVoted(requestId: string, userId: string): Promise<void> {
  const existingVote = await policyRepository.findVoteByUserAndRequest(requestId, userId);
  if (existingVote) {
    throw new ConflictError('You have already voted on this request');
  }
}

/**
 * For 'specific' quorum, only the named approvers may vote at all — an
 * unlisted user must be refused here so ineligible votes never accumulate
 * toward the request's quorum count. No-op for 'any_n' and 'all'.
 */
async function ensureEligibleToVote(request: ApprovalRequestWithVotes, userId: string): Promise<void> {
  if (request.quorumType !== 'specific') {
    return;
  }

  const { specificApprovers } = await loadSpecificApprovers(request.policyId);

  if (!specificApprovers.includes(userId)) {
    throw new ForbiddenError('You are not an eligible approver for this request');
  }
}

/**
 * Load the current specificApprovers list and requiredApprovals threshold
 * from the policy backing a 'specific'-quorum request. Always read live
 * (never cached on the request) so a policy edit, or a vote that predates
 * the eligibility check at castVote, is still honored at resolution time.
 *
 * `requiredApprovals` is returned exactly as stored (possibly `undefined` or
 * not a valid positive integer) — callers that use it as a quorum threshold
 * must validate it themselves rather than defaulting it here, since a silent
 * `?? 0` default would let an empty/invalid config resolve a request with
 * zero votes. See `checkSpecificQuorumMet`.
 */
async function loadSpecificApprovers(
  policyId: string
): Promise<{ specificApprovers: string[]; requiredApprovals: unknown }> {
  const policy = await policyRepository.findPolicyById(policyId);
  const config = policy?.config as unknown as ApprovalRequiredConfig | undefined;
  return {
    specificApprovers: config?.specificApprovers ?? [],
    requiredApprovals: config?.requiredApprovals,
  };
}

/** True only for a finite whole number >= 1 — a usable quorum threshold. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

async function getDraftForAllowedVote(
  request: ApprovalRequest,
  userId: string
): Promise<ApprovalDraft> {
  const draft = await draftRepository.findById(request.draftTransactionId);
  if (draft && draft.userId === userId && !request.allowSelfApproval) {
    throw new ForbiddenError('Self-approval is not allowed for this policy');
  }

  return draft;
}

async function createApprovalVote(
  requestId: string,
  userId: string,
  decision: VoteDecision,
  reason?: string
): Promise<ApprovalVote> {
  const vote = await policyRepository.createVote({
    approvalRequestId: requestId,
    userId,
    decision,
    reason,
  });

  log.info('Vote cast', {
    requestId,
    userId,
    decision,
    voteId: vote.id,
  });

  return vote;
}

async function getApprovalRequestAfterVote(requestId: string): Promise<ApprovalRequestWithVotes> {
  const updatedRequest = await policyRepository.findApprovalRequestById(requestId);
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
  const requests = await policyRepository.findApprovalRequestsByDraftId(draftId);
  const pending = requests.filter(r => r.status === 'pending');

  if (pending.length === 0) {
    throw new ConflictError('No pending approval requests to override');
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
  await updateDraftApprovalFromRequests(draftId, { notify: false });

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

/**
 * Resolve the wallet's currently eligible approvers — users with an
 * approving role (owner or approver) on the wallet — excluding the
 * requester when self-approval is not allowed. Always derived live so a
 * membership change after request creation is honored on the next check.
 */
async function getEligibleApproverIds(
  walletId: string,
  requesterId: string,
  allowSelfApproval: boolean
): Promise<string[]> {
  const walletUsers = await walletSharingRepository.findWalletUsersWithUsername(walletId);
  const approveRoles: readonly string[] = WALLET_APPROVE_ROLE_VALUES;
  const eligible = walletUsers
    .filter(wu => approveRoles.includes(wu.role))
    .map(wu => wu.userId);

  if (allowSelfApproval) {
    return eligible;
  }

  return eligible.filter(id => id !== requesterId);
}

/**
 * 'all' quorum is met only when every currently eligible approver has an
 * approve vote on record. An empty eligible set (e.g. the requester was the
 * sole approver and self-approval is disallowed) never resolves on its own —
 * that would approve a request with zero votes.
 */
async function checkAllQuorumMet(
  request: ApprovalRequest,
  approveVotes: ApprovalVote[],
  draft: ApprovalDraft
): Promise<boolean> {
  if (!draft) {
    return false;
  }

  const eligibleIds = await getEligibleApproverIds(draft.walletId, draft.userId, request.allowSelfApproval);
  if (eligibleIds.length === 0) {
    return false;
  }

  const approveUserIds = new Set(approveVotes.map(v => v.userId));
  return eligibleIds.every(id => approveUserIds.has(id));
}

/**
 * 'specific' quorum is met only by approve votes from users currently on the
 * policy's specificApprovers list — a vote from anyone else (cast before the
 * castVote-time eligibility check existed, or before a policy edit dropped
 * them from the list) must not count toward the threshold.
 *
 * The threshold itself is always the *live* policy's
 * `min(requiredApprovals, specificApprovers.length)`, never the request's
 * `requiredApprovals` snapshot from creation time:
 *
 * - `validateApprovalRequiredConfig` (vaultPolicyService.ts) already enforces
 *   `requiredApprovals <= specificApprovers.length` on every policy write
 *   while `quorumType === 'specific'`, so the live values alone can never
 *   demand more votes than the live roster has. A `min` against the
 *   request's stale snapshot would solve a problem the live values don't
 *   have, while reintroducing a real one: after a roster shrink (e.g.
 *   [A,B,C,D]/3 edited down to [A,B]/2), the stale snapshot of 3 can never
 *   be reached by a 2-person roster, deadlocking the request forever.
 * - Comparing only against the live values also means a policy *tightened*
 *   after creation (e.g. requiredApprovals raised 3 -> 4 on the same
 *   roster) is honored immediately: an in-flight request cannot resolve on
 *   fewer votes than the live policy currently requires. This mirrors
 *   `checkAllQuorumMet`/`'all'` quorum below, which also always re-derives
 *   its required count from live state rather than trusting a
 *   creation-time snapshot.
 *
 * Fails closed, mirroring `checkAllQuorumMet`'s empty-eligible-set guard:
 * an empty live `specificApprovers` list never resolves on its own (there is
 * no one to demand a vote from), and a missing/invalid live
 * `requiredApprovals` falls back to the request's snapshot rather than a
 * `0`/`NaN` default — a threshold that quietly floors at 0 would let the
 * request resolve on zero votes, which is worse than the deadlock this
 * function exists to fix. If neither the live value nor the snapshot is a
 * usable threshold, the request never resolves via this path.
 */
async function checkSpecificQuorumMet(
  request: ApprovalRequest,
  approveVotes: ApprovalVote[]
): Promise<boolean> {
  const { specificApprovers, requiredApprovals: liveRequiredApprovals } =
    await loadSpecificApprovers(request.policyId);

  if (specificApprovers.length === 0) {
    return false;
  }

  const validRequiredApprovals = isPositiveInteger(liveRequiredApprovals)
    ? liveRequiredApprovals
    : isPositiveInteger(request.requiredApprovals)
      ? request.requiredApprovals
      : undefined;

  if (validRequiredApprovals === undefined) {
    return false;
  }

  const liveThreshold = Math.min(validRequiredApprovals, specificApprovers.length);
  const eligibleApproveVotes = approveVotes.filter(v => specificApprovers.includes(v.userId));
  return eligibleApproveVotes.length >= liveThreshold;
}

async function checkAndResolveRequest(
  request: ApprovalRequest & { votes: ApprovalVote[] },
  draft: ApprovalDraft
): Promise<void> {
  const approveVotes = request.votes.filter(v => v.decision === 'approve');
  const rejectVotes = request.votes.filter(v => v.decision === 'reject');
  const vetoVotes = request.votes.filter(v => v.decision === 'veto');

  // Any rejection → reject the request
  if (rejectVotes.length > 0) {
    if (await resolveRequest(request.id, 'rejected')) {
      await updateDraftApprovalFromRequests(request.draftTransactionId);
    }
    return;
  }

  // Any veto → veto the request
  if (vetoVotes.length > 0) {
    if (await resolveRequest(request.id, 'vetoed')) {
      await updateDraftApprovalFromRequests(request.draftTransactionId);
    }
    return;
  }

  // Check quorum
  let quorumMet = false;

  switch (request.quorumType) {
    case 'any_n':
      quorumMet = approveVotes.length >= request.requiredApprovals;
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
      quorumMet = await checkAllQuorumMet(request, approveVotes, draft);
      break;
    case 'specific':
      // Re-filter against the live specificApprovers list rather than
      // trusting `approveVotes` outright: ensureEligibleToVote only guards
      // votes cast after this fix shipped, and a policy edit can remove a
      // voter from the list after they already approved. Only a vote from a
      // currently-listed approver counts toward requiredApprovals.
      quorumMet = await checkSpecificQuorumMet(request, approveVotes);
      break;
  }

  if (quorumMet) {
    if (await resolveRequest(request.id, 'approved')) {
      await updateDraftApprovalFromRequests(request.draftTransactionId);
    }
  }
}

/**
 * Attempt to resolve a request. Returns false when another resolver settled it
 * first — the caller must then leave the derived draft status alone, since the
 * winner's decision is the one that counts.
 */
async function resolveRequest(
  requestId: string,
  status: Exclude<ApprovalRequestStatus, 'pending'>
): Promise<boolean> {
  const resolved = await policyRepository.resolveApprovalRequestIfPending(requestId, status);

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
  options: { notify?: boolean } = {}
): Promise<void> {
  const { notify = true } = options;
  const requests = await policyRepository.findApprovalRequestsByDraftId(draftId);

  if (requests.length === 0) {
    return;
  }

  // If any request is rejected or vetoed, the draft is rejected/vetoed
  if (requests.some(r => r.status === 'rejected')) {
    await updateDraftApprovalStatus(draftId, 'rejected');
    return;
  }

  if (requests.some(r => r.status === 'vetoed')) {
    await updateDraftApprovalStatus(draftId, 'vetoed');
    return;
  }

  // If all requests are approved, the draft is approved
  if (requests.every(r => r.status === 'approved')) {
    await updateDraftApprovalStatus(draftId, 'approved');

    if (notify) {
      // Notify about resolution (async)
      const draft = await draftRepository.findById(draftId);
      if (draft) {
        notifyApprovalResolved(draft.walletId, draftId, 'approved', null).catch(err => {
          log.warn('Failed to send resolution notification', { error: getErrorMessage(err) });
        });
      }
    }
    return;
  }

  // Otherwise still pending
}

async function updateDraftApprovalStatus(
  draftId: string,
  status: string,
  client?: DraftDbClient
): Promise<void> {
  if (client !== undefined) {
    await draftRepository.updateApprovalStatus(draftId, status, client);
  } else {
    await draftRepository.updateApprovalStatus(draftId, status);
  }
}

// ========================================
// EXPORTS
// ========================================

export const approvalService = {
  createApprovalRequestsForDraft,
  dispatchApprovalRequestedNotification,
  castVote,
  ownerOverride,
  getPendingApprovalsForUser,
  getApprovalsForDraft,
};

export default approvalService;
