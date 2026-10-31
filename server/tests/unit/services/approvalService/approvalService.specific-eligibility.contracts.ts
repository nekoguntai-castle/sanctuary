import { faker } from '@faker-js/faker';
import { expect, it } from 'vitest';

import {
  draftId,
  makePendingRequest,
  mockDraftRepo,
  mockPolicyRepo,
  mockVoteRequestReads,
  mockWalletSharingRepo,
  otherUserId,
  policyId,
  requestId,
  userId,
  walletId,
} from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

type Vote = { userId: string; decision: 'approve' };

interface SpecificScenario {
  votes: Vote[];
  finalStatus: 'pending' | 'approved';
  specificApprovers: string[];
  requiredApprovals: number;
  eligibleIds: string[];
  allowSelfApproval?: boolean;
  draft?: { userId: string; walletId: string } | null;
}

const approve = (voterId: string): Vote => ({ userId: voterId, decision: 'approve' });

/**
 * Seeds one castVote round on a 'specific' request whose live policy lists
 * `specificApprovers`, with `eligibleIds` as the wallet's current effective
 * approvers.
 */
function arrangeSpecificVote({
  votes,
  finalStatus,
  specificApprovers,
  requiredApprovals,
  eligibleIds,
  allowSelfApproval = false,
  draft = { userId: 'creator', walletId },
}: SpecificScenario): void {
  const initial = makePendingRequest({ quorumType: 'specific', requiredApprovals, allowSelfApproval });
  const afterVote = { ...initial, votes };
  mockVoteRequestReads(initial, afterVote, finalStatus);
  mockPolicyRepo.findPolicyById.mockResolvedValue({
    id: policyId,
    config: { quorumType: 'specific', specificApprovers, requiredApprovals },
  });
  mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
  mockDraftRepo.findById.mockResolvedValue(draft);
  mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ ...afterVote, status: 'approved' }]);
  mockPolicyRepo.createVote.mockResolvedValue({ id: 'vx', decision: 'approve' });
  mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue(eligibleIds);
}

function expectNotResolved(): void {
  expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
  expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
}

/**
 * Non-regression contracts for approval-specific--stale-votes-count-after-access-loss:
 * a 'specific' request counts only approve votes from users who are both on
 * the live specificApprovers list AND current effective wallet approvers.
 * The threshold stays the live policy's min(requiredApprovals,
 * specificApprovers.length) — losing access never lowers it.
 */
export function registerSpecificEligibilityContracts() {
  const revokedId = faker.string.uuid();

  it('specific: an approve vote from a listed approver who has since lost wallet access does not count', async () => {
    arrangeSpecificVote({
      votes: [approve(revokedId), approve(otherUserId)],
      finalStatus: 'pending',
      specificApprovers: [revokedId, otherUserId, userId],
      requiredApprovals: 2,
      eligibleIds: [otherUserId, userId],
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
    expect(mockWalletSharingRepo.findEffectiveApproverIds).toHaveBeenCalledWith(walletId, undefined);
  });

  it('specific: a listed approver downgraded below approver (no longer effective) does not count, and the threshold does not shrink', async () => {
    // Downgrade leaves revokedId on specificApprovers but out of the effective
    // approver set; min(2, 2) stays 2 even though only one listed user is eligible.
    arrangeSpecificVote({
      votes: [approve(revokedId), approve(otherUserId)],
      finalStatus: 'pending',
      specificApprovers: [revokedId, otherUserId],
      requiredApprovals: 2,
      eligibleIds: [otherUserId],
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
  });

  it("specific: never counts the requester's own approve vote when self-approval is disallowed", async () => {
    arrangeSpecificVote({
      votes: [approve('creator'), approve(otherUserId)],
      finalStatus: 'pending',
      specificApprovers: ['creator', otherUserId],
      requiredApprovals: 2,
      eligibleIds: ['creator', otherUserId],
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
  });

  it("specific: counts the requester's own approve vote when allowSelfApproval is true", async () => {
    arrangeSpecificVote({
      votes: [approve('creator')],
      finalStatus: 'approved',
      specificApprovers: ['creator'],
      requiredApprovals: 1,
      eligibleIds: ['creator'],
      allowSelfApproval: true,
    });

    await approvalService.castVote(requestId, 'creator', 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });

  it('specific: never resolves when the backing draft is missing', async () => {
    arrangeSpecificVote({
      votes: [approve(otherUserId)],
      finalStatus: 'pending',
      specificApprovers: [otherUserId],
      requiredApprovals: 1,
      eligibleIds: [otherUserId],
      draft: null,
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
  });

  it('specific: resolves once enough currently eligible listed approvers vote, ignoring a revoked vote already on the request', async () => {
    arrangeSpecificVote({
      votes: [approve(revokedId), approve(otherUserId), approve(userId)],
      finalStatus: 'approved',
      specificApprovers: [revokedId, otherUserId, userId],
      requiredApprovals: 2,
      eligibleIds: [otherUserId, userId],
    });

    await approvalService.castVote(requestId, userId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved');
  });
}
