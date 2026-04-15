import { describe, expect, it } from 'vitest';

import {
  mockCreatePolicy,
  mockDeletePolicy,
  mockGetPolicyInWallet,
  mockListWalletPolicies,
  mockLogFromRequest,
  mockUpdatePolicy,
  walletPoliciesRequest,
} from './walletPoliciesTestHarness';

export function registerWalletPolicyCrudTests(): void {
  describe('GET /:walletId/policies', () => {
    it('lists policies including inherited by default', async () => {
      const policies = [{ id: 'pol-1', name: 'Spending Limit' }];
      mockListWalletPolicies.mockResolvedValue(policies);

      const response = await walletPoliciesRequest().get('/api/v1/wallets/wallet-1/policies');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policies });
      expect(mockListWalletPolicies).toHaveBeenCalledWith('wallet-1', {
        includeInherited: true,
      });
    });

    it('excludes inherited when includeInherited=false', async () => {
      mockListWalletPolicies.mockResolvedValue([]);

      const response = await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies')
        .query({ includeInherited: 'false' });

      expect(response.status).toBe(200);
      expect(mockListWalletPolicies).toHaveBeenCalledWith('wallet-1', {
        includeInherited: false,
      });
    });

    it('returns 500 when service throws', async () => {
      mockListWalletPolicies.mockRejectedValue(new Error('db error'));

      const response = await walletPoliciesRequest().get('/api/v1/wallets/wallet-1/policies');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('GET /:walletId/policies/:policyId', () => {
    it('returns a specific policy', async () => {
      const policy = { id: 'pol-1', name: 'Spending Limit', walletId: 'wallet-1' };
      mockGetPolicyInWallet.mockResolvedValue(policy);

      const response = await walletPoliciesRequest().get('/api/v1/wallets/wallet-1/policies/pol-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policy });
      expect(mockGetPolicyInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1');
    });

    it('returns 500 when getPolicyInWallet throws', async () => {
      mockGetPolicyInWallet.mockRejectedValue(new Error('not found'));

      const response = await walletPoliciesRequest().get('/api/v1/wallets/wallet-1/policies/pol-missing');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /:walletId/policies', () => {
    const createPayload = {
      name: 'Daily Limit',
      description: 'Max 1 BTC per day',
      type: 'spending_limit',
      config: { maxAmount: '100000000', windowType: 'rolling', windowDuration: 86400 },
      priority: 10,
      enforcement: 'block',
      enabled: true,
    };

    it('creates a new policy and logs audit event', async () => {
      const createdPolicy = {
        id: 'pol-new',
        name: 'Daily Limit',
        type: 'spending_limit',
        walletId: 'wallet-1',
      };
      mockCreatePolicy.mockResolvedValue(createdPolicy);

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies')
        .send(createPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ policy: createdPolicy });
      expect(mockCreatePolicy).toHaveBeenCalledWith('user-1', {
        walletId: 'wallet-1',
        name: 'Daily Limit',
        description: 'Max 1 BTC per day',
        type: 'spending_limit',
        config: createPayload.config,
        priority: 10,
        enforcement: 'block',
        enabled: true,
      });
      expect(mockLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_create',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            policyId: 'pol-new',
            policyName: 'Daily Limit',
            policyType: 'spending_limit',
          },
        }
      );
    });

    it('creates a policy with minimal fields (undefined optional fields)', async () => {
      const createdPolicy = { id: 'pol-2', name: 'Basic', type: 'spending_limit' };
      mockCreatePolicy.mockResolvedValue(createdPolicy);

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies')
        .send({ name: 'Basic', type: 'spending_limit' });

      expect(response.status).toBe(201);
      expect(mockCreatePolicy).toHaveBeenCalledWith('user-1', {
        walletId: 'wallet-1',
        name: 'Basic',
        description: undefined,
        type: 'spending_limit',
        config: undefined,
        priority: undefined,
        enforcement: undefined,
        enabled: undefined,
      });
    });

    it('returns 500 when createPolicy throws', async () => {
      mockCreatePolicy.mockRejectedValue(new Error('validation failed'));

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies')
        .send(createPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('PATCH /:walletId/policies/:policyId', () => {
    it('updates a policy and logs audit event', async () => {
      const existingPolicy = { id: 'pol-1', walletId: 'wallet-1' };
      const updatedPolicy = { id: 'pol-1', name: 'Updated Name', walletId: 'wallet-1' };
      mockGetPolicyInWallet.mockResolvedValue(existingPolicy);
      mockUpdatePolicy.mockResolvedValue(updatedPolicy);

      const response = await walletPoliciesRequest()
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send({ name: 'Updated Name', enabled: false });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ policy: updatedPolicy });
      expect(mockGetPolicyInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1');
      expect(mockUpdatePolicy).toHaveBeenCalledWith('pol-1', 'user-1', {
        name: 'Updated Name',
        enabled: false,
      });
      expect(mockLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_update',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            policyId: 'pol-1',
            updatedFields: ['name', 'enabled'],
          },
        }
      );
    });

    it('handles all updateable fields', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockUpdatePolicy.mockResolvedValue({ id: 'pol-1' });

      const patchBody = {
        name: 'New Name',
        description: 'New description',
        config: { maxAmount: '500000' },
        priority: 5,
        enforcement: 'warn',
        enabled: true,
      };

      const response = await walletPoliciesRequest()
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send(patchBody);

      expect(response.status).toBe(200);
      expect(mockUpdatePolicy).toHaveBeenCalledWith('pol-1', 'user-1', patchBody);
    });

    it('sends empty input object when no fields are provided', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockUpdatePolicy.mockResolvedValue({ id: 'pol-1' });

      const response = await walletPoliciesRequest()
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send({});

      expect(response.status).toBe(200);
      expect(mockUpdatePolicy).toHaveBeenCalledWith('pol-1', 'user-1', {});
    });

    it('returns 500 when getPolicyInWallet throws (policy not in wallet)', async () => {
      mockGetPolicyInWallet.mockRejectedValue(new Error('Policy not found'));

      const response = await walletPoliciesRequest()
        .patch('/api/v1/wallets/wallet-1/policies/pol-missing')
        .send({ name: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });

    it('returns 500 when updatePolicy throws', async () => {
      mockGetPolicyInWallet.mockResolvedValue({ id: 'pol-1' });
      mockUpdatePolicy.mockRejectedValue(new Error('update error'));

      const response = await walletPoliciesRequest()
        .patch('/api/v1/wallets/wallet-1/policies/pol-1')
        .send({ name: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('DELETE /:walletId/policies/:policyId', () => {
    it('deletes a policy and logs audit event', async () => {
      mockDeletePolicy.mockResolvedValue(undefined);

      const response = await walletPoliciesRequest()
        .delete('/api/v1/wallets/wallet-1/policies/pol-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockDeletePolicy).toHaveBeenCalledWith('pol-1', 'wallet-1');
      expect(mockLogFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'wallet.policy_delete',
        'wallet',
        {
          details: {
            walletId: 'wallet-1',
            policyId: 'pol-1',
          },
        }
      );
    });

    it('returns 500 when deletePolicy throws', async () => {
      mockDeletePolicy.mockRejectedValue(new Error('delete failed'));

      const response = await walletPoliciesRequest()
        .delete('/api/v1/wallets/wallet-1/policies/pol-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });
}
