import { describe, expect, it } from 'vitest';

import {
  groupId,
  mockPolicyRepo,
  mockWalletRepo,
  policyId,
  userId,
  vaultPolicyService,
  walletId,
} from './vaultPolicyServiceTestHarness';

export function registerVaultPolicyReadAddressContracts(): void {
  describe('getWalletPolicies', () => {
    it('returns wallet-only policies by default', async () => {
      const mockPolicies = [
        { id: '1', name: 'P1', walletId, type: 'spending_limit' },
      ];
      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue(mockPolicies);

      const result = await vaultPolicyService.getWalletPolicies(walletId);

      expect(result).toHaveLength(1);
      expect(mockPolicyRepo.findSystemPolicies).not.toHaveBeenCalled();
    });

    it('includes inherited system and group policies', async () => {
      const walletPolicies = [{ id: '1', name: 'Wallet', walletId }];
      const systemPolicies = [{ id: '2', name: 'System', walletId: null }];
      const groupPolicies = [{ id: '3', name: 'Group', groupId }];

      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue(walletPolicies);
      mockPolicyRepo.findSystemPolicies.mockResolvedValue(systemPolicies);
      mockPolicyRepo.findGroupPolicies.mockResolvedValue(groupPolicies);

      const result = await vaultPolicyService.getWalletPolicies(walletId, {
        includeInherited: true,
        walletGroupId: groupId,
      });

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('System');
      expect(result[1].name).toBe('Group');
      expect(result[2].name).toBe('Wallet');
    });

    it('skips group policies if no groupId', async () => {
      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue([]);
      mockPolicyRepo.findSystemPolicies.mockResolvedValue([]);

      const result = await vaultPolicyService.getWalletPolicies(walletId, {
        includeInherited: true,
        walletGroupId: null,
      });

      expect(mockPolicyRepo.findGroupPolicies).not.toHaveBeenCalled();
      expect(result).toHaveLength(0);
    });
  });

  describe('listWalletPolicies', () => {
    it('resolves the wallet group before listing inherited policies', async () => {
      const walletPolicies = [{ id: '1', name: 'Wallet', walletId }];
      const systemPolicies = [{ id: '2', name: 'System', walletId: null }];
      const groupPolicies = [{ id: '3', name: 'Group', groupId }];

      mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId });
      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue(walletPolicies);
      mockPolicyRepo.findSystemPolicies.mockResolvedValue(systemPolicies);
      mockPolicyRepo.findGroupPolicies.mockResolvedValue(groupPolicies);

      const result = await vaultPolicyService.listWalletPolicies(walletId, {
        includeInherited: true,
      });

      expect(mockWalletRepo.findById).toHaveBeenCalledWith(walletId);
      expect(mockPolicyRepo.findGroupPolicies).toHaveBeenCalledWith(groupId);
      expect(result).toEqual([...systemPolicies, ...groupPolicies, ...walletPolicies]);
    });
  });

  describe('getWalletPolicyEvents', () => {
    it('delegates wallet-scoped policy event queries to the repository', async () => {
      const eventResult = { events: [{ id: 'evt-1' }], total: 1 };
      const filters = {
        policyId,
        eventType: 'trigger',
        limit: 25,
        offset: 5,
      };
      mockPolicyRepo.findPolicyEvents.mockResolvedValue(eventResult);

      const result = await vaultPolicyService.getWalletPolicyEvents(walletId, filters);

      expect(result).toBe(eventResult);
      expect(mockPolicyRepo.findPolicyEvents).toHaveBeenCalledWith(walletId, filters);
    });
  });

  describe('policy address management', () => {
    it('lists policy addresses after verifying the policy belongs to the wallet', async () => {
      const addresses = [{ id: 'addr-1', policyId, listType: 'allow' }];

      mockPolicyRepo.findPolicyByIdInWallet.mockResolvedValue({ id: policyId, walletId });
      mockPolicyRepo.findPolicyAddresses.mockResolvedValue(addresses);

      const result = await vaultPolicyService.listPolicyAddressesInWallet(policyId, walletId, 'allow');

      expect(result).toBe(addresses);
      expect(mockPolicyRepo.findPolicyByIdInWallet).toHaveBeenCalledWith(policyId, walletId);
      expect(mockPolicyRepo.findPolicyAddresses).toHaveBeenCalledWith(policyId, 'allow');
    });

    it('creates an address for address_control policies', async () => {
      const createdAddress = { id: 'addr-1', policyId, address: 'tb1qfoo', listType: 'allow' };

      mockPolicyRepo.findPolicyByIdInWallet.mockResolvedValue({
        id: policyId,
        walletId,
        type: 'address_control',
      });
      mockPolicyRepo.createPolicyAddress.mockResolvedValue(createdAddress);

      const result = await vaultPolicyService.createPolicyAddressInWallet(policyId, walletId, userId, {
        address: 'tb1qfoo',
        label: 'Treasury',
        listType: 'allow',
      });

      expect(result).toBe(createdAddress);
      expect(mockPolicyRepo.createPolicyAddress).toHaveBeenCalledWith({
        policyId,
        address: 'tb1qfoo',
        label: 'Treasury',
        listType: 'allow',
        addedBy: userId,
      });
    });

    it('rejects address creation for non-address-control policies', async () => {
      mockPolicyRepo.findPolicyByIdInWallet.mockResolvedValue({
        id: policyId,
        walletId,
        type: 'spending_limit',
      });

      await expect(
        vaultPolicyService.createPolicyAddressInWallet(policyId, walletId, userId, {
          address: 'tb1qfoo',
          listType: 'allow',
        })
      ).rejects.toThrow('Address lists can only be managed on address_control policies');
      expect(mockPolicyRepo.createPolicyAddress).not.toHaveBeenCalled();
    });

    it('removes addresses only when they belong to the policy', async () => {
      mockPolicyRepo.findPolicyByIdInWallet.mockResolvedValue({ id: policyId, walletId });
      mockPolicyRepo.findPolicyAddressById.mockResolvedValue({ id: 'addr-1', policyId });
      mockPolicyRepo.removePolicyAddress.mockResolvedValue(undefined);

      await vaultPolicyService.removePolicyAddressFromWallet(policyId, walletId, 'addr-1');

      expect(mockPolicyRepo.removePolicyAddress).toHaveBeenCalledWith('addr-1');
    });

    it('throws NotFoundError when removing an address from a different policy', async () => {
      mockPolicyRepo.findPolicyByIdInWallet.mockResolvedValue({ id: policyId, walletId });
      mockPolicyRepo.findPolicyAddressById.mockResolvedValue({ id: 'addr-1', policyId: 'other-policy' });

      await expect(
        vaultPolicyService.removePolicyAddressFromWallet(policyId, walletId, 'addr-1')
      ).rejects.toThrow('Address not found in this policy');
      expect(mockPolicyRepo.removePolicyAddress).not.toHaveBeenCalled();
    });
  });

  describe('getPolicy', () => {
    it('returns a policy by id', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({ id: policyId, name: 'Found' });
      const result = await vaultPolicyService.getPolicy(policyId);
      expect(result.name).toBe('Found');
    });

    it('throws NotFoundError when policy does not exist', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue(null);
      await expect(vaultPolicyService.getPolicy(policyId)).rejects.toThrow('Policy not found');
    });
  });

  describe('getPolicyInWallet', () => {
    it('returns a policy scoped to a wallet', async () => {
      mockPolicyRepo.findPolicyByIdInWallet.mockResolvedValue({ id: policyId, walletId });
      const result = await vaultPolicyService.getPolicyInWallet(policyId, walletId);
      expect(result.id).toBe(policyId);
    });

    it('throws NotFoundError when policy not in wallet', async () => {
      mockPolicyRepo.findPolicyByIdInWallet.mockResolvedValue(null);
      await expect(vaultPolicyService.getPolicyInWallet(policyId, walletId))
        .rejects.toThrow('Policy not found');
    });
  });

  describe('getSystemPolicies', () => {
    it('delegates to repository', async () => {
      const policies = [{ id: '1', sourceType: 'system' }];
      mockPolicyRepo.findSystemPolicies.mockResolvedValue(policies);
      const result = await vaultPolicyService.getSystemPolicies();
      expect(result).toEqual(policies);
    });
  });

  describe('getGroupPolicies', () => {
    it('delegates to repository', async () => {
      const policies = [{ id: '1', sourceType: 'group' }];
      mockPolicyRepo.findGroupPolicies.mockResolvedValue(policies);
      const result = await vaultPolicyService.getGroupPolicies(groupId);
      expect(result).toEqual(policies);
      expect(mockPolicyRepo.findGroupPolicies).toHaveBeenCalledWith(groupId);
    });
  });

  describe('getActivePoliciesForWallet', () => {
    it('filters to enabled policies only', async () => {
      const policies = [
        { id: '1', name: 'Active', enabled: true, walletId },
        { id: '2', name: 'Disabled', enabled: false, walletId },
      ];

      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue(policies);
      mockPolicyRepo.findSystemPolicies.mockResolvedValue([]);

      const result = await vaultPolicyService.getActivePoliciesForWallet(walletId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Active');
    });
  });
}
