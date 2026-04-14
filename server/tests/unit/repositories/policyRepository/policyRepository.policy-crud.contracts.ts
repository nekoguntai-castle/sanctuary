import { prisma, type Mock } from './policyRepositoryTestHarness';
import { describe, expect, it } from 'vitest';
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
} from '../../../../src/repositories/policyRepository';

export const registerPolicyRepositoryCrudContracts = () => {
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
};
