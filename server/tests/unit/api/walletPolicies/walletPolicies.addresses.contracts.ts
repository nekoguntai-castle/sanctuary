import { describe, expect, it } from 'vitest';

import {
  mockCreatePolicyAddressInWallet,
  mockListPolicyAddressesInWallet,
  mockRemovePolicyAddressFromWallet,
  walletPoliciesRequest,
} from './walletPoliciesTestHarness';
import { InvalidInputError, NotFoundError } from '../../../../src/errors/ApiError';

export function registerWalletPolicyAddressTests(): void {
  describe('GET /:walletId/policies/:policyId/addresses', () => {
    it('lists addresses for a policy', async () => {
      const addresses = [{ id: 'addr-1', address: 'tb1qfoo', listType: 'allow' }];
      mockListPolicyAddressesInWallet.mockResolvedValue(addresses);

      const response = await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ addresses });
      expect(mockListPolicyAddressesInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1', undefined);
    });

    it('filters by listType=allow', async () => {
      mockListPolicyAddressesInWallet.mockResolvedValue([]);

      const response = await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .query({ listType: 'allow' });

      expect(response.status).toBe(200);
      expect(mockListPolicyAddressesInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1', 'allow');
    });

    it('filters by listType=deny', async () => {
      mockListPolicyAddressesInWallet.mockResolvedValue([]);

      const response = await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .query({ listType: 'deny' });

      expect(response.status).toBe(200);
      expect(mockListPolicyAddressesInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1', 'deny');
    });

    it('ignores invalid listType values', async () => {
      mockListPolicyAddressesInWallet.mockResolvedValue([]);

      const response = await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .query({ listType: 'invalid' });

      expect(response.status).toBe(200);
      expect(mockListPolicyAddressesInWallet).toHaveBeenCalledWith('pol-1', 'wallet-1', undefined);
    });

    it('returns 500 when the address service throws', async () => {
      mockListPolicyAddressesInWallet.mockRejectedValue(new Error('db error'));

      const response = await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/pol-1/addresses');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /:walletId/policies/:policyId/addresses', () => {
    it('adds an address to an address_control policy', async () => {
      const createdAddress = { id: 'addr-new', address: 'tb1qfoo', listType: 'allow', policyId: 'pol-1' };
      mockCreatePolicyAddressInWallet.mockResolvedValue(createdAddress);

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'allow', label: 'My Label' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ address: createdAddress });
      expect(mockCreatePolicyAddressInWallet).toHaveBeenCalledWith(
        'pol-1',
        'wallet-1',
        'user-1',
        {
          address: 'tb1qfoo',
          label: 'My Label',
          listType: 'allow',
        },
      );
    });

    it('adds an address with deny listType', async () => {
      mockCreatePolicyAddressInWallet.mockResolvedValue({ id: 'addr-new', listType: 'deny' });

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qbar', listType: 'deny' });

      expect(response.status).toBe(201);
      expect(mockCreatePolicyAddressInWallet).toHaveBeenCalledWith(
        'pol-1',
        'wallet-1',
        'user-1',
        expect.objectContaining({ listType: 'deny' }),
      );
    });

    it('returns 400 when policy is not address_control type', async () => {
      mockCreatePolicyAddressInWallet.mockRejectedValue(
        new InvalidInputError('Address lists can only be managed on address_control policies'),
      );

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Address lists can only be managed on address_control policies');
    });

    it('returns 400 when address is missing', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('address and listType are required');
    });

    it('returns 400 when listType is missing', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('address and listType are required');
    });

    it('returns 400 when both address and listType are missing', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('address and listType are required');
    });

    it('returns 400 when address is not a string', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 12345, listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('address must be a string of 100 characters or fewer');
    });

    it('returns 400 when address exceeds 100 characters', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'a'.repeat(101), listType: 'allow' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('address must be a string of 100 characters or fewer');
    });

    it('accepts address at exactly 100 characters', async () => {
      mockCreatePolicyAddressInWallet.mockResolvedValue({ id: 'addr-new' });

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'a'.repeat(100), listType: 'allow' });

      expect(response.status).toBe(201);
    });

    it('returns 400 when listType is invalid', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'block' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('listType must be "allow" or "deny"');
    });

    it('returns 500 when the address creation service throws', async () => {
      mockCreatePolicyAddressInWallet.mockRejectedValue(new Error('db error'));

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/pol-1/addresses')
        .send({ address: 'tb1qfoo', listType: 'allow' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('DELETE /:walletId/policies/:policyId/addresses/:addressId', () => {
    it('removes an address from a policy', async () => {
      mockRemovePolicyAddressFromWallet.mockResolvedValue(undefined);

      const response = await walletPoliciesRequest()
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockRemovePolicyAddressFromWallet).toHaveBeenCalledWith(
        'pol-1',
        'wallet-1',
        'addr-1',
      );
    });

    it('returns 404 when address is not found', async () => {
      mockRemovePolicyAddressFromWallet.mockRejectedValue(
        new NotFoundError('Address not found in this policy'),
      );

      const response = await walletPoliciesRequest()
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-missing');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Address not found in this policy');
    });

    it('returns 404 when address belongs to a different policy', async () => {
      mockRemovePolicyAddressFromWallet.mockRejectedValue(
        new NotFoundError('Address not found in this policy'),
      );

      const response = await walletPoliciesRequest()
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Address not found in this policy');
    });

    it('returns 500 when the address removal service throws', async () => {
      mockRemovePolicyAddressFromWallet.mockRejectedValue(new Error('delete error'));

      const response = await walletPoliciesRequest()
        .delete('/api/v1/wallets/wallet-1/policies/pol-1/addresses/addr-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });
}
