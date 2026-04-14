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
import { draftRepository } from '../../repositories/draftRepository';
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
  triggeredPolicies: PolicyEvaluationResult['triggered']
): Promise<ApprovalRequest[]> {
  const approvalPolicies = triggeredPolicies.filter(t => t.action === 'approval_required');

  if (approvalPolicies.length === 0) {
    return [];
  }

  const requests: ApprovalRequest[] = [];

  for (const triggered of approvalPolicies) {
    const policy = await policyRepository.findPolicyById(triggered.policyId);
    if (!policy) continue;

    const config = policy.config as unknown as ApprovalRequiredConfig;

    // Calculate expiration
    let expiresAt: Date | undefined;
    if (config.expirationHours > 0) {
      expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + config.expirationHours);
    }

    const request = await policyRepository.createApprovalRequest({
      draftTransactionId: draftId,
      policyId: triggered.policyId,
      requiredApprovals: config.requiredApprovals,
      quorumType: config.quorumType,
      allowSelfApproval: config.allowSelfApproval,
      expiresAt,
    });

    requests.push(request);

    log.info('Created approval request', {
      requestId: request.id,
      draftId,
      policyId: triggered.policyId,
      requiredApprovals: config.requiredApprovals,
    });
  }

  // Update draft approval status
  await updateDraftApprovalStatus(draftId, 'pending');

  // Send notifications (async, don't block)
  notifyApprovalRequested(walletId, draftId, createdByUserId).catch(err => {
    log.warn('Failed to send approval notification', { error: getErrorMessage(err) });
  });

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
  const draft = await getDraftForAllowedVote(request, userId);
  const vote = await createApprovalVote(requestId, userId, decision, reason);
  const updatedRequest = await getApprovalRequestAfterVote(requestId);

  // Check if the request should be resolved
  await checkAndResolveRequest(updatedRequest);

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

  for (const request of pending) {
    await policyRepository.updateApprovalRequestStatus(request.id, 'approved');
  }

  await updateDraftApprovalStatus(draftId, 'approved');

  // Log override event for each policy
  for (const request of pending) {
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
    overriddenCount: pending.length,
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

async function checkAndResolveRequest(
  request: ApprovalRequest & { votes: ApprovalVote[] }
): Promise<void> {
  const approveVotes = request.votes.filter(v => v.decision === 'approve');
  const rejectVotes = request.votes.filter(v => v.decision === 'reject');
  const vetoVotes = request.votes.filter(v => v.decision === 'veto');

  // Any rejection → reject the request
  if (rejectVotes.length > 0) {
    await resolveRequest(request.id, 'rejected');
    await updateDraftApprovalFromRequests(request.draftTransactionId);
    return;
  }

  // Any veto → veto the request
  if (vetoVotes.length > 0) {
    await resolveRequest(request.id, 'vetoed');
    await updateDraftApprovalFromRequests(request.draftTransactionId);
    return;
  }

  // Check quorum
  let quorumMet = false;

  switch (request.quorumType) {
    case 'any_n':
      quorumMet = approveVotes.length >= request.requiredApprovals;
      break;
    case 'all':
      // "all" quorum — we can't know the total eligible count here,
      // so we treat it as requiredApprovals (set at creation time to the count of eligible approvers)
      quorumMet = approveVotes.length >= request.requiredApprovals;
      break;
    case 'specific':
      // For specific quorum, check is the same — requiredApprovals is set to the count of specific approvers
      quorumMet = approveVotes.length >= request.requiredApprovals;
      break;
  }

  if (quorumMet) {
    await resolveRequest(request.id, 'approved');
    await updateDraftApprovalFromRequests(request.draftTransactionId);
  }
}

async function resolveRequest(
  requestId: string,
  status: ApprovalRequestStatus
): Promise<void> {
  await policyRepository.updateApprovalRequestStatus(requestId, status);
  log.info('Approval request resolved', { requestId, status });
}

/**
 * Update draft approval status based on all its approval requests.
 */
async function updateDraftApprovalFromRequests(draftId: string): Promise<void> {
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

    // Notify about resolution (async)
    const draft = await draftRepository.findById(draftId);
    if (draft) {
      notifyApprovalResolved(draft.walletId, draftId, 'approved', null).catch(err => {
        log.warn('Failed to send resolution notification', { error: getErrorMessage(err) });
      });
    }
    return;
  }

  // Otherwise still pending
}

async function updateDraftApprovalStatus(
  draftId: string,
  status: string
): Promise<void> {
  await draftRepository.updateApprovalStatus(draftId, status);
}

// ========================================
// EXPORTS
// ========================================

export const approvalService = {
  createApprovalRequestsForDraft,
  castVote,
  ownerOverride,
  getPendingApprovalsForUser,
  getApprovalsForDraft,
};

export default approvalService;
