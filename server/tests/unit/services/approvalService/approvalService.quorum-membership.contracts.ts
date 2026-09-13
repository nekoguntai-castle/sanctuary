import { faker } from '@faker-js/faker';
import { expect, it } from 'vitest';

import {
  draftId,
  makePendingRequest,
  makeWalletUser,
  mockDraftRepo,
  mockPolicyRepo,
  mockWalletSharingRepo,
  otherUserId,
  requestId,
  userId,
  walletId,
} from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

/**
 * Non-regression contracts for the two P1 findings:
 * - approval-specific-quorum-ignores-specificapprovers
 * - vault-policy-all-quorum-requiredapprovals-static-not-membership
 */
export function registerQuorumMembershipContracts() {
  it('refuses a vote from a user not listed in specificApprovers (unlisted voter never accumulates)', async () => {
    const specificRequest = makePendingRequest({ quorumType: 'specific', requiredApprovals: 1 });

    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(specificRequest);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      config: { specificApprovers: [userId] },
    });

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow('not an eligible approver');

    expect(mockPolicyRepo.createVote).not.toHaveBeenCalled();
  });

  it('allows a listed specific approver to vote and resolves once they approve', async () => {
    const specificRequest = makePendingRequest({ quorumType: 'specific', requiredApprovals: 1 });

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(specificRequest)
      .mockResolvedValueOnce({
        ...specificRequest,
        votes: [{ id: 'v1', userId, decision: 'approve' }],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      config: { specificApprovers: [userId] },
    });
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: requestId, status: 'approved' },
    ]);

    const { vote } = await approvalService.castVote(requestId, userId, 'approve');

    expect(vote.decision).toBe('approve');
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });

  it('all-quorum: membership growth after creation means the original approvers alone do not resolve', async () => {
    const secondApproverId = faker.string.uuid();
    const thirdApproverId = faker.string.uuid();
    const allRequest = makePendingRequest({ quorumType: 'all', requiredApprovals: 2 });

    // Both of the two original approvers vote approve.
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(allRequest)
      .mockResolvedValueOnce({
        ...allRequest,
        votes: [
          { id: 'v1', userId: otherUserId, decision: 'approve' },
          { id: 'v2', userId: secondApproverId, decision: 'approve' },
        ],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    // A third approver has since joined the wallet — the live eligible set is
    // now three, not the two present at request creation.
    mockWalletSharingRepo.findWalletUsersWithUsername.mockResolvedValue([
      makeWalletUser(otherUserId, 'approver'),
      makeWalletUser(secondApproverId, 'approver'),
      makeWalletUser(thirdApproverId, 'approver'),
    ]);
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v2', decision: 'approve' });

    await approvalService.castVote(requestId, secondApproverId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
  });

  it('all-quorum: removing a non-voting approver lets the remaining set resolve instead of deadlocking', async () => {
    const secondApproverId = faker.string.uuid();
    const allRequest = makePendingRequest({ quorumType: 'all', requiredApprovals: 2 });

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(allRequest)
      .mockResolvedValueOnce({
        ...allRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    // secondApproverId was removed from the wallet before voting — the live
    // eligible set now only contains otherUserId, who has already approved.
    mockWalletSharingRepo.findWalletUsersWithUsername.mockResolvedValue([
      makeWalletUser(otherUserId, 'approver'),
    ]);
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: requestId, status: 'approved' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });

  it('creation: derives all-quorum requiredApprovals from live wallet membership, not the admin-typed config value', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: 'policy-all',
      config: {
        trigger: { always: true },
        requiredApprovals: 99,
        quorumType: 'all',
        allowSelfApproval: false,
        expirationHours: 0,
      },
    });
    mockWalletSharingRepo.findWalletUsersWithUsername.mockResolvedValue([
      makeWalletUser(otherUserId, 'approver'),
      makeWalletUser(userId, 'owner'),
    ]);
    mockPolicyRepo.createApprovalRequest.mockResolvedValue({ id: requestId, status: 'pending' });

    await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId,
      [{ policyId: 'policy-all', policyName: 'All', type: 'approval_required', action: 'approval_required', reason: 'test' }]
    );

    const callArgs = mockPolicyRepo.createApprovalRequest.mock.calls[0][0];
    // Requester is excluded (allowSelfApproval: false), so only otherUserId is eligible.
    expect(callArgs.requiredApprovals).toBe(1);
  });

  it('creation: allowSelfApproval true keeps the requester in the all-quorum eligible set', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: 'policy-all',
      config: {
        trigger: { always: true },
        requiredApprovals: 1,
        quorumType: 'all',
        allowSelfApproval: true,
        expirationHours: 0,
      },
    });
    mockWalletSharingRepo.findWalletUsersWithUsername.mockResolvedValue([
      makeWalletUser(userId, 'owner'),
    ]);
    mockPolicyRepo.createApprovalRequest.mockResolvedValue({ id: requestId, status: 'pending' });

    await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId,
      [{ policyId: 'policy-all', policyName: 'All', type: 'approval_required', action: 'approval_required', reason: 'test' }]
    );

    const callArgs = mockPolicyRepo.createApprovalRequest.mock.calls[0][0];
    expect(callArgs.requiredApprovals).toBe(1);
  });

  it('all-quorum: viewer/signer roles are not eligible approvers and do not count toward resolution', async () => {
    const allRequest = makePendingRequest({ quorumType: 'all', requiredApprovals: 1 });

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(allRequest)
      .mockResolvedValueOnce({
        ...allRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    // otherUserId (approver) approves; a viewer and a signer are also on the
    // wallet but neither holds an approving role, so they must not gate
    // resolution even though they have not voted.
    mockWalletSharingRepo.findWalletUsersWithUsername.mockResolvedValue([
      makeWalletUser(otherUserId, 'approver'),
      makeWalletUser(faker.string.uuid(), 'viewer'),
      makeWalletUser(faker.string.uuid(), 'signer'),
    ]);
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: requestId, status: 'approved' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });

  it('all-quorum: never resolves on an empty eligible set (requester was the sole approver)', async () => {
    // If the requester is the wallet's only approving-role member and
    // self-approval is disallowed, the live eligible set is empty. A vote
    // from anyone else must accumulate without ever satisfying "every
    // eligible approver voted" — that would approve a request with zero
    // eligible voters.
    const allRequest = makePendingRequest({ quorumType: 'all', requiredApprovals: 0, allowSelfApproval: false });

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(allRequest)
      .mockResolvedValueOnce({
        ...allRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    // 'creator' is the requester and the only wallet member with an
    // approving role; excluded because allowSelfApproval is false.
    mockWalletSharingRepo.findWalletUsersWithUsername.mockResolvedValue([
      makeWalletUser('creator', 'owner'),
    ]);
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
  });

  it('specific quorum: refuses every vote once the policy backing the request is gone', async () => {
    const specificRequest = makePendingRequest({ quorumType: 'specific', requiredApprovals: 1 });

    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(specificRequest);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    // The policy was deleted after the request was created.
    mockPolicyRepo.findPolicyById.mockResolvedValue(null);

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow('not an eligible approver');

    expect(mockPolicyRepo.createVote).not.toHaveBeenCalled();
  });

  it('specific quorum: refuses a vote when the policy config has no specificApprovers list at all', async () => {
    const specificRequest = makePendingRequest({ quorumType: 'specific', requiredApprovals: 1 });

    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(specificRequest);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    // The policy exists but its config predates specificApprovers, or the
    // field was stripped — the `?? []` fallback must still refuse the vote.
    mockPolicyRepo.findPolicyById.mockResolvedValue({ config: {} });

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow('not an eligible approver');

    expect(mockPolicyRepo.createVote).not.toHaveBeenCalled();
  });

  it('all-quorum: does not resolve when the backing draft is missing', async () => {
    const allRequest = makePendingRequest({ quorumType: 'all', requiredApprovals: 1 });

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(allRequest)
      .mockResolvedValueOnce({
        ...allRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    // The draft was deleted (or never existed) between request creation and
    // this vote, so there is no walletId to derive eligible approvers from.
    mockDraftRepo.findById.mockResolvedValue(null);
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
  });

  it('specific quorum: resolution does not count an approve vote from a user outside specificApprovers (e.g. cast before this fix, or before the policy was edited)', async () => {
    const thirdApproverId = faker.string.uuid();
    // specificApprovers is ['userId', thirdApproverId]; otherUserId is not on
    // the list. A vote of theirs can already be sitting in the repository —
    // either persisted before this fix shipped, or cast while they were
    // still listed and the policy was edited afterward.
    const specificRequest = makePendingRequest({
      quorumType: 'specific',
      requiredApprovals: 2,
    });

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(specificRequest)
      .mockResolvedValueOnce({
        ...specificRequest,
        votes: [
          { id: 'v-legacy', userId: otherUserId, decision: 'approve' },
          { id: 'v-new', userId, decision: 'approve' },
        ],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      config: { specificApprovers: [userId, thirdApproverId] },
    });
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v-new', decision: 'approve' });
    // Defensive: only reached if the (buggy) implementation wrongly resolves.
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);

    await approvalService.castVote(requestId, userId, 'approve');

    // Only userId's vote counts (1 of 2 required) — otherUserId's is not a
    // listed approver, so the request must stay pending.
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
  });

  it('specific quorum: resolves once enough listed approvers vote, ignoring an unlisted vote already on the request', async () => {
    const thirdApproverId = faker.string.uuid();
    const specificRequest = makePendingRequest({
      quorumType: 'specific',
      requiredApprovals: 2,
    });

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(specificRequest)
      .mockResolvedValueOnce({
        ...specificRequest,
        votes: [
          { id: 'v-legacy', userId: otherUserId, decision: 'approve' },
          { id: 'v-a', userId, decision: 'approve' },
          { id: 'v-c', userId: thirdApproverId, decision: 'approve' },
        ],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      config: { specificApprovers: [userId, thirdApproverId] },
    });
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v-c', decision: 'approve' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: requestId, status: 'approved' },
    ]);

    await approvalService.castVote(requestId, thirdApproverId, 'approve');

    // userId and thirdApproverId are both listed and have approved (2 of 2) —
    // the unlisted otherUserId vote must not be needed or double-counted.
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });
}
