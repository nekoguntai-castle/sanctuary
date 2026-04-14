import { prisma, type Mock } from './policyRepositoryTestHarness';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../../../../src/generated/prisma/client';
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
} from '../../../../src/repositories/policyRepository';

export const registerPolicyRepositoryUsageExportContracts = () => {
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
};
