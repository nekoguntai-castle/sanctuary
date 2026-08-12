import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import { app, mockAssertHardwareWalletCapability } from './devicesTestHarness';

export function registerDeviceAccountTests(): void {
  describe('GET /devices/:id/accounts', () => {
    it('should return all accounts for a device', async () => {
      const mockAccounts = [
        {
          id: 'account-1',
          deviceId: 'device-1',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub_single...',
        },
        {
          id: 'account-2',
          deviceId: 'device-1',
          purpose: 'multisig',
          scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub_multi...',
        },
      ];

      mockPrismaClient.deviceAccount.findMany.mockResolvedValue(mockAccounts);

      const response = await request(app)
        .get('/api/v1/devices/device-1/accounts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].purpose).toBe('single_sig');
      expect(response.body[1].purpose).toBe('multisig');
    });

    it('should handle database errors while fetching accounts', async () => {
      mockPrismaClient.deviceAccount.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/devices/device-1/accounts');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /devices/:id/accounts', () => {
    const newAccount = {
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: "m/48'/0'/0'/2'",
      xpub: 'xpub_multisig...',
      masterFingerprint: 'aabbccdd',
    };

    it.each(['ledger', 'jade', 'trezor'])(
      'blocks account addition for %s before duplicate lookup or write',
      async (type) => {
        const { ForbiddenError } = await import('../../../../src/errors');
        mockAssertHardwareWalletCapability.mockImplementationOnce(() => {
          throw new ForbiddenError('blocked', undefined, {
            vendor: type,
            capability: 'account_add',
          });
        });
        mockPrismaClient.device.findUnique.mockResolvedValue({
          id: 'device-1',
          type,
          model: null,
          accounts: [],
        });

        const response = await request(app)
          .post('/api/v1/devices/device-1/accounts')
          .send(newAccount);

        expect(response.status).toBe(403);
        expect(response.body.details).toMatchObject({
          vendor: type,
          capability: 'account_add',
        });
        expect(mockPrismaClient.deviceAccount.findFirst).not.toHaveBeenCalled();
        expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
      },
    );

    it('returns 404 before account lookup when the device no longer exists', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/devices/missing/accounts')
        .send(newAccount);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Device not found');
      expect(mockPrismaClient.deviceAccount.findFirst).not.toHaveBeenCalled();
    });

    it('should add a new account to existing device', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null); // No existing account
      mockPrismaClient.deviceAccount.create.mockResolvedValue({
        id: 'account-new',
        deviceId: 'device-1',
        ...newAccount,
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(201);
      expect(response.body.purpose).toBe('multisig');
      expect(mockPrismaClient.deviceAccount.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: 'device-1',
          derivationPath: "m/48'/0'/0'/2'",
        },
      });
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceId: 'device-1',
          purpose: 'multisig',
          scriptType: 'native_segwit',
        }),
      });
    });

    it('accepts an uppercase master fingerprint after exact normalized comparison', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null);
      mockPrismaClient.deviceAccount.create.mockResolvedValue({
        id: 'account-new',
        deviceId: 'device-1',
        ...newAccount,
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send({ ...newAccount, masterFingerprint: 'AABBCCDD' });

      expect(response.status).toBe(201);
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledTimes(1);
    });

    it('rejects missing or sentinel master-fingerprint evidence before any lookup or write', async () => {
      for (const masterFingerprint of [undefined, '', '00000000']) {
        vi.clearAllMocks();
        const response = await request(app)
          .post('/api/v1/devices/device-1/accounts')
          .send({ ...newAccount, masterFingerprint });

        expect(response.status).toBe(400);
        expect(mockPrismaClient.device.findUnique).not.toHaveBeenCalled();
        expect(mockPrismaClient.deviceAccount.findFirst).not.toHaveBeenCalled();
        expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
      }
    });

    it('rejects a connected master fingerprint that does not match the stored device', async () => {
      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send({ ...newAccount, masterFingerprint: 'deadbeef' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('does not match');
      expect(mockPrismaClient.deviceAccount.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it.each([
      { derivationPath: " m/48'/0'/0'/2'" },
      { xpub: 'xpub_multisig... ' },
    ])('rejects silently normalized account evidence %#', async (override) => {
      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send({ ...newAccount, ...override });

      expect(response.status).toBe(400);
      expect(mockPrismaClient.device.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should reject duplicate derivation path', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'existing-account',
        deviceId: 'device-1',
        derivationPath: "m/48'/0'/0'/2'",
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already exists');
    });

    it('should reject missing required fields', async () => {
      const incompleteAccount = {
        purpose: 'multisig',
        // Missing scriptType, derivationPath, xpub
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(incompleteAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid purpose', async () => {
      const invalidAccount = {
        ...newAccount,
        purpose: 'invalid',
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(invalidAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('purpose');
    });

    it('should reject invalid scriptType', async () => {
      const invalidAccount = {
        ...newAccount,
        scriptType: 'invalid_script_type',
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(invalidAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('scriptType');
    });

    it('should handle database errors while adding an account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null);
      mockPrismaClient.deviceAccount.create.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /devices/:id/accounts/:accountId', () => {
    it('should delete account from device', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
        purpose: 'multisig',
        scriptType: 'native_segwit',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(2); // Has more than 1 account
      mockPrismaClient.deviceAccount.delete.mockResolvedValue({});

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(204);
      expect(mockPrismaClient.deviceAccount.delete).toHaveBeenCalledWith({
        where: { id: 'account-1' },
      });
    });

    it('should prevent deleting last account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(1); // Only 1 account

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('last account');
    });

    it('prevents deleting an account bound to a wallet before count or delete', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
      });
      mockPrismaClient.walletDevice.findFirst.mockResolvedValue({ id: 'wallet-link-1' });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('bound to a wallet');
      expect(mockPrismaClient.deviceAccount.count).not.toHaveBeenCalled();
      expect(mockPrismaClient.deviceAccount.delete).not.toHaveBeenCalled();
    });

    it('blocks target-vendor account deletion before count or delete', async () => {
      const { ForbiddenError } = await import('../../../../src/errors');
      mockAssertHardwareWalletCapability.mockImplementationOnce(() => {
        throw new ForbiddenError('blocked', undefined, {
          vendor: 'ledger',
          capability: 'account_add',
        });
      });
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
      });
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: 'device-1',
        type: 'ledger',
        model: null,
        accounts: [],
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(403);
      expect(mockPrismaClient.deviceAccount.count).not.toHaveBeenCalled();
      expect(mockPrismaClient.deviceAccount.delete).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/non-existent');

      expect(response.status).toBe(404);
    });

    it('returns 404 without checking bindings when the account device disappears', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
      });
      mockPrismaClient.device.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Device not found');
      expect(mockPrismaClient.walletDevice.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaClient.deviceAccount.count).not.toHaveBeenCalled();
      expect(mockPrismaClient.deviceAccount.delete).not.toHaveBeenCalled();
    });

    it('should handle database errors while deleting an account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
        purpose: 'multisig',
        scriptType: 'native_segwit',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(2);
      mockPrismaClient.deviceAccount.delete.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
}
