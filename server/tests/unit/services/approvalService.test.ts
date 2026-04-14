import { describe } from 'vitest';

import { registerCastVoteEventContracts } from './approvalService/approvalService.cast-vote-events.contracts';
import { registerCastVoteGuardContracts } from './approvalService/approvalService.cast-vote-guards.contracts';
import { registerCastVoteResolutionContracts } from './approvalService/approvalService.cast-vote-resolution.contracts';
import { registerCheckAndResolveRequestContracts } from './approvalService/approvalService.check-resolve.contracts';
import { registerCreateApprovalRequestsForDraftContracts } from './approvalService/approvalService.create.contracts';
import { registerUpdateDraftApprovalFromRequestsContracts } from './approvalService/approvalService.draft-status.contracts';
import { registerOwnerOverrideContracts } from './approvalService/approvalService.owner-override.contracts';
import {
  registerGetApprovalsForDraftContracts,
  registerGetPendingApprovalsForUserContracts,
} from './approvalService/approvalService.read-models.contracts';
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

  describe('getPendingApprovalsForUser', () => {
    registerGetPendingApprovalsForUserContracts();
  });

  describe('getApprovalsForDraft', () => {
    registerGetApprovalsForDraftContracts();
  });
});
