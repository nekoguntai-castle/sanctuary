import { describe } from 'vitest';

import { registerAnyNEligibilityContracts } from './approvalService/approvalService.any-n-eligibility.contracts';
import { registerCastVoteEventContracts } from './approvalService/approvalService.cast-vote-events.contracts';
import { registerCastVoteGuardContracts } from './approvalService/approvalService.cast-vote-guards.contracts';
import { registerCastVoteResolutionContracts } from './approvalService/approvalService.cast-vote-resolution.contracts';
import { registerCheckAndResolveRequestContracts } from './approvalService/approvalService.check-resolve.contracts';
import { registerConcurrentResolutionContracts } from './approvalService/approvalService.concurrent-resolution.contracts';
import { registerCreateApprovalRequestsForDraftContracts } from './approvalService/approvalService.create.contracts';
import { registerApprovalExpiryContracts } from './approvalService/approvalService.expiry.contracts';
import { registerUpdateDraftApprovalFromRequestsContracts } from './approvalService/approvalService.draft-status.contracts';
import { registerOwnerOverrideContracts } from './approvalService/approvalService.owner-override.contracts';
import {
  registerGetApprovalsForDraftContracts,
  registerGetPendingApprovalsForUserContracts,
} from './approvalService/approvalService.read-models.contracts';
import { registerQuorumMembershipContracts } from './approvalService/approvalService.quorum-membership.contracts';
import { registerSpecificEligibilityContracts } from './approvalService/approvalService.specific-eligibility.contracts';
import { registerResolvedDraftContracts } from './approvalService/approvalService.resolved-draft.contracts';
import { registerApprovalServiceTestHarness } from './approvalService/approvalServiceTestHarness';

describe('ApprovalService', () => {
  registerApprovalServiceTestHarness();

  describe('createApprovalRequestsForDraft', () => {
    registerCreateApprovalRequestsForDraftContracts();
  });

  describe('castVote', () => {
    registerCastVoteGuardContracts();
    registerCastVoteResolutionContracts();
    registerCastVoteEventContracts();
  });

  describe('checkAndResolveRequest (indirect)', () => {
    registerCheckAndResolveRequestContracts();
  });

  describe('updateDraftApprovalFromRequests (indirect)', () => {
    registerUpdateDraftApprovalFromRequestsContracts();
  });

  describe('ownerOverride', () => {
    registerOwnerOverrideContracts();
  });

  describe('approval expiry', () => {
    registerApprovalExpiryContracts();
  });

  describe('concurrent resolution', () => {
    registerConcurrentResolutionContracts();
  });

  describe('quorum membership (specific & all)', () => {
    registerQuorumMembershipContracts();
  });

  describe('quorum membership (any_n)', () => {
    registerAnyNEligibilityContracts();
  });

  describe('quorum membership (specific)', () => {
    registerSpecificEligibilityContracts();
  });

  describe('resolved drafts stay resolved', () => {
    registerResolvedDraftContracts();
  });

  describe('getPendingApprovalsForUser', () => {
    registerGetPendingApprovalsForUserContracts();
  });

  describe('getApprovalsForDraft', () => {
    registerGetApprovalsForDraftContracts();
  });
});
