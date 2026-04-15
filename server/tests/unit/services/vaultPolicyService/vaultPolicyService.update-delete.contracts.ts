import { describe, expect, it } from 'vitest';
import { faker } from '@faker-js/faker';

import {
  mockPolicyRepo,
  policyId,
  userId,
  vaultPolicyService,
  walletId,
} from './vaultPolicyServiceTestHarness';

export function registerVaultPolicyUpdateDeleteContracts(): void {
  describe('updatePolicy', () => {
    it('updates a policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'wallet',
        walletId,
      });

      mockPolicyRepo.updatePolicy.mockResolvedValue({
        id: policyId,
        name: 'Updated Name',
      });

      const result = await vaultPolicyService.updatePolicy(policyId, userId, {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
    });

    it('rejects updating non-existent policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue(null);

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, { name: 'x' })
      ).rejects.toThrow('Policy not found');
    });

    it('rejects invalid enforcement on update', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'wallet',
      });

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, {
          enforcement: 'invalid' as any,
        })
      ).rejects.toThrow('Invalid enforcement mode');
    });

    it('rejects updating system policies', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'system',
        walletId: null,
      });

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, { name: 'x' })
      ).rejects.toThrow('system policies');
    });

    it('rejects updating group policies from wallet context', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'group',
        walletId,
      });

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, { name: 'x' })
      ).rejects.toThrow('group policies');
    });
  });

  describe('deletePolicy', () => {
    it('deletes a wallet-level policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId,
        sourceType: 'wallet',
      });

      await vaultPolicyService.deletePolicy(policyId, walletId);

      expect(mockPolicyRepo.removePolicy).toHaveBeenCalledWith(policyId);
    });

    it('rejects deleting non-existent policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue(null);

      await expect(
        vaultPolicyService.deletePolicy(policyId, walletId)
      ).rejects.toThrow('Policy not found');
    });

    it('rejects deleting policy from wrong wallet', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId: faker.string.uuid(),
        sourceType: 'wallet',
      });

      await expect(
        vaultPolicyService.deletePolicy(policyId, walletId)
      ).rejects.toThrow('does not belong to this wallet');
    });

    it('rejects deleting inherited system policy from wallet', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId,
        sourceType: 'system',
      });

      await expect(
        vaultPolicyService.deletePolicy(policyId, walletId)
      ).rejects.toThrow('inherited');
    });

    it('allows deleting system policy without wallet context', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId: null,
        sourceType: 'system',
      });

      await vaultPolicyService.deletePolicy(policyId);

      expect(mockPolicyRepo.removePolicy).toHaveBeenCalledWith(policyId);
    });
  });

  describe('updatePolicy (additional branches)', () => {
    it('allows admin to update system policies', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'system',
      });
      mockPolicyRepo.updatePolicy.mockResolvedValue({ id: policyId, name: 'Updated' });

      const result = await vaultPolicyService.updatePolicy(
        policyId, userId, { name: 'Updated' }, { isAdmin: true }
      );
      expect(result.name).toBe('Updated');
    });

    it('allows admin to update group policies', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'group',
      });
      mockPolicyRepo.updatePolicy.mockResolvedValue({ id: policyId, name: 'Updated' });

      const result = await vaultPolicyService.updatePolicy(
        policyId, userId, { name: 'Updated' }, { isAdmin: true }
      );
      expect(result.name).toBe('Updated');
    });

    it('validates config when config is provided on update', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'wallet',
      });

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, {
          config: { scope: 'wallet' } as any,
        })
      ).rejects.toThrow('at least one non-zero limit');
    });
  });
}
