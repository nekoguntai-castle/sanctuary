/**
 * Approval Quorum Evaluation Helpers
 *
 * Pure read-and-evaluate quorum logic for vault policy approval requests:
 * - Resolving live wallet approver eligibility
 * - Evaluating 'any_n', 'all', and 'specific' quorum rules against live state
 */

import type { ApprovalRequest, ApprovalVote } from '../../generated/prisma/client';
import type { PrismaTxClient } from '../../models/prisma';
import { policyRepository, type PolicyDbClient } from '../../repositories/policyRepository';
import {
  walletSharingRepository,
  type EffectiveApproverDbClient,
} from '../../repositories/walletSharingRepository';
import type { ApprovalRequiredConfig } from './types';

export type SpecificEligibilityRequest = Pick<ApprovalRequest, 'quorumType' | 'policyId'>;
export type ApprovalQuorumDraft = { walletId: string; userId: string } | null | undefined;

/** True only for a finite whole number >= 1 — a usable quorum threshold. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
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
  policyId: string,
  client?: PolicyDbClient
): Promise<{ specificApprovers: string[]; requiredApprovals: unknown }> {
  const policy = client !== undefined
    ? await policyRepository.findPolicyById(policyId, client)
    : await policyRepository.findPolicyById(policyId);
  const config = policy?.config as unknown as ApprovalRequiredConfig | undefined;
  return {
    specificApprovers: config?.specificApprovers ?? [],
    requiredApprovals: config?.requiredApprovals,
  };
}

/**
 * True when the user may vote on the request under its quorum rule: always
 * for 'any_n'/'all', and for 'specific' only when the live policy lists them.
 * Shared by castVote and callers that pick a request to vote on, so the two
 * cannot drift.
 */
export async function isEligibleSpecificApprover(
  request: SpecificEligibilityRequest,
  userId: string,
  client?: PolicyDbClient
): Promise<boolean> {
  if (request.quorumType !== 'specific') {
    return true;
  }

  const { specificApprovers } = await loadSpecificApprovers(request.policyId, client);
  return specificApprovers.includes(userId);
}

/**
 * Resolve the wallet's currently eligible approvers — users with an
 * approving role (owner or approver) on the wallet — excluding the
 * requester when self-approval is not allowed. Always derived live so a
 * membership change after request creation is honored on the next check.
 */
export async function getEligibleApproverIds(
  walletId: string,
  requesterId: string,
  allowSelfApproval: boolean,
  client?: EffectiveApproverDbClient,
): Promise<string[]> {
  const eligible = await walletSharingRepository.findEffectiveApproverIds(walletId, client);

  if (allowSelfApproval) {
    return eligible;
  }

  return eligible.filter(id => id !== requesterId);
}

/**
 * Counts the approve votes cast by users who are currently effective wallet
 * approvers (the live set 'all' uses, including the self-approval rule).
 */
async function countEligibleApproveVotes(
  request: ApprovalRequest,
  draft: NonNullable<ApprovalQuorumDraft>,
  votes: ApprovalVote[],
  tx?: PrismaTxClient
): Promise<number> {
  const eligibleIds = new Set(
    await getEligibleApproverIds(draft.walletId, draft.userId, request.allowSelfApproval, tx)
  );
  return votes.filter(v => eligibleIds.has(v.userId)).length;
}

/**
 * 'all' quorum is met only when every currently eligible approver has an
 * approve vote on record. An empty eligible set (e.g. the requester was the
 * sole approver and self-approval is disallowed) never resolves on its own —
 * that would approve a request with zero votes.
 */
export async function checkAllQuorumMet(
  request: ApprovalRequest,
  approveVotes: ApprovalVote[],
  draft: ApprovalQuorumDraft,
  tx?: PrismaTxClient
): Promise<boolean> {
  if (!draft) {
    return false;
  }

  const eligibleIds = await getEligibleApproverIds(draft.walletId, draft.userId, request.allowSelfApproval, tx);
  if (eligibleIds.length === 0) {
    return false;
  }

  const approveUserIds = new Set(approveVotes.map(v => v.userId));
  return eligibleIds.every(id => approveUserIds.has(id));
}

/**
 * 'any_n' quorum is met only by approve votes from currently eligible
 * approvers (the same live set 'all' uses). The threshold is the request's
 * creation-time `requiredApprovals` snapshot, never clamped to the eligible
 * set's size: a removal must not quietly weaken a 2-of-N policy. Fails closed
 * on a missing draft or a non-positive/non-integer snapshot.
 */
export async function checkAnyNQuorumMet(
  request: ApprovalRequest,
  approveVotes: ApprovalVote[],
  draft: ApprovalQuorumDraft,
  tx?: PrismaTxClient
): Promise<boolean> {
  if (!draft || !isPositiveInteger(request.requiredApprovals)) {
    return false;
  }
  if (approveVotes.length < request.requiredApprovals) {
    return false;
  }

  return (await countEligibleApproveVotes(request, draft, approveVotes, tx)) >= request.requiredApprovals;
}

/**
 * 'specific' quorum is met only by approve votes from users currently on the
 * policy's specificApprovers list — a vote from anyone else (cast before the
 * castVote-time eligibility check existed, or before a policy edit dropped
 * them from the list) must not count toward the threshold — AND who are still
 * effective wallet approvers (the same live set 'all'/'any_n' use, including
 * the self-approval rule).
 *
 * The threshold is the live policy's `min(requiredApprovals, specificApprovers.length)`
 * with fallback to the request snapshot only if the live policy threshold is missing/invalid.
 * Fails closed on missing draft, empty roster, or unusable threshold.
 */
export async function checkSpecificQuorumMet(
  request: ApprovalRequest,
  approveVotes: ApprovalVote[],
  draft: ApprovalQuorumDraft,
  tx?: PrismaTxClient
): Promise<boolean> {
  if (!draft) {
    return false;
  }

  const { specificApprovers, requiredApprovals: liveRequiredApprovals } =
    await loadSpecificApprovers(request.policyId, tx);

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
  const listedApproveVotes = approveVotes.filter(v => specificApprovers.includes(v.userId));
  if (listedApproveVotes.length < liveThreshold) {
    return false;
  }

  return (await countEligibleApproveVotes(request, draft, listedApproveVotes, tx)) >= liveThreshold;
}
