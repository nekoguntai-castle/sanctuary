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
  requestId,
  userId,
  walletId,
} from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

type Vote = { userId: string; decision: 'approve' };

interface AnyNScenario {
  initial: Record<string, unknown>;
  votes: Vote[];
  finalStatus: 'pending' | 'approved';
  eligibleIds: string[];
  draft?: unknown;
}

const approve = (voterId: string): Vote => ({ userId: voterId, decision: 'approve' });

/**
 * Seeds one castVote round. Every scenario mocks the draft-status read and the
 * vote write, so a base-code failure is the resolution assertion, not a
 * TypeError from an unmocked repository call.
 */
function arrangeAnyNVote({
  initial,
  votes,
  finalStatus,
  eligibleIds,
  draft = { userId: 'creator', walletId },
}: AnyNScenario): void {
  const afterVote = { ...initial, votes };
  mockVoteRequestReads(initial, afterVote, finalStatus);
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
 * Non-regression contracts for approval-any-n--stale-votes-count-after-access-loss:
 * an any_n request counts only approve votes from users who are effective
 * approvers when the request resolves.
 */
export function registerAnyNEligibilityContracts() {
  const revokedId = faker.string.uuid();
  const anyN = makePendingRequest({ quorumType: 'any_n', requiredApprovals: 2 });

  it('any_n: an approve vote from a voter who has since lost approver access does not count', async () => {
    arrangeAnyNVote({
      initial: anyN,
      votes: [approve(revokedId), approve(otherUserId)],
      finalStatus: 'pending',
      eligibleIds: [otherUserId, userId],
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
    expect(mockWalletSharingRepo.findEffectiveApproverIds).toHaveBeenCalledWith(walletId, undefined);
  });

  it("any_n: never counts the requester's own approve vote when self-approval is disallowed", async () => {
    arrangeAnyNVote({
      initial: anyN,
      votes: [approve('creator'), approve(otherUserId)],
      finalStatus: 'pending',
      eligibleIds: ['creator', otherUserId],
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
  });

  it('any_n: never resolves when the backing draft is missing', async () => {
    arrangeAnyNVote({
      initial: anyN,
      votes: [approve(userId), approve(otherUserId)],
      finalStatus: 'pending',
      eligibleIds: [otherUserId, userId],
      draft: null,
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
  });

  it('any_n: never resolves on a non-positive requiredApprovals snapshot', async () => {
    arrangeAnyNVote({
      initial: makePendingRequest({ quorumType: 'any_n', requiredApprovals: 0 }),
      votes: [approve(otherUserId)],
      finalStatus: 'pending',
      eligibleIds: [otherUserId],
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
  });

  it('any_n: skips the eligibility lookup while the raw approve count is below requiredApprovals', async () => {
    arrangeAnyNVote({
      initial: anyN,
      votes: [approve(otherUserId)],
      finalStatus: 'pending',
      eligibleIds: [otherUserId, userId],
    });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expectNotResolved();
    expect(mockWalletSharingRepo.findEffectiveApproverIds).not.toHaveBeenCalled();
  });

  it('any_n: resolves once enough currently eligible approvers vote, ignoring a revoked vote already on the request', async () => {
    arrangeAnyNVote({
      initial: anyN,
      votes: [approve(revokedId), approve(otherUserId), approve(userId)],
      finalStatus: 'approved',
      eligibleIds: [otherUserId, userId],
    });

    await approvalService.castVote(requestId, userId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved');
  });

  it("any_n: counts the requester's own approve vote when allowSelfApproval is true", async () => {
    arrangeAnyNVote({
      initial: makePendingRequest({ quorumType: 'any_n', requiredApprovals: 1, allowSelfApproval: true }),
      votes: [approve('creator')],
      finalStatus: 'approved',
      eligibleIds: ['creator'],
    });

    await approvalService.castVote(requestId, 'creator', 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });
}
