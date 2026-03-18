import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    vaultPolicy: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    approvalRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    approvalVote: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    policyEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    policyAddress: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    policyUsageWindow: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import {
  findPoliciesByWalletId,
  findAllPoliciesForWallet,
  findSystemPolicies,
  findGroupPolicies,
  findPolicyById,
  findPolicyByIdInWallet,
  createPolicy,
  updatePolicy,
  removePolicy,
  countPoliciesByWalletId,
  findApprovalRequestsByDraftId,
  findApprovalRequestById,
  findPendingApprovalsForUser,
  createApprovalRequest,
  updateApprovalRequestStatus,
  countPendingApprovalsByDraftId,
  createVote,
  findVoteByUserAndRequest,
  createPolicyEvent,
  findPolicyEvents,
  findPolicyAddresses,
  createPolicyAddress,
  removePolicyAddress,
  findPolicyAddressByAddress,
  findPolicyAddressById,
  findOrCreateUsageWindow,
  incrementUsageWindow,
  decrementUsageWindow,
  policyRepository,
} from '../../../src/repositories/policyRepository';

describe('policyRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // VAULT POLICY CRUD
  // ========================================

  describe('findPoliciesByWalletId', () => {
    it('queries enabled policies for wallet ordered by priority asc', async () => {
      const policies = [{ id: 'p1' }, { id: 'p2' }];
      (prisma.vaultPolicy.findMany as Mock).mockResolvedValue(policies);

      const result = await findPoliciesByWalletId('wallet-1');

      expect(result).toEqual(policies);
      expect(prisma.vaultPolicy.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', enabled: true },
        orderBy: { priority: 'asc' },
      });
    });
  });

  describe('findAllPoliciesForWallet', () => {
    it('queries all policies for wallet ordered by priority then createdAt', async () => {
      const policies = [{ id: 'p1' }];
      (prisma.vaultPolicy.findMany as Mock).mockResolvedValue(policies);

      const result = await findAllPoliciesForWallet('wallet-1');

      expect(result).toEqual(policies);
      expect(prisma.vaultPolicy.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('findSystemPolicies', () => {
    it('queries system policies with null walletId and groupId', async () => {
      const policies = [{ id: 'sys-1' }];
      (prisma.vaultPolicy.findMany as Mock).mockResolvedValue(policies);

      const result = await findSystemPolicies();

      expect(result).toEqual(policies);
      expect(prisma.vaultPolicy.findMany).toHaveBeenCalledWith({
        where: { walletId: null, groupId: null, sourceType: 'system' },
        orderBy: { priority: 'asc' },
      });
    });
  });

  describe('findGroupPolicies', () => {
    it('queries policies by groupId ordered by priority', async () => {
      const policies = [{ id: 'gp-1' }];
      (prisma.vaultPolicy.findMany as Mock).mockResolvedValue(policies);

      const result = await findGroupPolicies('group-1');

      expect(result).toEqual(policies);
      expect(prisma.vaultPolicy.findMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1' },
        orderBy: { priority: 'asc' },
      });
    });
  });

  describe('findPolicyById', () => {
    it('finds a policy by its id', async () => {
      const policy = { id: 'p1', name: 'Test Policy' };
      (prisma.vaultPolicy.findUnique as Mock).mockResolvedValue(policy);

      const result = await findPolicyById('p1');

      expect(result).toEqual(policy);
      expect(prisma.vaultPolicy.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
    });

    it('returns null when policy not found', async () => {
      (prisma.vaultPolicy.findUnique as Mock).mockResolvedValue(null);

      const result = await findPolicyById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findPolicyByIdInWallet', () => {
    it('finds a policy by id and walletId', async () => {
      const policy = { id: 'p1', walletId: 'wallet-1' };
      (prisma.vaultPolicy.findFirst as Mock).mockResolvedValue(policy);

      const result = await findPolicyByIdInWallet('p1', 'wallet-1');

      expect(result).toEqual(policy);
      expect(prisma.vaultPolicy.findFirst).toHaveBeenCalledWith({
        where: { id: 'p1', walletId: 'wallet-1' },
      });
    });

    it('returns null when policy not found in wallet', async () => {
      (prisma.vaultPolicy.findFirst as Mock).mockResolvedValue(null);

      const result = await findPolicyByIdInWallet('p1', 'wallet-wrong');

      expect(result).toBeNull();
    });
  });

  describe('createPolicy', () => {
    it('creates a policy with all required fields and defaults', async () => {
      const created = { id: 'new-policy' };
      (prisma.vaultPolicy.create as Mock).mockResolvedValue(created);

      const result = await createPolicy({
        name: 'Spending Limit',
        type: 'spending_limit',
        config: { perTransaction: 100000 },
        createdBy: 'user-1',
      });

      expect(result).toEqual(created);
      expect(prisma.vaultPolicy.create).toHaveBeenCalledWith({
        data: {
          walletId: null,
          groupId: null,
          name: 'Spending Limit',
          description: null,
          type: 'spending_limit',
          config: { perTransaction: 100000 },
          priority: 0,
          enforcement: 'enforce',
          enabled: true,
          createdBy: 'user-1',
          sourceType: 'wallet',
          sourceId: null,
        },
      });
    });

    it('creates a policy with all optional fields provided', async () => {
      const created = { id: 'new-policy-full' };
      (prisma.vaultPolicy.create as Mock).mockResolvedValue(created);

      const result = await createPolicy({
        walletId: 'wallet-1',
        groupId: 'group-1',
        name: 'Full Policy',
        description: 'A complete policy',
        type: 'approval_required',
        config: { requiredApprovals: 2 },
        priority: 5,
        enforcement: 'monitor',
        enabled: false,
        createdBy: 'user-1',
        sourceType: 'system',
        sourceId: 'source-1',
      });

      expect(result).toEqual(created);
      expect(prisma.vaultPolicy.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-1',
          groupId: 'group-1',
          name: 'Full Policy',
          description: 'A complete policy',
          type: 'approval_required',
          config: { requiredApprovals: 2 },
          priority: 5,
          enforcement: 'monitor',
          enabled: false,
          createdBy: 'user-1',
          sourceType: 'system',
          sourceId: 'source-1',
        },
      });
    });
  });

  describe('updatePolicy', () => {
    it('updates only specified fields', async () => {
      const updated = { id: 'p1', name: 'Updated' };
      (prisma.vaultPolicy.update as Mock).mockResolvedValue(updated);

      const result = await updatePolicy('p1', { name: 'Updated' });

      expect(result).toEqual(updated);
      expect(prisma.vaultPolicy.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Updated' },
      });
    });

    it('updates all optional fields', async () => {
      const updated = { id: 'p1' };
      (prisma.vaultPolicy.update as Mock).mockResolvedValue(updated);

      const result = await updatePolicy('p1', {
        name: 'New Name',
        description: 'New Desc',
        config: { daily: 500000 },
        priority: 10,
        enforcement: 'monitor',
        enabled: false,
        updatedBy: 'user-2',
      });

      expect(result).toEqual(updated);
      expect(prisma.vaultPolicy.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          name: 'New Name',
          description: 'New Desc',
          config: { daily: 500000 },
          priority: 10,
          enforcement: 'monitor',
          enabled: false,
          updatedBy: 'user-2',
        },
      });
    });

    it('passes empty data object when no fields provided', async () => {
      const updated = { id: 'p1' };
      (prisma.vaultPolicy.update as Mock).mockResolvedValue(updated);

      await updatePolicy('p1', {});

      expect(prisma.vaultPolicy.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {},
      });
    });
  });

  describe('removePolicy', () => {
    it('deletes a policy by id', async () => {
      (prisma.vaultPolicy.delete as Mock).mockResolvedValue(undefined);

      await removePolicy('p1');

      expect(prisma.vaultPolicy.delete).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
    });
  });

  describe('countPoliciesByWalletId', () => {
    it('counts policies for a wallet', async () => {
      (prisma.vaultPolicy.count as Mock).mockResolvedValue(7);

      const result = await countPoliciesByWalletId('wallet-1');

      expect(result).toBe(7);
      expect(prisma.vaultPolicy.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
      });
    });
  });

  // ========================================
  // APPROVAL REQUESTS
  // ========================================

  describe('findApprovalRequestsByDraftId', () => {
    it('finds approval requests with votes by draftTransactionId', async () => {
      const requests = [{ id: 'ar1', votes: [{ id: 'v1' }] }];
      (prisma.approvalRequest.findMany as Mock).mockResolvedValue(requests);

      const result = await findApprovalRequestsByDraftId('draft-1');

      expect(result).toEqual(requests);
      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: { draftTransactionId: 'draft-1' },
        include: { votes: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findApprovalRequestById', () => {
    it('finds an approval request with votes by id', async () => {
      const request = { id: 'ar1', votes: [] };
      (prisma.approvalRequest.findUnique as Mock).mockResolvedValue(request);

      const result = await findApprovalRequestById('ar1');

      expect(result).toEqual(request);
      expect(prisma.approvalRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'ar1' },
        include: { votes: true },
      });
    });

    it('returns null when not found', async () => {
      (prisma.approvalRequest.findUnique as Mock).mockResolvedValue(null);

      const result = await findApprovalRequestById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findPendingApprovalsForUser', () => {
    it('returns empty array when walletIds is empty', async () => {
      const result = await findPendingApprovalsForUser([]);

      expect(result).toEqual([]);
      expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
    });

    it('finds pending approvals for given walletIds', async () => {
      const approvals = [
        {
          id: 'ar1',
          votes: [],
          draftTransaction: { walletId: 'w1', recipient: 'addr1', amount: BigInt(1000) },
        },
      ];
      (prisma.approvalRequest.findMany as Mock).mockResolvedValue(approvals);

      const result = await findPendingApprovalsForUser(['w1', 'w2']);

      expect(result).toEqual(approvals);
      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          draftTransaction: {
            walletId: { in: ['w1', 'w2'] },
          },
        },
        include: {
          votes: true,
          draftTransaction: {
            select: { walletId: true, recipient: true, amount: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('createApprovalRequest', () => {
    it('creates an approval request with defaults', async () => {
      const created = { id: 'ar-new' };
      (prisma.approvalRequest.create as Mock).mockResolvedValue(created);

      const result = await createApprovalRequest({
        draftTransactionId: 'draft-1',
        policyId: 'policy-1',
        requiredApprovals: 2,
      });

      expect(result).toEqual(created);
      expect(prisma.approvalRequest.create).toHaveBeenCalledWith({
        data: {
          draftTransactionId: 'draft-1',
          policyId: 'policy-1',
          requiredApprovals: 2,
          quorumType: 'any_n',
          allowSelfApproval: false,
          vetoDeadline: null,
          expiresAt: null,
        },
      });
    });

    it('creates an approval request with all optional fields', async () => {
      const created = { id: 'ar-full' };
      const vetoDeadline = new Date('2026-06-01T00:00:00Z');
      const expiresAt = new Date('2026-07-01T00:00:00Z');
      (prisma.approvalRequest.create as Mock).mockResolvedValue(created);

      const result = await createApprovalRequest({
        draftTransactionId: 'draft-2',
        policyId: 'policy-2',
        requiredApprovals: 3,
        quorumType: 'specific',
        allowSelfApproval: true,
        vetoDeadline,
        expiresAt,
      });

      expect(result).toEqual(created);
      expect(prisma.approvalRequest.create).toHaveBeenCalledWith({
        data: {
          draftTransactionId: 'draft-2',
          policyId: 'policy-2',
          requiredApprovals: 3,
          quorumType: 'specific',
          allowSelfApproval: true,
          vetoDeadline,
          expiresAt,
        },
      });
    });
  });

  describe('updateApprovalRequestStatus', () => {
    it('updates status to approved with explicit resolvedAt', async () => {
      const resolvedAt = new Date('2026-03-15T12:00:00Z');
      const updated = { id: 'ar1', status: 'approved', resolvedAt };
      (prisma.approvalRequest.update as Mock).mockResolvedValue(updated);

      const result = await updateApprovalRequestStatus('ar1', 'approved', resolvedAt);

      expect(result).toEqual(updated);
      expect(prisma.approvalRequest.update).toHaveBeenCalledWith({
        where: { id: 'ar1' },
        data: {
          status: 'approved',
          resolvedAt,
        },
      });
    });

    it('auto-generates resolvedAt for non-pending status without explicit date', async () => {
      const updated = { id: 'ar1', status: 'rejected' };
      (prisma.approvalRequest.update as Mock).mockResolvedValue(updated);

      const result = await updateApprovalRequestStatus('ar1', 'rejected');

      expect(result).toEqual(updated);
      expect(prisma.approvalRequest.update).toHaveBeenCalledWith({
        where: { id: 'ar1' },
        data: {
          status: 'rejected',
          resolvedAt: expect.any(Date),
        },
      });
    });

    it('sets resolvedAt to null when status is pending without explicit date', async () => {
      const updated = { id: 'ar1', status: 'pending' };
      (prisma.approvalRequest.update as Mock).mockResolvedValue(updated);

      const result = await updateApprovalRequestStatus('ar1', 'pending');

      expect(result).toEqual(updated);
      expect(prisma.approvalRequest.update).toHaveBeenCalledWith({
        where: { id: 'ar1' },
        data: {
          status: 'pending',
          resolvedAt: null,
        },
      });
    });
  });

  describe('countPendingApprovalsByDraftId', () => {
    it('counts pending approvals for a draft', async () => {
      (prisma.approvalRequest.count as Mock).mockResolvedValue(3);

      const result = await countPendingApprovalsByDraftId('draft-1');

      expect(result).toBe(3);
      expect(prisma.approvalRequest.count).toHaveBeenCalledWith({
        where: { draftTransactionId: 'draft-1', status: 'pending' },
      });
    });
  });

  // ========================================
  // APPROVAL VOTES
  // ========================================

  describe('createVote', () => {
    it('creates a vote with defaults', async () => {
      const created = { id: 'vote-1' };
      (prisma.approvalVote.create as Mock).mockResolvedValue(created);

      const result = await createVote({
        approvalRequestId: 'ar1',
        userId: 'user-1',
        decision: 'approve',
      });

      expect(result).toEqual(created);
      expect(prisma.approvalVote.create).toHaveBeenCalledWith({
        data: {
          approvalRequestId: 'ar1',
          userId: 'user-1',
          decision: 'approve',
          reason: null,
        },
      });
    });

    it('creates a vote with reason', async () => {
      const created = { id: 'vote-2' };
      (prisma.approvalVote.create as Mock).mockResolvedValue(created);

      const result = await createVote({
        approvalRequestId: 'ar1',
        userId: 'user-2',
        decision: 'reject',
        reason: 'Amount too high',
      });

      expect(result).toEqual(created);
      expect(prisma.approvalVote.create).toHaveBeenCalledWith({
        data: {
          approvalRequestId: 'ar1',
          userId: 'user-2',
          decision: 'reject',
          reason: 'Amount too high',
        },
      });
    });
  });

  describe('findVoteByUserAndRequest', () => {
    it('finds a vote by composite key', async () => {
      const vote = { id: 'vote-1', decision: 'approve' };
      (prisma.approvalVote.findUnique as Mock).mockResolvedValue(vote);

      const result = await findVoteByUserAndRequest('ar1', 'user-1');

      expect(result).toEqual(vote);
      expect(prisma.approvalVote.findUnique).toHaveBeenCalledWith({
        where: {
          approvalRequestId_userId: {
            approvalRequestId: 'ar1',
            userId: 'user-1',
          },
        },
      });
    });

    it('returns null when vote not found', async () => {
      (prisma.approvalVote.findUnique as Mock).mockResolvedValue(null);

      const result = await findVoteByUserAndRequest('ar1', 'user-nonexistent');

      expect(result).toBeNull();
    });
  });

  // ========================================
  // POLICY EVENTS
  // ========================================

  describe('createPolicyEvent', () => {
    it('creates an event with defaults for optional fields', async () => {
      const created = { id: 'event-1' };
      (prisma.policyEvent.create as Mock).mockResolvedValue(created);

      const result = await createPolicyEvent({
        walletId: 'wallet-1',
        eventType: 'policy_triggered',
        details: { reason: 'spending_limit exceeded' },
      });

      expect(result).toEqual(created);
      expect(prisma.policyEvent.create).toHaveBeenCalledWith({
        data: {
          policyId: null,
          walletId: 'wallet-1',
          draftTransactionId: null,
          userId: null,
          eventType: 'policy_triggered',
          details: { reason: 'spending_limit exceeded' },
        },
      });
    });

    it('creates an event with all optional fields provided', async () => {
      const created = { id: 'event-2' };
      (prisma.policyEvent.create as Mock).mockResolvedValue(created);

      const result = await createPolicyEvent({
        policyId: 'policy-1',
        walletId: 'wallet-1',
        draftTransactionId: 'draft-1',
        userId: 'user-1',
        eventType: 'approval_granted',
        details: { votes: 2 },
      });

      expect(result).toEqual(created);
      expect(prisma.policyEvent.create).toHaveBeenCalledWith({
        data: {
          policyId: 'policy-1',
          walletId: 'wallet-1',
          draftTransactionId: 'draft-1',
          userId: 'user-1',
          eventType: 'approval_granted',
          details: { votes: 2 },
        },
      });
    });
  });

  describe('findPolicyEvents', () => {
    it('queries events with default limit and offset when no options provided', async () => {
      const events = [{ id: 'ev1' }];
      (prisma.policyEvent.findMany as Mock).mockResolvedValue(events);
      (prisma.policyEvent.count as Mock).mockResolvedValue(1);

      const result = await findPolicyEvents('wallet-1');

      expect(result).toEqual({ events, total: 1 });
      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
      expect(prisma.policyEvent.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
      });
    });

    it('includes policyId filter when provided', async () => {
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { policyId: 'policy-1' });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', policyId: 'policy-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes eventType filter when provided', async () => {
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { eventType: 'policy_triggered' });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', eventType: 'policy_triggered' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes date range filter with both from and to', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-12-31T23:59:59Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { from, to });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes date range filter with only from', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { from });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          createdAt: { gte: from },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes date range filter with only to', async () => {
      const to = new Date('2026-12-31T23:59:59Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { to });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          createdAt: { lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('uses custom limit and offset', async () => {
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(100);

      const result = await findPolicyEvents('wallet-1', { limit: 10, offset: 20 });

      expect(result).toEqual({ events: [], total: 100 });
      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 20,
      });
    });

    it('combines all filters together', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-06-01T00:00:00Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', {
        policyId: 'policy-1',
        eventType: 'blocked',
        from,
        to,
        limit: 5,
        offset: 10,
      });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          policyId: 'policy-1',
          eventType: 'blocked',
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        skip: 10,
      });
    });
  });

  // ========================================
  // POLICY ADDRESSES
  // ========================================

  describe('findPolicyAddresses', () => {
    it('finds addresses for a policy without listType filter', async () => {
      const addresses = [{ id: 'addr-1' }];
      (prisma.policyAddress.findMany as Mock).mockResolvedValue(addresses);

      const result = await findPolicyAddresses('policy-1');

      expect(result).toEqual(addresses);
      expect(prisma.policyAddress.findMany).toHaveBeenCalledWith({
        where: { policyId: 'policy-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('finds addresses for a policy with listType filter', async () => {
      const addresses = [{ id: 'addr-1', listType: 'allow' }];
      (prisma.policyAddress.findMany as Mock).mockResolvedValue(addresses);

      const result = await findPolicyAddresses('policy-1', 'allow');

      expect(result).toEqual(addresses);
      expect(prisma.policyAddress.findMany).toHaveBeenCalledWith({
        where: { policyId: 'policy-1', listType: 'allow' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('createPolicyAddress', () => {
    it('creates a policy address with defaults', async () => {
      const created = { id: 'pa-1' };
      (prisma.policyAddress.create as Mock).mockResolvedValue(created);

      const result = await createPolicyAddress({
        policyId: 'policy-1',
        address: 'bc1qtest',
        listType: 'allow',
        addedBy: 'user-1',
      });

      expect(result).toEqual(created);
      expect(prisma.policyAddress.create).toHaveBeenCalledWith({
        data: {
          policyId: 'policy-1',
          address: 'bc1qtest',
          label: null,
          listType: 'allow',
          addedBy: 'user-1',
        },
      });
    });

    it('creates a policy address with label', async () => {
      const created = { id: 'pa-2' };
      (prisma.policyAddress.create as Mock).mockResolvedValue(created);

      const result = await createPolicyAddress({
        policyId: 'policy-1',
        address: 'bc1qlabeled',
        label: 'Exchange withdrawal',
        listType: 'deny',
        addedBy: 'user-2',
      });

      expect(result).toEqual(created);
      expect(prisma.policyAddress.create).toHaveBeenCalledWith({
        data: {
          policyId: 'policy-1',
          address: 'bc1qlabeled',
          label: 'Exchange withdrawal',
          listType: 'deny',
          addedBy: 'user-2',
        },
      });
    });
  });

  describe('removePolicyAddress', () => {
    it('deletes a policy address by id', async () => {
      (prisma.policyAddress.delete as Mock).mockResolvedValue(undefined);

      await removePolicyAddress('pa-1');

      expect(prisma.policyAddress.delete).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
      });
    });
  });

  describe('findPolicyAddressByAddress', () => {
    it('finds a policy address by composite key', async () => {
      const address = { id: 'pa-1', address: 'bc1qtest' };
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(address);

      const result = await findPolicyAddressByAddress('policy-1', 'bc1qtest');

      expect(result).toEqual(address);
      expect(prisma.policyAddress.findUnique).toHaveBeenCalledWith({
        where: {
          policyId_address: {
            policyId: 'policy-1',
            address: 'bc1qtest',
          },
        },
      });
    });

    it('returns null when address not found', async () => {
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(null);

      const result = await findPolicyAddressByAddress('policy-1', 'bc1qmissing');

      expect(result).toBeNull();
    });
  });

  describe('findPolicyAddressById', () => {
    it('finds a policy address by id', async () => {
      const address = { id: 'pa-1' };
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(address);

      const result = await findPolicyAddressById('pa-1');

      expect(result).toEqual(address);
      expect(prisma.policyAddress.findUnique).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
      });
    });

    it('returns null when not found', async () => {
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(null);

      const result = await findPolicyAddressById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ========================================
  // POLICY USAGE WINDOWS
  // ========================================

  describe('findOrCreateUsageWindow', () => {
    const windowData = {
      policyId: 'policy-1',
      walletId: 'wallet-1',
      windowType: 'daily' as const,
      windowStart: new Date('2026-03-17T00:00:00Z'),
      windowEnd: new Date('2026-03-18T00:00:00Z'),
    };

    it('returns existing window when found (fast path)', async () => {
      const existing = {
        id: 'window-1',
        totalSpent: BigInt(5000),
        txCount: 3,
      };
      (prisma.policyUsageWindow.findFirst as Mock).mockResolvedValue(existing);

      const result = await findOrCreateUsageWindow(windowData);

      expect(result).toEqual({
        id: 'window-1',
        totalSpent: BigInt(5000),
        txCount: 3,
      });
      expect(prisma.policyUsageWindow.findFirst).toHaveBeenCalledWith({
        where: {
          policyId: 'policy-1',
          walletId: 'wallet-1',
          userId: null,
          windowType: 'daily',
          windowStart: windowData.windowStart,
        },
      });
      expect(prisma.policyUsageWindow.create).not.toHaveBeenCalled();
    });

    it('creates a new window when not found', async () => {
      (prisma.policyUsageWindow.findFirst as Mock).mockResolvedValue(null);
      const created = {
        id: 'window-new',
        totalSpent: BigInt(0),
        txCount: 0,
      };
      (prisma.policyUsageWindow.create as Mock).mockResolvedValue(created);

      const result = await findOrCreateUsageWindow(windowData);

      expect(result).toEqual({
        id: 'window-new',
        totalSpent: BigInt(0),
        txCount: 0,
      });
      expect(prisma.policyUsageWindow.create).toHaveBeenCalledWith({
        data: {
          policyId: 'policy-1',
          walletId: 'wallet-1',
          userId: null,
          windowType: 'daily',
          windowStart: windowData.windowStart,
          windowEnd: windowData.windowEnd,
          totalSpent: BigInt(0),
          txCount: 0,
        },
      });
    });

    it('creates window with userId when provided', async () => {
      (prisma.policyUsageWindow.findFirst as Mock).mockResolvedValue(null);
      const created = { id: 'window-user', totalSpent: BigInt(0), txCount: 0 };
      (prisma.policyUsageWindow.create as Mock).mockResolvedValue(created);

      const dataWithUser = { ...windowData, userId: 'user-1' };
      const result = await findOrCreateUsageWindow(dataWithUser);

      expect(result).toEqual({ id: 'window-user', totalSpent: BigInt(0), txCount: 0 });
      expect(prisma.policyUsageWindow.findFirst).toHaveBeenCalledWith({
        where: {
          policyId: 'policy-1',
          walletId: 'wallet-1',
          userId: 'user-1',
          windowType: 'daily',
          windowStart: windowData.windowStart,
        },
      });
      expect(prisma.policyUsageWindow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1' }),
      });
    });

    it('retries find on P2002 unique constraint violation and returns found record', async () => {
      (prisma.policyUsageWindow.findFirst as Mock)
        .mockResolvedValueOnce(null) // fast path miss
        .mockResolvedValueOnce({
          // retry finds it
          id: 'window-concurrent',
          totalSpent: BigInt(100),
          txCount: 1,
        });

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      });
      (prisma.policyUsageWindow.create as Mock).mockRejectedValue(p2002Error);

      const result = await findOrCreateUsageWindow(windowData);

      expect(result).toEqual({
        id: 'window-concurrent',
        totalSpent: BigInt(100),
        txCount: 1,
      });
      expect(prisma.policyUsageWindow.findFirst).toHaveBeenCalledTimes(2);
    });

    it('throws when P2002 retry also fails to find the record', async () => {
      (prisma.policyUsageWindow.findFirst as Mock)
        .mockResolvedValueOnce(null) // fast path miss
        .mockResolvedValueOnce(null); // retry also misses

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      });
      (prisma.policyUsageWindow.create as Mock).mockRejectedValue(p2002Error);

      await expect(findOrCreateUsageWindow(windowData)).rejects.toThrow(
        Prisma.PrismaClientKnownRequestError
      );
    });

    it('rethrows non-P2002 Prisma errors', async () => {
      (prisma.policyUsageWindow.findFirst as Mock).mockResolvedValue(null);

      const otherPrismaError = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: 'test',
      });
      (prisma.policyUsageWindow.create as Mock).mockRejectedValue(otherPrismaError);

      await expect(findOrCreateUsageWindow(windowData)).rejects.toThrow(
        Prisma.PrismaClientKnownRequestError
      );
      // Retry find should NOT be called for non-P2002 errors
      expect(prisma.policyUsageWindow.findFirst).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-Prisma errors', async () => {
      (prisma.policyUsageWindow.findFirst as Mock).mockResolvedValue(null);

      const genericError = new Error('Connection failed');
      (prisma.policyUsageWindow.create as Mock).mockRejectedValue(genericError);

      await expect(findOrCreateUsageWindow(windowData)).rejects.toThrow('Connection failed');
      expect(prisma.policyUsageWindow.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('incrementUsageWindow', () => {
    it('increments totalSpent and txCount', async () => {
      (prisma.policyUsageWindow.update as Mock).mockResolvedValue(undefined);

      await incrementUsageWindow('window-1', BigInt(25000));

      expect(prisma.policyUsageWindow.update).toHaveBeenCalledWith({
        where: { id: 'window-1' },
        data: {
          totalSpent: { increment: BigInt(25000) },
          txCount: { increment: 1 },
        },
      });
    });
  });

  describe('decrementUsageWindow', () => {
    it('decrements totalSpent and txCount', async () => {
      (prisma.policyUsageWindow.update as Mock).mockResolvedValue(undefined);

      await decrementUsageWindow('window-1', BigInt(10000));

      expect(prisma.policyUsageWindow.update).toHaveBeenCalledWith({
        where: { id: 'window-1' },
        data: {
          totalSpent: { decrement: BigInt(10000) },
          txCount: { decrement: 1 },
        },
      });
    });
  });

  // ========================================
  // EXPORT
  // ========================================

  describe('policyRepository export', () => {
    it('exports all policy CRUD operations', () => {
      expect(policyRepository.findPoliciesByWalletId).toBe(findPoliciesByWalletId);
      expect(policyRepository.findAllPoliciesForWallet).toBe(findAllPoliciesForWallet);
      expect(policyRepository.findSystemPolicies).toBe(findSystemPolicies);
      expect(policyRepository.findGroupPolicies).toBe(findGroupPolicies);
      expect(policyRepository.findPolicyById).toBe(findPolicyById);
      expect(policyRepository.findPolicyByIdInWallet).toBe(findPolicyByIdInWallet);
      expect(policyRepository.createPolicy).toBe(createPolicy);
      expect(policyRepository.updatePolicy).toBe(updatePolicy);
      expect(policyRepository.removePolicy).toBe(removePolicy);
      expect(policyRepository.countPoliciesByWalletId).toBe(countPoliciesByWalletId);
    });

    it('exports all approval request operations', () => {
      expect(policyRepository.findApprovalRequestsByDraftId).toBe(findApprovalRequestsByDraftId);
      expect(policyRepository.findApprovalRequestById).toBe(findApprovalRequestById);
      expect(policyRepository.findPendingApprovalsForUser).toBe(findPendingApprovalsForUser);
      expect(policyRepository.createApprovalRequest).toBe(createApprovalRequest);
      expect(policyRepository.updateApprovalRequestStatus).toBe(updateApprovalRequestStatus);
      expect(policyRepository.countPendingApprovalsByDraftId).toBe(countPendingApprovalsByDraftId);
    });

    it('exports all vote operations', () => {
      expect(policyRepository.createVote).toBe(createVote);
      expect(policyRepository.findVoteByUserAndRequest).toBe(findVoteByUserAndRequest);
    });

    it('exports all event operations', () => {
      expect(policyRepository.createPolicyEvent).toBe(createPolicyEvent);
      expect(policyRepository.findPolicyEvents).toBe(findPolicyEvents);
    });

    it('exports all address operations', () => {
      expect(policyRepository.findPolicyAddresses).toBe(findPolicyAddresses);
      expect(policyRepository.createPolicyAddress).toBe(createPolicyAddress);
      expect(policyRepository.removePolicyAddress).toBe(removePolicyAddress);
      expect(policyRepository.findPolicyAddressByAddress).toBe(findPolicyAddressByAddress);
      expect(policyRepository.findPolicyAddressById).toBe(findPolicyAddressById);
    });

    it('exports all usage window operations', () => {
      expect(policyRepository.findOrCreateUsageWindow).toBe(findOrCreateUsageWindow);
      expect(policyRepository.incrementUsageWindow).toBe(incrementUsageWindow);
      expect(policyRepository.decrementUsageWindow).toBe(decrementUsageWindow);
    });
  });
});
