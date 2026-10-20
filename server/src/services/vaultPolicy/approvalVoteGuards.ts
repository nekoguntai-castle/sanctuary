/**
 * Pure vote guards shared by castVote and the mobile agent reject path, so the
 * mobile pre-check cannot drift from what castVote enforces.
 */
import type { ApprovalRequest } from '../../generated/prisma/client';

/** True when the user already has a vote on the (vote-loaded) request. */
export const hasUserVoted = (request: { votes: Array<{ userId: string }> }, userId: string): boolean =>
  request.votes.some((vote) => vote.userId === userId);

/** True when the draft's creator is voting on a request that forbids self-approval. */
export const isSelfApprovalBlocked = (
  request: Pick<ApprovalRequest, 'allowSelfApproval'>,
  draftUserId: string,
  userId: string
): boolean => draftUserId === userId && !request.allowSelfApproval;
