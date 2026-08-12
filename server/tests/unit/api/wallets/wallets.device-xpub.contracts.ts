import { describe, expect, it, vi } from 'vitest';
import { mockAddDeviceToWallet, mockGenerateAddress, mockRepairWalletDescriptor, request, walletRouter } from './walletsTestHarness';

export const registerWalletDeviceXpubContracts = () => {
  // ==================== Device Management Tests ====================

  describe('POST /wallets/:id/addresses', () => {
    it('should generate new address', async () => {
      mockGenerateAddress.mockResolvedValue('bc1qnewaddress123');

      const response = await request(walletRouter).post('/api/v1/wallets/wallet-123/addresses');

      expect(response.status).toBe(201);
      expect(response.body.address).toBe('bc1qnewaddress123');
    });

    it('should handle address generation error', async () => {
      mockGenerateAddress.mockRejectedValue(new Error('Address generation failed'));

      const response = await request(walletRouter).post('/api/v1/wallets/wallet-123/addresses');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /wallets/:id/devices', () => {
    it('should add device to wallet', async () => {
      mockAddDeviceToWallet.mockResolvedValue({ success: true });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({ deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('added');
      expect(mockAddDeviceToWallet).toHaveBeenCalledWith(
        'wallet-123',
        { deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 },
        'test-user-id',
      );
    });

    it('should reject without exact signer identity', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('deviceId');
    });

    it('should handle add device errors', async () => {
      mockAddDeviceToWallet.mockRejectedValue(new Error('Add device failed'));

      const response = await request(walletRouter)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({ deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /wallets/:id/repair', () => {
    it('retires direct mutation in favor of immutable remediation', async () => {
      const response = await request(walletRouter).post('/api/v1/wallets/wallet-123/repair');

      expect(response.status).toBe(410);
      expect(response.body.message).toContain('immutable remediation preview');
      expect(mockRepairWalletDescriptor).not.toHaveBeenCalled();
    });
  });

  // ==================== XPUB Validation Tests ====================

  describe('POST /wallets/validate-xpub', () => {
    it('should validate xpub and generate descriptor', async () => {
      const xpub = 'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V';
      const response = await request(walletRouter)
        .post('/api/v1/wallets/validate-xpub')
        .send({
          xpub,
          scriptType: 'native_segwit',
          fingerprint: 'aabbccdd',
          accountPath: "84'/0'/0'",
        });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.descriptor).toBe(
        `wpkh([aabbccdd/84'/0'/0']${xpub}/<0;1>/*)`,
      );
      expect(response.body.firstAddress).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    });

    it('should reject without xpub', async () => {
      const response = await request(walletRouter)
        .post('/api/v1/wallets/validate-xpub')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('xpub');
    });

    it('should reject invalid xpub', async () => {
      const addressDerivation = await import('../../../../src/services/bitcoin/addressDerivation');
      vi.mocked(addressDerivation.validateXpub).mockReturnValueOnce({ valid: false, error: 'Invalid xpub format' });

      const response = await request(walletRouter)
        .post('/api/v1/wallets/validate-xpub')
        .send({
          xpub: 'invalid-xpub',
          fingerprint: 'aabbccdd',
          accountPath: "84'/0'/0'",
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid xpub');
    });
  });
};
